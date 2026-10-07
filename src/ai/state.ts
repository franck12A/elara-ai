import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Estado interno persistente de Jarvis: lo que la hace sentir "continua"
 * entre sesiones (ánimo del día, en qué está, qué quedó a medias).
 */
export interface JarvisState {
  mood?: string | undefined;
  current?: string | undefined;
  pending?: string | undefined;
  updatedAt?: number | undefined;
}

const STATE_FILE = path.join(process.cwd(), "data", "state.json");

export class StateService {
  private state: JarvisState = {};

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(STATE_FILE, "utf-8");
      const parsed = JSON.parse(raw) as JarvisState;
      this.state = parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      this.state = {};
    }
  }

  get(): JarvisState {
    return { ...this.state };
  }

  /** Fusiona lo que venga (ignora claves vacías) y persiste. */
  async patch(partial: JarvisState): Promise<void> {
    let changed = false;

    for (const key of ["mood", "current", "pending"] as const) {
      const value = partial[key];
      if (typeof value === "string" && value.trim()) {
        this.state[key] = value.trim().slice(0, 300);
        changed = true;
      }
    }

    if (!changed) return;

    this.state.updatedAt = Date.now();

    try {
      await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
      await fs.writeFile(
        STATE_FILE,
        JSON.stringify(this.state, null, 2),
        "utf-8",
      );
    } catch (error) {
      console.warn("⚠️  No pude guardar el estado interno:", error);
    }
  }

  /** Una línea legible para meter en el prompt. */
  toPromptLine(): string | undefined {
    const parts: string[] = [];
    if (this.state.mood) parts.push(`ánimo: ${this.state.mood}`);
    if (this.state.current) parts.push(`ahora: ${this.state.current}`);
    if (this.state.pending) parts.push(`pendiente: ${this.state.pending}`);
    if (parts.length === 0) return undefined;
    return parts.join(" · ");
  }
}
