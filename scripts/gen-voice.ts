import { writeFileSync } from "node:fs";
import { validateConfig } from "../src/config.js";
import { VoiceService } from "../src/voice/voice.service.js";

const TEST_TEXT =
  "Hola, soy Jarvis. Estoy hablando frente a la camara. " +
  "Esta es una prueba de lip sync para ver que tan natural se ve.";

async function main(): Promise<void> {
  const config = validateConfig();
  const voice = new VoiceService(config.elevenlabs);

  console.log("Generando audio de prueba con ElevenLabs...");

  const stream = await voice.generateSpeech(TEST_TEXT);
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  writeFileSync("voice.wav", buffer);

  console.log(`voice.wav escrito (${total} bytes)`);
}

main().catch((error: unknown) => {
  console.error("Error:", error);
  process.exit(1);
});
