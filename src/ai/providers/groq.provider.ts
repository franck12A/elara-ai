import Groq from "groq-sdk";
import { ELARA_PERSONALITY } from "../personality.js";
import type { ConversationMessage } from "../conversation.js";
import type { ElaraTool } from "../tools.js";
import type { AIProvider, ProviderResponse } from "./ai.provider.js";

export interface GroqOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}

interface GroqToolContext {
  stopReason: string | null;
  toolCallId: string;
  toolName: string;
}

const DEFAULT_MODEL = "openai/gpt-oss-120b";
const DEFAULT_TIMEOUT_MS = 60_000;

export class GroqProvider implements AIProvider {
  private readonly client: Groq;
  private readonly model: string;

  constructor(options: GroqOptions) {
    if (!options.apiKey) {
      throw new Error("GROQ_API_KEY no está configurada.");
    }

    this.client = new Groq({
      apiKey: options.apiKey,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });

    this.model = options.model || DEFAULT_MODEL;
  }

  async generateResponse(
    messages: ConversationMessage[],
    tools: ElaraTool[] = [],
  ): Promise<ProviderResponse> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 1024,
      messages: [
        { role: "system", content: ELARA_PERSONALITY },
        ...messages.map(toMessageParam),
      ],
      ...(tools.length > 0
        ? {
            tools: tools.map(toGroqTool),
            tool_choice: "auto" as const,
          }
        : {}),
    });

    const choice = completion.choices[0];
    const message = choice?.message;

    if (message?.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls[0];

      if (!toolCall) {
        throw new Error("Groq respondió con una llamada de herramienta vacía.");
      }

      return {
        toolCall: {
          id: toolCall.id,
          name: toolCall.function.name,
          args: parseToolArgs(toolCall.function.arguments),
        },
        toolContext: {
          stopReason: choice?.finish_reason ?? null,
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
        } satisfies GroqToolContext,
      };
    }

    return {
      text: message?.content ?? "No pude generar una respuesta.",
    };
  }

  async generateToolResultResponse(
    messages: ConversationMessage[],
    tools: ElaraTool[],
    _toolContext: unknown,
    toolCall: {
      id: string;
      name: string;
    },
    result: string,
  ): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 1024,
      messages: [
        { role: "system", content: ELARA_PERSONALITY },
        ...messages.map(toMessageParam),
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: toolCall.id,
              type: "function" as const,
              function: {
                name: toolCall.name,
                arguments: "{}",
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        },
      ],
      ...(tools.length > 0
        ? {
            tools: tools.map(toGroqTool),
            tool_choice: "auto" as const,
          }
        : {}),
    });

    return (
      completion.choices[0]?.message?.content ??
      "No pude generar una respuesta."
    );
  }
}

function toMessageParam(
  message: ConversationMessage,
): Groq.Chat.ChatCompletionMessageParam {
  return {
    role: message.role === "user" ? "user" : "assistant",
    content: message.content,
  };
}

function toGroqTool(tool: ElaraTool): Groq.Chat.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      },
    },
  };
}

function parseToolArgs(raw: string): Record<string, string> {
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}
