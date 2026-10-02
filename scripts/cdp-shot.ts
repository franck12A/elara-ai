// Debug: abre Chrome headless con CDP, navega a la cara de Elara,
// captura consola + screenshot. Uso: npx tsx scripts/cdp-shot.ts [url]
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] ?? "http://localhost:4321";
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const userDataDir = mkdtempSync(join(tmpdir(), "elara-cdp-"));

const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--enable-unsafe-swiftshader",
  `--user-data-dir=${userDataDir}`,
  "--remote-debugging-port=9333",
  "about:blank",
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(path: string, method = "GET"): Promise<any> {
  const res = await fetch(`http://127.0.0.1:9333${path}`, { method });
  return res.json();
}

try {
  // Esperar a que el endpoint de debug esté listo.
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
        .map((a: any) => a.value ?? a.description ?? JSON.stringify(a.preview?.properties?.map((p: any) => `${p.name}:${p.value}`)) ?? "")
        .join(" ");
      consoleMsgs.push(`[${msg.params.type}] ${text}`);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      consoleMsgs.push(`[EXCEPTION] ${d.text} ${d.exception?.description ?? ""}`);
    }
    if (msg.method === "Network.loadingFailed") {
      consoleMsgs.push(`[NETWORK-FAIL] ${JSON.stringify(msg.params)}`);
    }
  });

  function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = ++msgId;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => pending.set(id, resolve));
  }

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await send("Page.navigate", { url });
  await sleep(12000);

  const shot = await send("Page.captureScreenshot", { format: "png" });
  const { writeFileSync } = await import("node:fs");
  writeFileSync("elara-debug.png", Buffer.from(shot.data, "base64"));

  const status = await send("Runtime.evaluate", {
    expression: `document.getElementById("status").textContent + " | ready=" + document.body.dataset.ready + " | canvas=" + document.querySelectorAll("canvas").length + " | pixi=" + (typeof PIXI) + " | live2d=" + (typeof Live2DCubismCore) + " | pixiLive2d=" + (!!PIXI?.live2d)`,
    returnByValue: true,
  });
  console.log("ESTADO:", status.result?.value);

  const diag = await send("Runtime.evaluate", {
    expression: `(() => {
      const e = window.__elara;
      if (!e) return "sin __elara";
      const m = e.model;
      const bounds = m.getBounds();
      return JSON.stringify({
        scale: { x: m.scale.x, y: m.scale.y },
        position: { x: m.position.x, y: m.position.y },
        anchor: m.anchor ? { x: m.anchor.x, y: m.anchor.y } : null,
        width: m.width,
        height: m.height,
        bounds: { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height },
        visible: m.visible,
        alpha: m.alpha,
        renderable: m.renderable,
        stageChildren: e.app.stage.children.length,
        renderer: { type: e.app.renderer.type, w: e.app.renderer.width, h: e.app.renderer.height, viewW: e.app.view.width, viewH: e.app.view.height },
        canvasCss: (() => { const r = e.app.view.getBoundingClientRect(); return { w: r.width, h: r.height }; })(),
        tickerFPS: e.app.ticker.FPS,
      });
    })()`,
    returnByValue: true,
  });
  console.log("DIAG:", diag.result?.value);

  const render = await send("Runtime.evaluate", {
    expression: `(() => {
      const e = window.__elara;
      if (!e) return "sin __elara";
      const gl = e.app.renderer.gl;
      const info = {
        glRenderer: gl.getParameter(gl.RENDERER),
        glError: gl.getError(),
        csmGetParameterValue: typeof Live2DCubismCore.csmGetParameterValue,
        csmGetParameterValues: typeof Live2DCubismCore.csmGetParameterValues,
        csmSetParameterValueById: typeof Live2DCubismCore.csmSetParameterValueById,
        csmSetParameterValue: typeof Live2DCubismCore.csmSetParameterValue,
        coreModelProto: Object.getPrototypeOf(e.model.internalModel.coreModel).constructor.name,
      };
      return e.app.renderer.extract.base64(e.app.stage).then((b64) => {
        return JSON.stringify({ ...info, extractLen: b64.length, extractHead: b64.slice(0, 60) });
      });
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log("RENDER:", render.result?.value ?? JSON.stringify(render.result));
  console.log("screenshot guardado en elara-debug.png");

  // Guardar el extract del stage para analizar si el modelo se dibujó.
  const extractB64 = await send("Runtime.evaluate", {
    expression: `window.__elara ? window.__elara.app.renderer.extract.base64(window.__elara.app.stage) : null`,
    returnByValue: true,
    awaitPromise: true,
  });
  const b64 = extractB64.result?.value;
  if (b64 && typeof b64 === "string") {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      "elara-stage-extract.png",
      Buffer.from(b64.replace(/^data:image\/png;base64,/, ""), "base64"),
    );
    console.log("extract guardado en elara-stage-extract.png");
  }
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
