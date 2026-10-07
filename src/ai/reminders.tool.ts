import type { JarvisTool } from "./tools.js";
import type { ReminderService } from "./reminders.js";
import { describeReminder } from "./reminders.js";

/**
 * Convierte lo que el modelo mande a un timestamp.
 * Acepta "HH:MM" (hoy, o mañana si ya pasó), ISO 8601 y variantes
 * que Date.parse entienda ("2026-10-07 21:30").
 */
function resolveAt(at: string): number | undefined {
  const value = at.trim();
  if (!value) return undefined;

  const clock = value.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (clock) {
    const now = new Date();
    const target = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      Number(clock[1]),
      Number(clock[2]),
      0,
      0,
    );
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime();
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function createSetReminderTool(
  reminders: ReminderService,
): JarvisTool {
  return {
    name: "set_reminder",

    description:
      "Agenda un recordatorio que va a avisarle a Fran en el momento indicado, " +
      "aunque estén en otro chat. Usala SIEMPRE que Fran pida que le recuerdes algo. " +
      "Calculá la fecha y hora exactas con el reloj del contexto y pasalas en 'at' " +
      "(ISO 8601 o HH:MM) o usá 'inMinutes' para algo relativo (ej: 30).",

    parameters: {
      type: "object",

      properties: {
        message: {
          type: "string",
          description:
            "Qué hay que recordarle, en pocas palabras (ej: 'llamar al dentista').",
        },
        at: {
          type: "string",
          description:
            "Cuándo avisar: ISO 8601 (ej: '2026-10-08T09:00') o 'HH:MM' para hoy " +
            "(mañana si ya pasó esa hora).",
        },
        inMinutes: {
          type: "string",
          description:
            "Alternativa a 'at': dentro de cuántos minutos avisar (ej: '20').",
        },
      },

      required: ["message"],
    },

    async execute(args): Promise<string> {
      const message = args.message?.trim();
      if (!message) {
        return "No pude agendar el recordatorio: falta el mensaje.";
      }

      const inMinutes = Number(args.inMinutes);
      let at: number | undefined;

      if (args.inMinutes && Number.isFinite(inMinutes) && inMinutes > 0) {
        at = Date.now() + inMinutes * 60_000;
      } else if (args.at) {
        at = resolveAt(args.at);
      }

      if (!at) {
        return (
          "No pude agendar el recordatorio: necesito un horario válido " +
          "en 'at' (ISO 8601 o HH:MM) o 'inMinutes'. Usá el reloj del contexto " +
          "para calcular la hora exacta."
        );
      }

      if (at <= Date.now()) {
        return "Ese horario ya pasó. Calculá de nuevo con el reloj del contexto.";
      }

      const reminder = await reminders.add(message, at);
      return `Recordatorio agendado para ${describeReminder(reminder)} (id ${reminder.id}): "${reminder.message}".`;
    },
  };
}

export function createListRemindersTool(
  reminders: ReminderService,
): JarvisTool {
  return {
    name: "list_reminders",

    description:
      "Lista los recordatorios pendientes de Fran, ordenados por horario.",

    parameters: {
      type: "object",
      properties: {},
      required: [],
    },

    async execute(): Promise<string> {
      const pending = reminders.pending();
      if (pending.length === 0) {
        return "No hay recordatorios pendientes.";
      }

      return pending
        .map(
          (reminder) =>
            `- ${describeReminder(reminder)}: ${reminder.message} (id ${reminder.id})`,
        )
        .join("\n");
    },
  };
}

export function createCancelReminderTool(
  reminders: ReminderService,
): JarvisTool {
  return {
    name: "cancel_reminder",

    description:
      "Cancela un recordatorio pendiente por su id o por palabras de su mensaje " +
      "(ej: 'dentista').",

    parameters: {
      type: "object",

      properties: {
        query: {
          type: "string",
          description:
            "Id del recordatorio o palabras que identifiquen su mensaje.",
        },
      },

      required: ["query"],
    },

    async execute(args): Promise<string> {
      const query = args.query?.trim();
      if (!query) {
        return "No pude cancelar: falta el id o las palabras del recordatorio.";
      }

      const removed = await reminders.cancel(query);
      if (!removed) {
        return `No encontré ningún recordatorio pendiente que coincida con "${query}".`;
      }

      return `Cancelado el recordatorio de ${describeReminder(removed)}: "${removed.message}".`;
    },
  };
}
