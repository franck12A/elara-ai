import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

export interface VoiceConfig {
  apiKey: string;
  voiceId: string;
  model: string;
}

export class VoiceService {
  private readonly client: ElevenLabsClient;
  private readonly voiceId: string;
  private readonly model: string;

  constructor(config: VoiceConfig) {
    const { apiKey, voiceId, model } = config;

    if (!apiKey) {
      throw new Error("ELEVENLABS_API_KEY no está configurada.");
    }

    if (!voiceId) {
      throw new Error("ELEVENLABS_VOICE_ID no está configurada.");
    }

    this.client = new ElevenLabsClient({
      apiKey,
    });

    this.voiceId = voiceId;
    this.model = model;
  }

  async generateSpeech(
    text: string,
  ): Promise<ReadableStream<Uint8Array>> {
    const audio = await this.client.textToSpeech.convert(
      this.voiceId,
      {
        text,
        modelId: this.model,
        outputFormat: "wav_22050",
      },
    );

    return audio;
  }
}