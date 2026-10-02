import Anthropic from "@anthropic-ai/sdk";
import { ELARA_PERSONALITY } from "../personality.js";
import type { ConversationMessage } from "../conversation.js";
import type { ElaraTool } from "../tools.js";
import type { AIProvider, ProviderResponse } from "./ai.provider.js";

interface ClaudeToolContext {
  stopReason: string;
  toolCallId?: string;
  toolName?: string;
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
    tools: ElaraTool[] = [],
  ): Promise<ProviderResponse> {
    const claudeMessages = messages.map((msg) => ({
      role: msg.role === "user" ? ("user" as const) : ("assistant" as const),
      content: msg.content,
    }));

    const requestBody: Anthropic.Messages.MessageCreateParams = {
      model: this.model,
      max_tokens: 1024,
      system: ELARA_PERSONALITY,
      messages: claudeMessages,
    };

    // Agregar tools si existen
    if (tools.length > 0) {
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

    const response = await this.client.messages.create(requestBody);

    // Procesar la respuesta
    for (const block of response.content) {
      if (block.type === "text") {
        return {
          text: block.text,
        };
      }

      if (block.type === "tool_use") {
        return {
          toolCall: {
            id: block.id,
            name: block.name,
            args: (block.input ?? {}) as Record<string, string>,
          },
          toolContext: {
            stopReason: response.stop_reason,
            toolCallId: block.id,
            toolName: block.name,
          },
        };
      }
    }

    return {
      text: "No pude generar una respuesta.",
    };
  }

  async generateToolResultResponse(
    messages: ConversationMessage[],
    tools: ElaraTool[],
    toolContext: unknown,
    toolCall: {
      id: string;
      name: string;
    },
    result: string,
  ): Promise<string> {
    const context = toolContext as ClaudeToolContext | undefined;

    // Construir el historial de mensajes incluyendo la llamada de herramienta
    const claudeMessages: Anthropic.Messages.MessageParam[] = messages.map(
      (msg) => ({
        role: msg.role === "user" ? ("user" as const) : ("assistant" as const),
        content: msg.content,
      }),
    );

    // Agregar el mensaje del asistente con la llamada de herramienta
    claudeMessages.push({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.name,
          input: {} as Record<string, string>,
        },
      ],
    });

    // Agregar el resultado de la herramienta como mensaje del usuario
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
      system: ELARA_PERSONALITY,
      messages: claudeMessages,
    };

    // Incluir tools para que Claude pueda hacer más llamadas si es necesario
    if (tools.length > 0) {
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

    const response = await this.client.messages.create(requestBody);

    // Extraer el texto de la respuesta
    for (const block of response.content) {
      if (block.type === "text") {
        return block.text;
      }
    }

    return "No pude generar una respuesta.";
  }
}
