import type { Config } from "../../config.js";
import type { AIProvider } from "./ai.provider.js";
import { ClaudeProvider } from "./claude.provider.js";
import { GroqProvider } from "./groq.provider.js";

export function createAIProvider(config: Config): AIProvider {
  if (config.aiProvider === "groq") {
    return new GroqProvider({
      apiKey: config.groq.apiKey ?? "",
      model: config.groq.model,
      timeoutMs: config.groq.timeoutMs,
    });
  }

  if (!config.anthropic.apiKey) {
    throw new Error("ANTHROPIC_API_KEY no está configurada.");
  }

  return new ClaudeProvider(
    config.anthropic.apiKey,
    config.anthropic.model,
    config.anthropic.baseUrl,
  );
}
