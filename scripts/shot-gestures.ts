// Verificación del motor de gestos: levanta el server, abre /vrm en Chrome
// headless, dispara gestos por consola y captura screenshots en cada pose.
//   npx tsx scripts/shot-gestures.ts
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFaceServer } from "../src/face/face.server.js";

const PORT = 4398;
const CHROME_PATH =
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espera mínima por gesto: entrada + 0.35s de hold (comprobado a mano). */
const GESTURE_WAIT_MS = 1650;

const GESTURES = [
  "wave",
  "waveBoth",
  "nod",
  "shakeHead",
  "shrug",
  "handOnChest",
  "clap",
  "think",
  "stretch",
  "cheer",
  "facepalm",
  "idea",
  "fist",
  "beckon",
];

const server = await startFaceServer(PORT, {
  onChat: async (text) => ({
    display: `holi! me dijiste "${text}" 🌙`,
    emotion: "happy",
    audio: undefined,
  }),
});

const userDataDir = mkdtempSync(join(tmpdir(), "jarvis-shot-gestures-"));
const chrome = spawn(CHROME_PATH, [
  "--headless=new",
  "--no-sandbox",
  "--enable-unsafe-swiftshader",
  `--user-data-dir=${userDataDir}`,
  "--remote-debugging-port=9346",
  "about:blank",
]);

const consoleMsgs: string[] = [];
let msgId = 0;
const pending = new Map<number, (v: unknown) => void>();

try {
  let version: { webSocketDebuggerUrl?: string } | undefined;
  for (let i = 0; i < 50; i++) {
    try {
      version = (await (await fetch("http://127.0.0.1:9346/json/version")).json()) as {
        webSocketDebuggerUrl?: string;
      };
      break;
    } catch {
      await sleep(200);
    }
  }
  if (!version) throw new Error("Chrome no levantó el CDP");

  const target = (await (
    await fetch("http://127.0.0.1:9346/json/new?about:blank", { method: "PUT" })
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
  await sleep(1200);

  let failures = 0;

  // Línea base de la cabeza (para validar nod/shakeHead).
  const readHead = () =>
    send("Runtime.evaluate", {
      expression: `JSON.stringify((() => {
        const h = window.__jarvis?.vrm?.humanoid?.getNormalizedBoneNode("head");
        return h ? { x: +h.rotation.x.toFixed(4), y: +h.rotation.y.toFixed(4) } : null;
      })())`,
      returnByValue: true,
    }) as Promise<{ result?: { value?: string } }>;

  const baseHead = JSON.parse((await readHead()).result?.value ?? "{}") as {
    x?: number; y?: number;
  };

  /** ¿La cabeza se movió bastante respecto de la línea base? */
  async function headMoved(): Promise<boolean> {
    let maxYaw = 0;
    for (let i = 0; i < 6; i++) {
      await sleep(120);
      const s = JSON.parse((await readHead()).result?.value ?? "{}") as {
        x?: number; y?: number;
      };
      maxYaw = Math.max(
        maxYaw,
        Math.abs((s.x ?? 0) - (baseHead.x ?? 0)),
        Math.abs((s.y ?? 0) - (baseHead.y ?? 0)),
      );
    }
    return maxYaw > 0.05;
  }

  const HEAD_GESTURES = new Set(["nod", "shakeHead"]);

  for (const gesture of GESTURES) {
    // Esperar a que el gesto anterior termine del todo (el motor encola si
    // le pedís uno nuevo mientras hay uno activo).
    for (let i = 0; i < 60; i++) {
      const idle = (await send("Runtime.evaluate", {
        expression: "window.__jarvis?.gestureState?.name == null",
        returnByValue: true,
      })) as { result?: { value?: boolean } };
      if (idle.result?.value) break;
      await sleep(250);
    }

    await send("Runtime.evaluate", {
      expression: `window.__jarvis?.setGesture?.("${gesture}")`,
      returnByValue: true,
    });

    // Los gestos de cabeza son cortos y no mueven brazos: medimos la cabeza
    // durante el gesto en vez de quedarnos con el estado final.
    if (HEAD_GESTURES.has(gesture)) {
      const moved = await headMoved();
      if (!moved) failures++;
      console.log(`${moved ? "✅" : "❌"} ${gesture}: la cabeza ${moved ? "se movió" : "NO se movió"}`);
      const shot = (await send("Page.captureScreenshot", { format: "png" })) as { data: string };
      writeFileSync(`jarvis-gesto-${gesture}.png`, Buffer.from(shot.data, "base64"));
      continue;
    }

    // Dejarlo llegar al hold (los "in" van de 0.28s a 0.9s).
    await sleep(GESTURE_WAIT_MS);

    const state = (await send("Runtime.evaluate", {
      expression: `JSON.stringify((() => {
        const e = window.__jarvis;
        if (!e) return { error: "sin __jarvis" };
        const r = e.rig;
        return {
          gesto: e.gestureState?.name,
          fase: e.gestureState?.phase,
          L: { Z: +r.L.shoulderZ.pos.toFixed(3), X: +r.L.shoulderX.pos.toFixed(3), codo: +r.L.elbowY.pos.toFixed(3) },
          R: { Z: +r.R.shoulderZ.pos.toFixed(3), X: +r.R.shoulderX.pos.toFixed(3), codo: +r.R.elbowY.pos.toFixed(3) },
        };
      })())`,
      returnByValue: true,
    })) as { result?: { value?: string } };

    const parsed = JSON.parse(state.result?.value ?? "{}") as {
      gesto?: string;
      fase?: string;
      L?: { Z: number; X: number; codo: number };
      R?: { Z: number; X: number; codo: number };
      error?: string;
    };

    const moving =
      parsed.L || parsed.R
        ? Math.abs(parsed.L?.Z ?? 0) > 0.15 ||
          Math.abs(parsed.R?.Z ?? 0) > 0.15 ||
          Math.abs(parsed.L?.codo ?? 0) > 0.2 ||
          Math.abs(parsed.R?.codo ?? 0) > 0.2
        : false;

    if (!moving) failures++;
    console.log(
      `${moving ? "✅" : "❌"} ${gesture}: ${state.result?.value}`,
    );

    const shot = (await send("Page.captureScreenshot", { format: "png" })) as {
      data: string;
    };
    writeFileSync(
      `jarvis-gesto-${gesture}.png`,
      Buffer.from(shot.data, "base64"),
    );
  }

  console.log(
    failures === 0
      ? "\\n🙌 los 14 gestos mueven brazos/cabeza 👌"
      : `\\n⚠️ ${failures} gestos no movieron los huesos`,
  );

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
