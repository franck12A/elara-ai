import { Conversation } from "./ai/conversation.js";
import { MemoryService } from "./ai/memory.js";
import type { AIProvider } from "./ai/providers/ai.provider.js";
import {
  createMemoryTool,
  createGetMemoryTool,
  createSearchMemoryTool,
} from "./ai/memory.tool.js";
import type { ElaraTool } from "./ai/tools.js";
import { createAIProvider } from "./ai/providers/index.js";
import type { Config } from "./config.js";

export class Elara {
  private readonly ai: AIProvider;
  private readonly conversation: Conversation;
  private readonly memory: MemoryService;
  private readonly tools: ElaraTool[];

  constructor(config: Config) {
    this.ai = createAIProvider(config);
    this.conversation = new Conversation();
    this.memory = new MemoryService();

    this.tools = [
      createMemoryTool(this.memory),
      createGetMemoryTool(this.memory),
      createSearchMemoryTool(this.memory),
    ];
  }

  async initialize(): Promise<void> {
    await this.memory.load();
  }

  async chat(message: string): Promise<string> {
    this.conversation.addUserMessage(message);

    const response = await this.ai.generateResponse(
      this.conversation.getMessages(),
      this.tools,
    );

    if (response.toolCall) {
      const tool = this.tools.find(
        (tool) => tool.name === response.toolCall?.name,
      );

      if (!tool) {
        return `No conozco la herramienta "${response.toolCall.name}".`;
      }

      if (!response.toolContext) {
        return "No pude procesar la llamada de la herramienta.";
      }

      const result = await tool.execute(
        response.toolCall.args,
      );

      const finalResponse =
        await this.ai.generateToolResultResponse(
          this.conversation.getMessages(),
          this.tools,
          response.toolContext,
          response.toolCall,
          result,
        );

      this.conversation.addModelMessage(finalResponse);

      return finalResponse;
    }

    const text = response.text ?? "No pude generar una respuesta.";

    this.conversation.addModelMessage(text);

    return text;
  }

  async remember(key: string, value: string): Promise<void> {
    await this.memory.save(key, value);
  }

  getMemory(key: string): string | undefined {
    return this.memory.get(key);
  }
}