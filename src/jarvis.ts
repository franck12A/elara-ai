import { Conversation, type ConversationMessage } from "./ai/conversation.js";
import { MemoryService } from "./ai/memory.js";
import {
  buildSystemPrompt,
  formatSince,
  SUMMARIZE_SYSTEM,
} from "./ai/prompt.js";
import { Reflector } from "./ai/reflection.js";
import { StateService } from "./ai/state.js";
import type { AIProvider, ToolExchange } from "./ai/providers/ai.provider.js";
import {
  createMemoryTool,
  createGetMemoryTool,
  createSearchMemoryTool,
} from "./ai/memory.tool.js";
import type { JarvisTool } from "./ai/tools.js";
import { createAIProvider } from "./ai/providers/index.js";
import { ReminderService } from "./ai/reminders.js";
import {
  createSetReminderTool,
  createListRemindersTool,
  createCancelReminderTool,
} from "./ai/reminders.tool.js";
import { createWeatherTool } from "./ai/weather.tool.js";
import { createComputerTool } from "./ai/computer.tool.js";
import type { Config } from "./config.js";

/** Rondas máximas de herramientas antes de responder (agendar, buscar…). */
const MAX_TOOL_ROUNDS = 5;
/** Cada cuántos mensajes del usuario reflexiona sobre la charla. */
const REFLECT_EVERY = 5;
/** Mensajes de cola que ve el reflejo cada vez. */
const REFLECT_WINDOW = 14;

export class Jarvis {
  private readonly ai: AIProvider;
  private readonly conversation: Conversation;
  private readonly memory: MemoryService;
  private readonly state: StateService;
  private readonly reflector: Reflector;
  private readonly tools: JarvisTool[];
  /** Recordatorios: los canales llaman a start() para entregarlos. */
  readonly reminders = new ReminderService();
  private messagesSinceReflect = 0;

  constructor(config: Config) {
    this.ai = createAIProvider(config);
    this.conversation = new Conversation();
    this.memory = new MemoryService();
    this.state = new StateService();
    this.reflector = new Reflector(this.ai, this.memory, this.state);

    this.tools = [
      createMemoryTool(this.memory),
      createGetMemoryTool(this.memory),
      createSearchMemoryTool(this.memory),
      createSetReminderTool(this.reminders),
      createListRemindersTool(this.reminders),
      createCancelReminderTool(this.reminders),
      createWeatherTool(config.weather.location),
      createComputerTool(),
    ];
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.memory.load(),
      this.state.load(),
      this.conversation.load(),
      this.reminders.load(),
    ]);

    if (this.conversation.shouldRoll()) {
      await this.conversation.roll((old) => this.summarize(old));
      console.log(
        `📚 Memoria a largo plazo: ${this.memory.count()} recuerdos, ` +
          `conversación reducida a ${
            this.conversation.getMessages().length
          } mensajes.`,
      );
    }
  }

  async chat(message: string): Promise<string> {
    const lastTalkAt = this.conversation.getLastAt();
    this.conversation.addUserMessage(message);

    try {
      const reply = await this.respond(lastTalkAt);
      this.conversation.addModelMessage(reply);
      this.maybeReflect();
      return reply;
    } catch (error) {
      // El turno quedó a medias: deshacemos su mensaje para no dejar la
      // conversación en un estado que el modelo no puede leer después.
      this.conversation.discardLastUserMessage();
      throw error;
    }
  }

  private async respond(lastTalkAt: number | undefined): Promise<string> {
    const system = buildSystemPrompt({
      summary: this.conversation.getSummary(),
      sinceLast: lastTalkAt ? formatSince(lastTalkAt) : undefined,
      memories: this.memory
        .recent(15)
        .map(({ key, value }) => ({ key, value })),
      stateNote: this.state.toPromptLine(),
    });

    const messages = this.conversation.getMessages();
    const toolHistory: ToolExchange[] = [];

    let response = await this.ai.generateResponse(messages, {
      tools: this.tools,
      system,
    });

    let text: string | undefined;

    // Rondas de herramientas: puede guardar un recuerdo y después buscar otro
    // antes de contestar, como quien piensa y después habla.
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (!response.toolCall) {
        text = response.text;
        break;
      }

      const call = response.toolCall;
      const tool = this.tools.find((candidate) => candidate.name === call.name);

      if (!tool || !response.toolContext) {
        text =
          response.text ??
          `No pude procesar la llamada de herramienta "${call.name}".`;
        break;
      }

      const result = await tool.execute(call.args);

      toolHistory.push({
        id: call.id,
        name: call.name,
        args: call.args,
        result,
      });

      response = await this.ai.generateToolResultResponse(messages, {
        tools: this.tools,
        system,
        toolContext: response.toolContext,
        toolCall: call,
        result,
        toolHistory: toolHistory.slice(0, -1),
      });
    }

    return text ?? response.text ?? "No pude generar una respuesta.";
  }

  async remember(key: string, value: string): Promise<void> {
    await this.memory.save(key, value);
  }

  getMemory(key: string): string | undefined {
    return this.memory.get(key);
  }

  /** Fuerza el guardado de la conversación (antes de apagar el proceso). */
  async flush(): Promise<void> {
    await this.conversation.save();
    this.reminders.stop();
  }

  /** Resumen de conversaciones viejas para el prompt de largo plazo. */
  private async summarize(
    oldMessages: ConversationMessage[],
  ): Promise<string> {
    const response = await this.ai.generateResponse(oldMessages, {
      system: SUMMARIZE_SYSTEM,
    });
    return (response.text ?? "").trim();
  }

  /** Cada varios mensajes, anota recuerdos y actualiza su estado interno. */
  private maybeReflect(): void {
    this.messagesSinceReflect += 1;
    if (this.messagesSinceReflect < REFLECT_EVERY) return;

    this.messagesSinceReflect = 0;
    const tail = this.conversation.getRecentMessages(REFLECT_WINDOW);
    void this.reflector.reflect(tail);
  }
}
