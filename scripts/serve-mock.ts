/**
 * Previsualización de la cara sin claves de API ni Jarvis real:
 * levanta la app, abre la ventana de escritorio y responde con texto simulado.
 *   npm run face
 * (Ctrl+C para cerrar)
 */
import {
  openFaceWindow,
  startFaceServerWithFallback,
} from "../src/face/face.service.js";

const PORT = Number(process.env.FACE_PORT) || 4321;

const MOCK_REPLIES = [
  ["holi 🌙 soy la versión de prueba, no estoy conectada a Jarvis de verdad", "happy"],
  ["jajaja me encantó esa, ahora probá `npm run dev` para charlar conmigo posta", "happy"],
  ["uh, esta versión no tiene voz todavía. con `npm run dev` sí 🎤", "shy"],
  ["estoy acá, mirame nomás. la boca la mueve el audio de verdad", "surprised"],
  ["¿todo bien? probá el micrófono ahí abajo 👀", "neutral"],
] as const;

let replyIndex = 0;

const server = await startFaceServerWithFallback({
  onChat: async (text) => {
    const [display, emotion] =
      MOCK_REPLIES[replyIndex % MOCK_REPLIES.length];
    replyIndex += 1;
    console.log(`💬 "${text}" → ${display}`);
    return { display, emotion, audio: undefined };
  },
  onTranscribe: async () => "esto es una prueba de transcripción",
});

if (!server) {
  console.error(
    `❌ No hay puerto libre entre ${PORT} y ${PORT + 5}. ` +
      "¿Quedó un npm run dev colgado? Cerralo y volvé a probar.",
  );
  process.exit(1);
}

console.log(`\n🧪 Modo prueba (sin API keys): ${server.url}`);
console.log("   Abrí la ventana y escribile. Ctrl+C para cerrar.\n");

openFaceWindow(server.url);

// Uso: `npx tsx scripts/serve-mock.ts --seconds=20` para auto-cortar
// (lo usamos en los smoke tests para no dejar ventanas abiertas).
const secondsArg = process.argv.find((arg) => arg.startsWith("--seconds="));
if (secondsArg) {
  const seconds = Number(secondsArg.split("=")[1]) || 15;
  setTimeout(() => void shutdown(), seconds * 1000);
}

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  console.log("\nCerrando previsualización…");
  await server.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
