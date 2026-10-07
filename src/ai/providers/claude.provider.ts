import Anthropic from "@anthropic-ai/sdk";
import { JARVIS_PERSONALITY } from "../personality.js";
import type { ConversationMessage } from "../conversation.js";
import type { JarvisTool } from "../tools.js";
import type {
  AIProvider,
  GenerateOptions,
  ProviderResponse,
  ToolResultOptions,
} from "./ai.provider.js";

interface ClaudeToolContext {
  stopReason: string | null;
  toolCallId?: string | undefined;
  toolName?: string | undefined;
}

export class ClaudeProvider implements AIProvider {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    apiKey: string,
    model: string = "claude-opus-4-1",
    baseUrl?: string,
  ) {
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY no está configurada.");
    }

    this.client = new Anthropic({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });

    this.model = model;
  }

  async generateResponse(
    messages: ConversationMessage[],
    options: GenerateOptions = {},
  ): Promise<ProviderResponse> {
    const requestBody: Anthropic.Messages.MessageCreateParams = {
      model: this.model,
      max_tokens: 1024,
      system: options.system ?? JARVIS_PERSONALITY,
      messages: messages.map((msg) => ({
        role: msg.role === "user" ? ("user" as const) : ("assistant" as const),
        content: msg.content,
      })),
    };

    this.attachTools(requestBody, options.tools ?? []);

    const response = await this.client.messages.create(requestBody);

    return toProviderResponse(response);
  }

  async generateToolResultResponse(
    messages: ConversationMessage[],
    options: ToolResultOptions,
  ): Promise<ProviderResponse> {
    const { toolCall, toolContext, result, toolHistory = [] } = options;

    const claudeMessages: Anthropic.Messages.MessageParam[] = messages.map(
      (msg) => ({
        role: msg.role === "user" ? ("user" as const) : ("assistant" as const),
        content: msg.content,
      }),
    );

    // Rondas anteriores del mismo turno (si las hubo).
    for (const exchange of toolHistory) {
      claudeMessages.push({
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: exchange.id,
            name: exchange.name,
            input: exchange.args ?? {},
          },
        ],
      });
      claudeMessages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: exchange.id,
            content: exchange.result,
          },
        ],
      });
    }

    claudeMessages.push({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.name,
          // Argumentos reales: si no, Claude "olvida" qué pidió.
          input: (toolCall.args ?? {}) as Record<string, unknown>,
        },
      ],
    });

    claudeMessages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: result,
        },
      ],
    });

    const requestBody: Anthropic.Messages.MessageCreateParams = {
      model: this.model,
      max_tokens: 1024,
      system: options.system ?? JARVIS_PERSONALITY,
      messages: claudeMessages,
    };

    this.attachTools(requestBody, options.tools ?? []);

    const response = await this.client.messages.create(requestBody);
    const providerResponse = toProviderResponse(response);

    if (providerResponse.toolCall && toolContext) {
      providerResponse.toolContext = toolContext;
    }

    return providerResponse;
  }

  private attachTools(
    requestBody: Anthropic.Messages.MessageCreateParams,
    tools: JarvisTool[],
  ): void {
    if (tools.length === 0) return;

    requestBody.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: "object" as const,
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      },
    }));
  }
}

function toProviderResponse(
  response: Anthropic.Messages.Message,
): ProviderResponse {
  const toolUse = response.content.find((block) => block.type === "tool_use");

  // Si pidió una herramienta, seguimos por ahí (aunque venga con texto pegado).
  if (toolUse && toolUse.type === "tool_use") {
    return {
      toolCall: {
        id: toolUse.id,
        name: toolUse.name,
        args: (toolUse.input ?? {}) as Record<string, string>,
      },
      toolContext: {
        stopReason: response.stop_reason,
        toolCallId: toolUse.id,
        toolName: toolUse.name,
      } satisfies ClaudeToolContext,
    };
  }

  const text = response.content.find((block) => block.type === "text");

  if (text && text.type === "text") {
    return { text: text.text };
  }

  return { text: "No pude generar una respuesta." };
}
