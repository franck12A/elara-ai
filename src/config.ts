import "dotenv/config";

export type AIProviderName = "claude" | "groq";

export interface Config {
  aiProvider: AIProviderName;
  anthropic: {
    apiKey: string | undefined;
    baseUrl: string | undefined;
    model: string;
  };
  groq: {
    apiKey: string | undefined;
    model: string;
    timeoutMs: number;
  };
  elevenlabs: {
    apiKey: string;
    voiceId: string;
    model: string;
  };
}

const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_TIMEOUT_MS = 60_000;

export interface ValidateConfigOptions {
  requireVoice?: boolean;
}

export function validateConfig(options?: ValidateConfigOptions): Config {
  const aiProvider = (process.env.AI_PROVIDER || "groq") as AIProviderName;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL || undefined;
  const claudeModel = process.env.CLAUDE_MODEL || "claude-opus-4-1";
  const groqApiKey = process.env.GROQ_API_KEY;
  const groqModel = process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
  const groqTimeoutMs = parseTimeout(process.env.GROQ_TIMEOUT_MS);
  const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
  const elevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID;
  const elevenLabsModel =
    process.env.ELEVENLABS_MODEL || "eleven_v3";

  const errors: string[] = [];

  if (aiProvider !== "claude" && aiProvider !== "groq") {
    errors.push(
      `AI_PROVIDER inválido ("${aiProvider}"). Usá "claude" o "groq".`,
    );
  }

  if (aiProvider === "claude" && !anthropicApiKey) {
    errors.push("ANTHROPIC_API_KEY no está configurada en .env");
  }

  if (aiProvider === "groq" && !groqApiKey) {
    errors.push("GROQ_API_KEY no está configurada en .env");
  }

  const requireVoice = options?.requireVoice ?? true;

  if (requireVoice) {
    if (!elevenLabsApiKey) {
      errors.push("ELEVENLABS_API_KEY no está configurada en .env");
    }

    if (!elevenLabsVoiceId) {
      errors.push("ELEVENLABS_VOICE_ID no está configurada en .env");
    }
  }

  if (errors.length > 0) {
    console.error(
      "\n❌ Error de configuración:\n",
      errors.map((e) => `  • ${e}`).join("\n"),
    );
    console.error(
      "\nPor favor, crea un archivo .env con las variables requeridas.",
    );
    console.error("Puedes usar .env.example como plantilla.\n");
    process.exit(1);
  }

  return {
    aiProvider,
    anthropic: {
      apiKey: anthropicApiKey,
      baseUrl: anthropicBaseUrl,
      model: claudeModel,
    },
    groq: {
      apiKey: groqApiKey,
      model: groqModel,
      timeoutMs: groqTimeoutMs,
    },
    elevenlabs: {
      apiKey: elevenLabsApiKey ?? "",
      voiceId: elevenLabsVoiceId ?? "",
      model: elevenLabsModel,
    },
  };
}

function parseTimeout(value: string | undefined): number {
  if (!value) {
    return DEFAULT_TIMEOUT_MS;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}
