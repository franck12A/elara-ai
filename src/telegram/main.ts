import { createServer } from "node:http";

import { validateConfig } from "../config.js";
import { Elara } from "../elara.js";
import { VoiceService } from "../voice/voice.service.js";
import { ElaraTelegramBot, type ReplyMode } from "./bot.js";

async function main(): Promise<void> {
  const token = process.env.TG_BOT_TOKEN?.trim();

  if (!token) {
    console.error(
      "\n❌ Falta TG_BOT_TOKEN en .env.\n" +
        "1. Abrí Telegram y buscá a @BotFather.\n" +
        "2. Mandale /newbot y seguí los pasos (elegí nombre y username).\n" +
        "3. Copiá el token que te da (algo como 123456:ABC-DEF...) y pegalo\n" +
        "   en .env como TG_BOT_TOKEN=tu_token\n",
    );
    process.exit(1);
  }

  const replyMode = parseReplyMode(process.env.TG_REPLY_MODE);

  // En modo solo texto la voz de ElevenLabs no hace falta.
  const config = validateConfig({ requireVoice: replyMode !== "text" });

  const elara = new Elara(config);
  await elara.initialize();

  const voice = new VoiceService(config.elevenlabs);

  const bot = new ElaraTelegramBot(elara, voice, {
    token,
    ownerId: process.env.TG_OWNER_ID?.trim() || undefined,
    replyMode,
    proactiveTimes: parseTimes(process.env.TG_PROACTIVE_TIMES),
    spontaneousWindow: process.env.TG_SPONTANEOUS_WINDOW?.trim() || undefined,
    spontaneousMinMinutes: parseNumber(process.env.TG_SPONTANEOUS_MIN_MINUTES),
    spontaneousMaxMinutes: parseNumber(process.env.TG_SPONTANEOUS_MAX_MINUTES),
  });

  await bot.start();

  // Fly.io hace health checks HTTP contra internal_port (3000). En local no
  // se abre el puerto para no chocar con otros servidores.
  if (process.env.FLY_MACHINE_ID) {
    const port = Number(process.env.PORT) || 3000;
    createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("elara ok");
    }).listen(port, () => {
      console.log(`🩺 Health check escuchando en el puerto ${port}.`);
    });
  }

  console.log("💬 Escribile a Elara desde Telegram (celular o desktop).");

  const shutdown = async (): Promise<void> => {
    console.log("\nCerrando conexión de Telegram…");
    await bot.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function parseReplyMode(value: string | undefined): ReplyMode {
  if (
    value === "text" ||
    value === "voice" ||
    value === "both" ||
    value === "mixed"
  ) {
    return value;
  }
  return "voice";
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseTimes(value: string | undefined): string[] {
  if (!value) return [];

  return value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t));
}

main().catch((error: unknown) => {
  console.error("❌ Error inesperado:", error);
  process.exit(1);
});
