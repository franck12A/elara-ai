import Groq from "groq-sdk";
import { JARVIS_PERSONALITY } from "../personality.js";
import type { ConversationMessage } from "../conversation.js";
import type { JarvisTool } from "../tools.js";
import type {
  AIProvider,
  GenerateOptions,
  ProviderResponse,
  ToolExchange,
  ToolResultOptions,
} from "./ai.provider.js";

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
    options: GenerateOptions = {},
  ): Promise<ProviderResponse> {
    const tools = options.tools ?? [];

    const completion = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 1024,
      messages: [
        { role: "system", content: options.system ?? JARVIS_PERSONALITY },
        ...messages.map(toMessageParam),
      ],
      ...(tools.length > 0
        ? {
            tools: tools.map(toGroqTool),
            tool_choice: "auto" as const,
          }
        : {}),
    });

    return toProviderResponse(completion);
  }

  async generateToolResultResponse(
    messages: ConversationMessage[],
    options: ToolResultOptions,
  ): Promise<ProviderResponse> {
    const tools = options.tools ?? [];
    const { toolCall, toolContext, result, toolHistory = [] } = options;

    const trail = toolHistory.flatMap((exchange) =>
      toGroqToolExchange(exchange),
    );

    const completion = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 1024,
      messages: [
        { role: "system", content: options.system ?? JARVIS_PERSONALITY },
        ...messages.map(toMessageParam),
        ...trail,
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: toolCall.id,
              type: "function" as const,
              function: {
                name: toolCall.name,
                // Los argumentos reales: si no, el modelo "olvida" qué pidió.
                arguments: JSON.stringify(toolCall.args ?? {}),
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

    const response = toProviderResponse(completion);

    // Si vuelve a pedir otra herramienta, conservamos el contexto de la
    // anterior para que la ronda siguiente pueda reconstruirla.
    if (response.toolCall && toolContext) {
      response.toolContext = {
        ...(toolContext as object),
        previousToolCalls: [
          ...((toolContext as { previousToolCalls?: unknown[] })
            .previousToolCalls ?? []),
          { name: toolCall.name, args: toolCall.args, result },
        ],
      };
    }

    return response;
  }
}

function toProviderResponse(
  completion: Groq.Chat.ChatCompletion,
): ProviderResponse {
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

/** Ronda vieja de herramienta: assistant(tool_calls) + tool(result). */
function toGroqToolExchange(
  exchange: ToolExchange,
): Groq.Chat.ChatCompletionMessageParam[] {
  return [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: exchange.id,
          type: "function" as const,
          function: {
            name: exchange.name,
            arguments: JSON.stringify(exchange.args ?? {}),
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: exchange.id,
      content: exchange.result,
    },
  ];
}

function toMessageParam(
  message: ConversationMessage,
): Groq.Chat.ChatCompletionMessageParam {
  return {
    role: message.role === "user" ? "user" : "assistant",
    content: message.content,
  };
}

function toGroqTool(tool: JarvisTool): Groq.Chat.ChatCompletionTool {
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
