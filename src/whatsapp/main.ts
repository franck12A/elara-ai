import { validateConfig } from "../config.js";
import { Jarvis } from "../jarvis.js";
import { reminderFirePrompt } from "../ai/reminders.js";
import { VoiceService } from "../voice/voice.service.js";
import { WhatsAppBridge, type ReplyMode } from "./bridge.js";

const AUTH_DIR_DEFAULT = "wa_auth";

async function main(): Promise<void> {
  const replyMode = parseReplyMode(process.env.WA_REPLY_MODE);
  const ownerNumber = digits(process.env.WA_OWNER_NUMBER);
  const pairingNumber = digits(process.env.WA_PAIRING_NUMBER);
  const proactiveTimes = parseTimes(process.env.WA_PROACTIVE_TIMES);

  // En modo solo texto la voz de ElevenLabs no hace falta.
  const config = validateConfig({ requireVoice: replyMode !== "text" });

  const jarvis = new Jarvis(config);
  await jarvis.initialize();

  const voice = new VoiceService(config.elevenlabs);

  const bridge = new WhatsAppBridge(jarvis, voice, {
    authDir: process.env.WA_AUTH_DIR || AUTH_DIR_DEFAULT,
    pairingNumber,
    ownerNumber,
    replyMode,
    proactiveTimes,
  });

  await bridge.start();

  // Los recordatorios que agende Jarvis se entregan por WhatsApp.
  jarvis.reminders.start((reminder, overdueMs) => {
    void (async () => {
      console.log(`⏰ Recordatorio: ${reminder.message}`);
      const text = await jarvis
        .chat(reminderFirePrompt(reminder, overdueMs))
        .catch(
          () => `⏰ Recordatorio: ${reminder.message}`,
        );
      await bridge.notifyOwner(text).catch((error: unknown) => {
        console.error("❌ Error entregando recordatorio:", error);
      });
    })();
  });

  console.log("💬 Jarvis está en WhatsApp. Escribile desde tu celular.");

  const shutdown = async (): Promise<void> => {
    console.log("\nCerrando conexión de WhatsApp…");
    await bridge.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function digits(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/\D/g, "");
  return cleaned ? cleaned : undefined;
}

function parseReplyMode(value: string | undefined): ReplyMode {
  if (value === "text" || value === "voice" || value === "both") {
    return value;
  }
  return "voice";
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
