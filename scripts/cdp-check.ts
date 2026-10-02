// Verifica si el canvas de pixi realmente tiene el modelo dibujado.
// Uso: npx tsx scripts/cdp-check.ts [url]
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] ?? "http://localhost:4321";
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const userDataDir = mkdtempSync(join(tmpdir(), "elara-check-"));

const chrome = spawn(chromePath, [
  "--headless=new",
  "--no-sandbox",
  `--user-data-dir=${userDataDir}`,
  "--remote-debugging-port=9334",
  "about:blank",
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(path: string, method = "GET"): Promise<any> {
  const res = await fetch(`http://127.0.0.1:9334${path}`, { method });
  return res.json();
}

try {
  let version: any;
  for (let i = 0; i < 50; i++) {
    try {
      version = await getJson("/json/version");
      break;
    } catch {
      await sleep(200);
    }
  }
  if (!version) throw new Error("Chrome no levantó el CDP");

  const target = await getJson("/json/new?about:blank", "PUT");
  const { default: WebSocket } = await import("ws");
  const ws = new WebSocket(target.webSocketDebuggerUrl);

  const consoleMsgs: string[] = [];
  let msgId = 0;
  const pending = new Map<number, (v: any) => void>();

  await new Promise<void>((resolve) => ws.on("open", () => resolve()));

  ws.on("message", (raw: any) => {
    const msg = JSON.parse(String(raw));
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)!(msg.result);
      pending.delete(msg.id);
    }
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = (msg.params.args ?? [])
        .map((a: any) => a.value ?? a.description ?? "")
        .join(" ");
      consoleMsgs.push(`[${msg.params.type}] ${text}`);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      consoleMsgs.push(
        `[EXCEPTION] ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description ?? ""}`,
      );
    }
  });

  function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = ++msgId;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => pending.set(id, resolve));
  }

  await send("Runtime.enable");
  await send("Page.enable");

  await send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await send("Page.navigate", { url });
  await sleep(12000);

  // Test 1: ¿el canvas visible tiene píxeles que difieren del fondo?
  const canvasCheck = await send("Runtime.evaluate", {
    expression: `(() => {
      const e = window.__elara;
      if (!e) return "sin __elara (modelo no cargado)";
      const src = e.app.view;
      const c = document.createElement("canvas");
      c.width = src.width; c.height = src.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(src, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let distintos = 0, total = 0, maxSum = 0;
      for (let i = 0; i < d.length; i += 4) {
        const y = Math.floor((i / 4) / c.width);
        const t = y / c.height;
        const fr = 0x1c + (0x0d - 0x1c) * t;
        const fg = 0x1b + (0x0d - 0x1b) * t;
        const fb = 0x2e + (0x12 - 0x2e) * t;
        const diff = Math.abs(d[i] - fr) + Math.abs(d[i+1] - fg) + Math.abs(d[i+2] - fb);
        if (diff > 30) distintos++;
        if (diff > maxSum) maxSum = diff;
        total++;
      }
      return JSON.stringify({
        canvasSize: src.width + "x" + src.height,
        pixelsDistintosDelFondo: ((distintos / total) * 100).toFixed(2) + "%",
        maxDiff: maxSum,
        glError: e.app.renderer.gl.getError(),
        fps: Math.round(e.app.ticker.FPS),
      });
    })()`,
    returnByValue: true,
  });
  console.log("CANVAS:", canvasCheck.result?.value);

  // Test 2: forzar un render y volver a leer
  const forced = await send("Runtime.evaluate", {
    expression: `(() => {
      const e = window.__elara;
      e.app.render();
      const src = e.app.view;
      const c = document.createElement("canvas");
      c.width = 1280; c.height = 800;
      const ctx = c.getContext("2d");
      ctx.drawImage(src, 0, 0);
      const d = ctx.getImageData(465, 128, 350, 656).data;
      let noVacios = 0;
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] > 0 || d[i-1] > 10 || d[i-2] > 10 || d[i-3] > 10) noVacios++;
      }
      return "píxeles no-fondo en bounds del modelo: " + ((noVacios / (350 * 656)) * 100).toFixed(2) + "%";
    })()`,
    returnByValue: true,
  });
  console.log("FORCED:", forced.result?.value);

  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync("elara-canvas-check.png", Buffer.from(shot.data, "base64"));
  console.log("screenshot: elara-canvas-check.png");

  console.log("CONSOLA:");
  for (const m of consoleMsgs) console.log("  ", m);

  ws.close();
} finally {
  chrome.kill();
  await sleep(500);
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // Windows EPERM con Crashpad: ignorar.
  }
}
