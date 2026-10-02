import "dotenv/config";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { playAudio } from "../src/voice/audio-player.js";

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

const voiceId = process.env.ELEVENLABS_VOICE_ID!;

const models = [
  "eleven_v3",
  "eleven_flash_v2_5",
  "eleven_turbo_v2_5",
  "eleven_multilingual_v2",
];

const available: string[] = [];

for (const modelId of models) {
  try {
    const audio = await client.textToSpeech.convert(voiceId, {
      text: "Hola Fran, qué gusto escucharte.",
      modelId,
      outputFormat: "wav_22050",
    });

    const reader = audio.getReader();
    let bytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) bytes += value.length;
    }

    available.push(modelId);
    console.log(`✅ ${modelId} (${bytes} bytes)`);
  } catch (error) {
    const message =
      error instanceof Error ? error.message.split("\n")[0] : String(error);
    console.log(`❌ ${modelId}: ${message}`);
  }
}

if (available.includes("eleven_v3")) {
  console.log("\n🔊 Muestra emocional con eleven_v3...");

  const audio = await client.textToSpeech.convert(voiceId, {
    text: "Fran, ¡qué alegría verte! [excited] Me tenía preocupada... [whispers] Pero acá estás.",
    modelId: "eleven_v3",
    outputFormat: "wav_22050",
  });

  await playAudio(audio);
  console.log("✅ Muestra terminada.");
} else {
  console.log("\n⚠️  eleven_v3 no está disponible con esta API key.");
}
