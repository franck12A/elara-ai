// Screenshot de la cara 3D (VRM): levanta el server con handlers simulados,
// abre la página /vrm en Chrome headless y guarda dos capturas: en reposo y
// hablando. También vuelca el estado y los errores de consola.
//   npx tsx scripts/shot-vrm.ts
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFaceServer } from "../src/face/face.server.js";

const PORT = 4399;
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const server = await startFaceServer(PORT, {
  onChat: async (text) => ({
    display: `holi! me dijiste "${text}" y me encantó 🌙`,
    emotion: "happy",
    audio: undefined,
  }),
  onTranscribe: async () => "prueba",
});

const userDataDir = mkdtempSync(join(tmpdir(), "jarvis-shot-vrm-"));
const chrome = spawn(CHROME_PATH, [
  "--headless=new",
  "--no-sandbox",
  "--enable-unsafe-swiftshader",
  `--user-data-dir=${userDataDir}`,
  "--remote-debugging-port=9345",
  "about:blank",
]);

const consoleMsgs: string[] = [];
let msgId = 0;
const pending = new Map<number, (v: unknown) => void>();

try {
  let version: { webSocketDebuggerUrl?: string } | undefined;
  for (let i = 0; i < 50; i++) {
    try {
      version = (await (await fetch("http://127.0.0.1:9345/json/version")).json()) as {
        webSocketDebuggerUrl?: string;
      };
      break;
    } catch {
      await sleep(200);
    }
  }
  if (!version) throw new Error("Chrome no levantó el CDP");

  const target = (await (
    await fetch("http://127.0.0.1:9345/json/new?about:blank", { method: "PUT" })
  ).json()) as { webSocketDebuggerUrl: string };

  const { default: WebSocket } = await import("ws");
  const ws = new WebSocket(target.webSocketDebuggerUrl);

  await new Promise<void>((resolve) => ws.on("open", () => resolve()));

  ws.on("message", (raw: unknown) => {
    const msg = JSON.parse(String(raw)) as {
      id?: number;
      method?: string;
      params?: Record<string, any>;
      result?: unknown;
    };
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)!(msg.result);
      pending.delete(msg.id);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params?.exceptionDetails;
      consoleMsgs.push(`[EXCEPTION] ${d?.text ?? ""} ${d?.exception?.description ?? ""}`);
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
      const text = (msg.params.args ?? [])
        .map((a: Record<string, unknown>) => a.value ?? a.description ?? "")
        .join(" ");
      consoleMsgs.push(`[error] ${text}`);
    }
  });

  function send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = ++msgId;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => pending.set(id, resolve));
  }

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 460,
    height: 800,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await send("Page.navigate", { url: server.url + "/vrm" });

  // Esperar a que el modelo VRM cargue (o hasta 20 s).
  let loaded = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const check = (await send("Runtime.evaluate", {
      expression: "Boolean(window.__jarvis && window.__jarvis.vrm)",
      returnByValue: true,
    })) as { result?: { value?: boolean } };
    if (check.result?.value) {
      loaded = true;
      break;
    }
  }
  console.log(loaded ? "🧍 modelo VRM cargado" : "⚠️ el modelo VRM no cargó a tiempo");
  await sleep(1000);

  let shot = (await send("Page.captureScreenshot", { format: "png" })) as { data: string };
  writeFileSync("jarvis-vrm-idle.png", Buffer.from(shot.data, "base64"));
  console.log("📸 jarvis-vrm-idle.png (reposo)");

  // Le mandamos un mensaje y la dejamos "hablando" (boca sintética).
  await send("Runtime.evaluate", {
    expression: `window.__jarvis ? window.__jarvis.send("hola jarvis, probando la boca") : "sin __jarvis"`,
    returnByValue: true,
  });
  await sleep(1500);

  shot = (await send("Page.captureScreenshot", { format: "png" }));
  writeFileSync("jarvis-vrm-talking.png", Buffer.from((shot as { data: string }).data, "base64"));
  console.log("📸 jarvis-vrm-talking.png (hablando)");

  const state = (await send("Runtime.evaluate", {
    expression: `JSON.stringify({
      mensajes: document.querySelectorAll(".msg").length,
      vrm: Boolean(window.__jarvis && window.__jarvis.vrm),
      boca: Math.round((window.__jarvis?.face.mouth ?? 0) * 100),
      emocion: window.__jarvis?.face.emotion,
      status: document.getElementById("statusText").textContent,
      canvas: document.getElementById("face3d").width + "x" + document.getElementById("face3d").height,
      encuadre: window.__jarvis?.frameInfo?.(),
    })`,
    returnByValue: true,
  })) as { result?: { value?: string } };
  console.log("ESTADO:", state.result?.value);

  if (consoleMsgs.length > 0) {
    console.log("CONSOLA:");
    for (const m of consoleMsgs.slice(0, 15)) console.log("  ", m);
  } else {
    console.log("CONSOLA: sin errores 👌");
  }

  ws.close();
} finally {
  chrome.kill();
  await sleep(400);
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // Windows EPERM con Crashpad: ignorar.
  }
  await server.close();
}
