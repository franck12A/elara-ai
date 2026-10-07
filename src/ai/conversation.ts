import { promises as fs } from "node:fs";
import path from "node:path";

export type MessageRole = "user" | "model";

export interface ConversationMessage {
  role: MessageRole;
  content: string;
  /** Epoch ms en el que se emitió el mensaje (para el "hace cuánto"). */
  at?: number;
}

interface ConversationFile {
  messages: ConversationMessage[];
  summary: string;
  lastAt?: number | undefined;
}

/** Mensajes que se conservan crudos después de un resumen rodante. */
const KEEP_RECENT = 16;
/** A partir de esta cantidad de mensajes se resume lo viejo. */
const ROLL_THRESHOLD = 48;
const SAVE_DEBOUNCE_MS = 800;

export class Conversation {
  private messages: ConversationMessage[] = [];
  private summary = "";
  private lastAt: number | undefined;
  private readonly filePath: string;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private loading = false;

  constructor(filePath?: string) {
    this.filePath =
      filePath ?? path.join(process.cwd(), "data", "conversation.json");
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as ConversationFile;

      this.messages = Array.isArray(parsed.messages) ? parsed.messages : [];
      this.summary = typeof parsed.summary === "string" ? parsed.summary : "";
      this.lastAt =
        typeof parsed.lastAt === "number" ? parsed.lastAt : undefined;
    } catch {
      this.messages = [];
      this.summary = "";
      this.lastAt = undefined;
    } finally {
      this.loading = false;
    }
  }

  async save(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }

    const payload: ConversationFile = {
      messages: this.messages,
      summary: this.summary,
      lastAt: this.lastAt,
    };

    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(
        this.filePath,
        JSON.stringify(payload, null, 2),
        "utf-8",
      );
    } catch (error) {
      console.warn("⚠️  No pude guardar la conversación:", error);
    }
  }

  addUserMessage(content: string): void {
    const now = Date.now();
    this.messages.push({ role: "user", content, at: now });
    this.lastAt = now;
    this.scheduleSave();
  }

  /**
   * Si un turno falló antes de que ella conteste, el mensaje del usuario
   * queda huérfano y rompe el alternado de roles (Claude se queja).
   * Esto lo deshace.
   */
  discardLastUserMessage(): void {
    const last = this.messages[this.messages.length - 1];
    if (last?.role === "user") {
      this.messages.pop();
      this.scheduleSave();
    }
  }

  addModelMessage(content: string): void {
    this.messages.push({ role: "model", content, at: Date.now() });
    this.scheduleSave();
  }

  getMessages(): ConversationMessage[] {
    return [...this.messages];
  }

  /** Últimos N mensajes, para armar el prompt sin mandar todo el historial. */
  getRecentMessages(limit: number): ConversationMessage[] {
    return this.messages.slice(-limit);
  }

  getSummary(): string {
    return this.summary;
  }

  /** Epoch ms de la última conversación, o undefined si no hay. */
  getLastAt(): number | undefined {
    return this.lastAt;
  }

  shouldRoll(): boolean {
    return this.messages.length > ROLL_THRESHOLD;
  }

  get keepRecent(): number {
    return KEEP_RECENT;
  }

  /**
   * Resumen rodante: resume todo lo viejo en `summary` y deja solo los
   * últimos KEEP_RECENT mensajes crudos. Así el contexto no crece para
   * siempre y ella "recuerda" lo de hace días sin gastar tokens de más.
   */
  async roll(
    summarizer: (oldMessages: ConversationMessage[]) => Promise<string>,
  ): Promise<void> {
    if (this.messages.length <= KEEP_RECENT + 4) return;

    const old = this.messages.slice(0, -KEEP_RECENT);
    const recent = this.messages.slice(-KEEP_RECENT);

    let newSummary: string;
    try {
      newSummary = await summarizer(old);
    } catch (error) {
      console.warn("⚠️  No pude resumir la conversación vieja:", error);
      return;
    }

    if (!newSummary.trim()) return;

    const prefix = this.summary.trim();
    this.summary = prefix
      ? `${prefix}\n${newSummary.trim()}`
      : newSummary.trim();
    this.messages = recent;

    // Un solo resumen de seguridad: si quedó gigante, pedimos que lo comprima.
    if (this.summary.length > 4000) {
      try {
        const compressed = await summarizer([
          {
            role: "model",
            content:
              "Resume en menos de 600 palabras, conservando nombres, " +
              `fechas, proyectos y detalles personales:\n\n${this.summary}`,
          },
        ]);
        if (compressed.trim()) this.summary = compressed.trim();
      } catch {
        // dejamos el resumen largo, no es grave.
      }
    }

    await this.save();
  }

  async clear(): Promise<void> {
    this.messages = [];
    this.summary = "";
    await this.save();
  }

  private scheduleSave(): void {
    if (this.loading) return;

    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.save();
    }, SAVE_DEBOUNCE_MS);
  }
}
