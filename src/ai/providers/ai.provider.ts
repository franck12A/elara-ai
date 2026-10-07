import type { ConversationMessage } from "../conversation.js";
import type { JarvisTool } from "../tools.js";

export interface ProviderResponse {
  text?: string;
  toolCall?: {
    id: string;
    name: string;
    args: Record<string, string>;
  };
  toolContext?: unknown;
}

export interface GenerateOptions {
  /** Tools disponibles para este turno. */
  tools?: JarvisTool[];
  /**
   * System prompt completo. Si no se pasa, el provider usa la personalidad
   * base sin contexto (fecha, memoria, resumen…).
   */
  system?: string;
}

/** Un intercambio herramienta→resultado ya ocurrido en este turno. */
export interface ToolExchange {
  id: string;
  name: string;
  args: Record<string, string>;
  result: string;
}

export interface ToolResultOptions extends GenerateOptions {
  toolContext: unknown;
  toolCall: {
    id: string;
    name: string;
    args: Record<string, string>;
  };
  result: string;
  /**
   * Intercambios anteriores del mismo turno (el más viejo primero).
   * Sin esto, en la ronda 2 el modelo no vería lo que pidió en la ronda 1.
   */
  toolHistory?: ToolExchange[];
}

export interface AIProvider {
  generateResponse(
    messages: ConversationMessage[],
    options?: GenerateOptions,
  ): Promise<ProviderResponse>;

  /**
   * Devuelve la respuesta following a un resultado de herramienta.
   * Puede volver a pedir otra herramienta (por eso devuelve ProviderResponse
   * y no string).
   */
  generateToolResultResponse(
    messages: ConversationMessage[],
    options: ToolResultOptions,
  ): Promise<ProviderResponse>;
}
