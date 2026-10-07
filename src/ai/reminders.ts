import { promises as fs } from "node:fs";
import path from "node:path";
import { formatWhen } from "./prompt.js";

/** Un recordatorio agendado, persistido en data/reminders.json. */
export interface Reminder {
  id: string;
  message: string;
  /** Epoch ms en el que suena. */
  at: number;
  createdAt: number;
  fired: boolean;
}

const REMINDERS_FILE = path.join(process.cwd(), "data", "reminders.json");
/** Cada cuánto revisa si hay recordatorios vencidos. */
const CHECK_INTERVAL_MS = 15_000;
/** Recordatorios ya disparados se purgan después de 24 h. */
const FIRED_TTL_MS = 24 * 60 * 60_000;

/**
 * Recordatorios que sobreviven reinicios: el scheduler re-arma los timers
 * al arrancar y dispara también los que vencieron con el proceso apagado.
 */
export class ReminderService {
  private reminders: Reminder[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private onFire: ((reminder: Reminder, overdueMs: number) => void) | undefined;

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(REMINDERS_FILE, "utf-8");
      const parsed = JSON.parse(raw) as { reminders?: Reminder[] };
      this.reminders = Array.isArray(parsed?.reminders)
        ? parsed.reminders.filter(
            (r) =>
              typeof r?.id === "string" &&
              typeof r?.message === "string" &&
              Number.isFinite(r?.at),
          )
        : [];
    } catch {
      this.reminders = [];
    }

    // Limpieza: disparados hace más de un día, fuera.
    const cutoff = Date.now() - FIRED_TTL_MS;
    const before = this.reminders.length;
    this.reminders = this.reminders.filter(
      (r) => !(r.fired && r.at < cutoff),
    );
    if (this.reminders.length !== before) await this.save();
  }

  async save(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(REMINDERS_FILE), { recursive: true });
      await fs.writeFile(
        REMINDERS_FILE,
        JSON.stringify({ reminders: this.reminders }, null, 2),
        "utf-8",
      );
    } catch (error) {
      console.warn("⚠️  No pude guardar los recordatorios:", error);
    }
  }

  /** Registra el callback de entrega y arranca el scheduler. */
  start(onFire: (reminder: Reminder, overdueMs: number) => void): void {
    if (this.timer) return;
    this.onFire = onFire;

    this.timer = setInterval(() => {
      void this.check();
    }, CHECK_INTERVAL_MS);

    // Recordatorios vencidos con el proceso apagado: se avisan al arrancar.
    void this.check();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.onFire = undefined;
  }

  async add(message: string, at: number): Promise<Reminder> {
    const reminder: Reminder = {
      id: randomId(),
      message: message.trim().slice(0, 300),
      at,
      createdAt: Date.now(),
      fired: false,
    };
    this.reminders.push(reminder);
    await this.save();
    return reminder;
  }

  /** Los pendientes, ordenados por horario. */
  pending(): Reminder[] {
    return this.reminders
      .filter((r) => !r.fired)
      .sort((a, b) => a.at - b.at);
  }

  /**
   * Cancela por id (o prefijo) o por palabras que aparezcan en el mensaje.
   * Devuelve el recordatorio cancelado, si encontró uno.
   */
  async cancel(idOrQuery: string): Promise<Reminder | undefined> {
    const query = idOrQuery.trim().toLowerCase();
    if (!query) return undefined;

    const index = this.reminders.findIndex(
      (r) =>
        !r.fired &&
        (r.id.toLowerCase().startsWith(query) ||
          r.message.toLowerCase().includes(query)),
    );
    if (index === -1) return undefined;

    const [removed] = this.reminders.splice(index, 1);
    await this.save();
    return removed;
  }

  /** Dispara los vencidos (una vez cada uno) y avisa cuánto llevaban demorados. */
  private async check(): Promise<void> {
    const now = Date.now();

    for (const reminder of this.reminders) {
      if (reminder.fired || reminder.at > now) continue;
      reminder.fired = true;
      await this.save();

      const overdueMs = Math.max(now - reminder.at, 0);
      try {
        this.onFire?.(reminder, overdueMs);
      } catch (error) {
        console.error("❌ Error entregando recordatorio:", error);
      }
    }
  }
}

/** "mar 7 de oct de 2026, 21:30" — corto, para confirmar al agendar. */
export function describeReminder(reminder: Reminder): string {
  return `${formatWhen(new Date(reminder.at))}`;
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** Prompt que le avisa al cerebro que un recordatorio sonó. */
export function reminderFirePrompt(
  reminder: Reminder,
  overdueMs: number,
): string {
  const when = formatWhen(new Date(reminder.at));
  const overdue =
    overdueMs > 60_000
      ? ` Estaba agendado para ${when} y suena demorado (${Math.round(overdueMs / 60_000)} min, probablemente estabas apagado). Avisale también de eso con naturalidad.`
      : "";

  return (
    `[SISTEMA] Sonó el recordatorio que Fran te pidió agendar: "${reminder.message}"` +
    ` (agendado para ${when}).${overdue} ` +
    `Avisale de forma natural, breve y con el detalle exacto del recordatorio. ` +
    `Arrancá con ⏰ para que se identifique de un vistazo.`
  );
}
