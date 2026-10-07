import { JARVIS_PERSONALITY } from "./personality.js";

export interface PromptMemory {
  key: string;
  value: string;
}

export interface PromptContext {
  /** Fecha y hora actuales (default: ahora). */
  now?: Date | undefined;
  /** Resumen rodante de conversaciones anteriores. */
  summary?: string | undefined;
  /** Texto tipo "hace 3 días" desde la última charla. */
  sinceLast?: string | undefined;
  /** Memorias más recientes, para que no tenga que ir a buscarlas. */
  memories?: PromptMemory[] | undefined;
  /** Estado interno (ánimo, qué está haciendo, qué quedó pendiente). */
  stateNote?: string | undefined;
}

const DIAS = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** Prompt para comprimir conversaciones viejas en un resumen. */
export const SUMMARIZE_SYSTEM = `
Sos Jarvis resumiendo charlas pasadas con Fran para tu propia memoria a largo plazo.
Respondé SOLO con el resumen, en español, en prosa natural (sin lista, sin títulos).
Conservá: proyectos y su estado, gustos, decisiones, nombres de personas, fechas
relevantes, acuerdos y cosas pendientes. Tiraló: cortesías, saludos, technicalities
repetidos y relleno. Máximo 250 palabras.
`.trim();

export function formatWhen(now: Date): string {
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${DIAS[now.getDay()]} ${now.getDate()} de ${
    MESES[now.getMonth()]
  } de ${now.getFullYear()}, ${hh}:${mm}`;
}

/** "hace 2 minutos" / "hace 3 días" / "recién" */
export function formatSince(lastAt: number, now = new Date()): string {
  const diffMs = now.getTime() - lastAt;
  if (diffMs <= 0) return "hace un instante";

  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "hace un instante";
  if (minutes < 60) return `hace ${minutes} minuto${minutes === 1 ? "" : "s"}`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} hora${hours === 1 ? "" : "s"}`;

  const days = Math.round(hours / 24);
  if (days === 1) return "ayer";
  if (days < 30) return `hace ${days} días`;

  const months = Math.round(days / 30);
  return `hace ${months} mes${months === 1 ? "" : "es"}`;
}

function partOfDay(now: Date): string {
  const h = now.getHours();
  if (h < 6) return "madrugada";
  if (h < 13) return "mañana";
  if (h < 20) return "tarde";
  return "noche";
}

/**
 * Arma el system prompt: personalidad base + contexto vivo (reloj, resumen,
 * memoria reciente y estado interno). Sin esto Jarvis no sabe ni qué día es.
 */
export function buildSystemPrompt(context: PromptContext = {}): string {
  const now = context.now ?? new Date();
  const sections: string[] = [JARVIS_PERSONALITY];

  sections.push(
    [
      "CONTEXTO EN ESTE MOMENTO:",
      `- Son las ${formatWhen(now)} (hora local del usuario). Es de ${partOfDay(
        now,
      )}.`,
      context.sinceLast
        ? `- La última charla fue ${context.sinceLast}.`
        : "- Es la primera charla que tenés con el usuario.",
    ].join("\n"),
  );

  if (context.summary?.trim()) {
    sections.push(
      "RESUMEN DE CHARLAS ANTERIORES (tu memoria a largo plazo):\n" +
        context.summary.trim(),
    );
  }

  if (context.stateNote?.trim()) {
    sections.push("TU ESTADO INTERNO:\n" + context.stateNote.trim());
  }

  if (context.memories && context.memories.length > 0) {
    const lines = context.memories
      .slice(0, 15)
      .map((memory) => `- ${memory.key}: ${memory.value}`)
      .join("\n");
    sections.push(
      "RECUERDOS MÁS RECIENTES (usalos con naturalidad, sin citarlos como lista):\n" +
        lines,
    );
  }

  return sections.join("\n\n");
}
