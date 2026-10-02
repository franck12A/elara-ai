import type { ConversationMessage } from "../conversation.js";
import type { ElaraTool } from "../tools.js";

export interface ProviderResponse {
  text?: string;
  toolCall?: {
    id: string;
    name: string;
    args: Record<string, string>;
  };
  toolContext?: unknown;
}

export interface AIProvider {
  generateResponse(
    messages: ConversationMessage[],
    tools?: ElaraTool[],
  ): Promise<ProviderResponse>;

  generateToolResultResponse(
    messages: ConversationMessage[],
    tools: ElaraTool[],
    toolContext: unknown,
    toolCall: {
      id: string;
      name: string;
    },
    result: string,
  ): Promise<string>;
}
