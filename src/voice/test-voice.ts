import { validateConfig } from "../config.js";
import { VoiceService } from "./voice.service.js";
import { playAudio } from "./audio-player.js";

async function main(): Promise<void> {
  const config = validateConfig();
  const voice = new VoiceService(config.elevenlabs);

  console.log("🎙️ Generando voz de Jarvis...");

  const audio = await voice.generateSpeech(
    "Hola bro. Soy Jarvis y finalmente tengo voz.",
  );

  console.log("🔊 Reproduciendo...");

  await playAudio(audio);

  console.log("✅ Audio terminado.");
}

main().catch((error: unknown) => {
  console.error("❌ Error:", error);
});