import type { ConversationMessage } from "./conversation.js";
import type { MemoryService } from "./memory.js";
import type { AIProvider } from "./providers/ai.provider.js";
import type { StateService } from "./state.js";

const REFLECTION_SYSTEM = `
Sos Jarvis revisando tus últimas conversaciones para guardar recuerdos y actualizar
tu estado interno, como lo haría una persona que al final del día anota lo importante.

Respondé SOLO con un JSON válido, sin explicaciones y sin markdown:
{
  "memories": [{ "key": "clave-en-kebab-case", "value": "frase corta con el dato" }],
  "state": { "mood": "cómo te sentís vos, Jarvis", "current": "en qué está tu vida/conversación", "pending": "algo que quedó pendiente de hablar" }
}

Reglas:
- "key": minúsculas con guiones, máximo 40 caracteres, estable para reutilizarla
  (ej: "gustos-musica", "fran-trabajo", "proyecto-jarvis-estado").
- "value": 1 o 2 frases en español con el dato concreto. Incluí fechas si las hay.
- Máximo 3 memorias por pasada. Guardá solo lo que de verdad sirva a futuro:
  proyectos, gustos, personas, decisiones, hechos personales, cómo le fue algo.
- No guardes saludos, cortesías, datos de una conversación trivial ni nada que
  no hayas dicho explícitamente.
- "state": solo completá lo que tengas; podés omitir claves.
- Si no hay nada que guardar, devolvé "memories": [].
`.trim();

interface ReflectionResult {
  memories?: Array<{ key?: string; value?: string }>;
  state?: { mood?: string; current?: string; pending?: string };
}

/**
 * Pase de "reflexión": cada varios mensajes, Jarvis mira la charla y decide
 * qué se guarda en memoria y cómo queda su estado interno. Corre en
 * segundo plano para no frenar la respuesta.
 */
export class Reflector {
  private busy = false;

  constructor(
    private readonly ai: AIProvider,
    private readonly memory: MemoryService,
    private readonly state: StateService,
  ) {}

  async reflect(messages: ConversationMessage[]): Promise<void> {
    if (this.busy || messages.length < 4) return;

    this.busy = true;
    try {
      const response = await this.ai.generateResponse(messages, {
        system: REFLECTION_SYSTEM,
      });

      const parsed = parseJson(response.text ?? "");
      if (!parsed) return;

      for (const memory of parsed.memories ?? []) {
        const key = memory.key?.trim().toLowerCase();
        const value = memory.value?.trim();
        if (!key || !value || key.length > 60) continue;
        await this.memory.save(key, value, { category: "episodio" });
      }

      if (parsed.state) {
        await this.state.patch({
          mood: parsed.state.mood,
          current: parsed.state.current,
          pending: parsed.state.pending,
        });
      }
    } catch (error) {
      console.warn("⚠️  No pude reflexionar sobre la charla:", error);
    } finally {
      this.busy = false;
    }
  }
}

function parseJson(raw: string): ReflectionResult | null {
  const text = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    return JSON.parse(text.slice(start, end + 1)) as ReflectionResult;
  } catch {
    return null;
  }
}
