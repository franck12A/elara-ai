/**
 * Smoke test del servidor de la cara + la página pixel.
 *   npx tsx scripts/smoke-face.ts
 * Levanta el server con handlers simulados, pega los endpoints y carga la
 * página en Chrome headless para cazar errores de JavaScript.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { startFaceServer } from "../src/face/face.server.js";

const PORT = 4399;
const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

function assert(condition: unknown, label: string): void {
  if (condition) {
    console.log(`  ✔ ${label}`);
  } else {
    console.error(`  ✘ ${label}`);
    process.exitCode = 1;
  }
}

const server = await startFaceServer(PORT, {
  onChat: async (text) => ({
    display: `holi, me dijiste: ${text}`,
    emotion: "happy",
    audio: undefined,
  }),
  onTranscribe: async () => "esto es una prueba",
});

console.log(`\n1) Endpoints (${server.url})`);

const html = await (await fetch(server.url + "/")).text();
assert(html.includes('id="face"'), "GET / devuelve la app (canvas presente)");
assert(html.includes("/api/chat"), "GET / incluye el cliente de chat");

const health = (await (await fetch(server.url + "/health")).json()) as {
  ok: boolean;
};
assert(health.ok === true, "GET /health ok");

const chat = (await (
  await fetch(server.url + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "hola jarvis" }),
  })
).json()) as { ok: boolean; reply?: { display?: string; emotion?: string } };
assert(chat.ok === true, "POST /api/chat responde ok");
assert(
  chat.reply?.display?.includes("hola jarvis") ?? false,
  "POST /api/chat devuelve la respuesta simulada",
);
assert(chat.reply?.emotion === "happy", "POST /api/chat trae la emoción");

const transcribe = (await (
  await fetch(server.url + "/api/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audio: Buffer.from("hola").toString("base64"), ext: "webm" }),
  })
).json()) as { ok: boolean; text?: string };
assert(transcribe.ok === true && transcribe.text === "esto es una prueba", "POST /api/transcribe");

// SSE: tiene que llegarnos un evento broadcasteado.
console.log("\n2) Eventos SSE");
const controller = new AbortController();
const events: string[] = [];
const sseDone = (async () => {
  const res = await fetch(server.url + "/events", { signal: controller.signal });
    if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!buffer.includes('"status":"thinking"')) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value);
    if (buffer.length > 4096) break;
  }
  events.push(buffer);
  controller.abort();
})();

// Dejamos que la conexión se abra antes de emitir.
setTimeout(() => {
  server.broadcast({ type: "status", status: "thinking" });
}, 400);

await Promise.race([
  sseDone,
  new Promise<void>((resolve) => setTimeout(resolve, 6000)),
]);
assert(
  events.join("").includes('"status":"thinking"'),
  "broadcast llega por /events",
);

// Página en Chrome headless: errores de consola = código roto.
console.log("\n3) Página en Chrome headless");
const chrome = CHROME_PATHS.find((p) => existsSync(p));

if (!chrome) {
  console.log("  ⚠ Chrome no encontrado; salteo la prueba de la página.");
} else {
  await new Promise<void>((resolve) => {
    execFile(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-extensions",
        "--disable-background-networking",
        "--enable-logging=stderr",
        "--v=0",
        "--dump-dom",
        server.url + "/",
      ],
      { timeout: 25000, maxBuffer: 1024 * 1024 * 8 },
      (error, stdout, stderr) => {
        // Solo los mensajes de consola de la página; el resto del ruido es
        // de Chrome (actualizador, extensiones, GCM…).
        const consoleLines = stderr
          .split("\n")
          .filter((line) => line.includes("CONSOLE("));
        const realErrors = consoleLines.filter((line) =>
          /error|uncaught|exception/i.test(line),
        );

        if (realErrors.length > 0) {
          console.error("  ✘ errores de consola:");
          for (const line of realErrors.slice(0, 12)) {
            console.error(`      ${line.trim()}`);
          }
          process.exitCode = 1;
        } else {
          assert(true, "sin errores de JavaScript en la página");
        }

        assert(
          stdout.includes("holi"),
          "la página arrancó (mensaje de bienvenida presente)",
        );

        if (error && error.killed) {
          console.warn("  ⚠ Chrome no terminó a tiempo (seguía abierto el SSE).");
        }
        resolve();
      },
    );
  });
}

await server.close();
console.log(
  process.exitCode === 1
    ? "\n❌ Smoke test con fallos.\n"
    : "\n✅ Smoke test OK.\n",
);
