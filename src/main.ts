import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { validateConfig } from "./config.js";
import { Elara } from "./elara.js";
import { VoiceService } from "./voice/voice.service.js";
import { playAudio } from "./voice/audio-player.js";
import { FaceService } from "./face/face.service.js";

const config = validateConfig();

const elara = new Elara(config);
const voice = new VoiceService(config.elevenlabs);
const face = new FaceService();

const readline = createInterface({
  input,
  output,
});

async function main(): Promise<void> {
  await elara.initialize();
  await face.start();

  console.log("🤖 Elara está despierta.");
  console.log("Escribí 'salir' para cerrar la conversación.\n");

  while (true) {
    let message: string;

    try {
      message = await readline.question("Tú: ");
    } catch {
      // stdin cerrado (EOF): salir con gracia.
      break;
    }

    if (message.trim().toLowerCase() === "salir") {
      console.log("\n🤖 Elara: Nos vemos bro 👋");
      await face.stop();
      break;
    }

    if (!message.trim()) {
      continue;
    }

    try {    const response = await elara.chat(message);

    // Los tags de emoción ([excited], etc.) los interpretan ElevenLabs v3
    // y la cara de Elara, pero no deben mostrarse en la terminal.
    const displayText = response.replace(/\[[^\]]+\]/g, "").trim();

    face.expressFromText(response);
    console.log(`Elara: ${displayText}\n`);

    console.log("🔊 Elara está hablando...");

    face.startSpeaking();

    try {
      const audio = await voice.generateSpeech(response);
      await playAudio(audio);
    } finally {
      face.stopSpeaking();
    }
    } catch (error) {
      console.error("❌ Error al hablar con Elara:", error);
    }
  }

  readline.close();
}

main().catch((error: unknown) => {
  console.error("❌ Error inesperado:", error);
  readline.close();
});