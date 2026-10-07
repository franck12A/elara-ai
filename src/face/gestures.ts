/**
 * Gestos corporales de Jarvis (brazos y cabeza) pedidos desde el LLM con tags
 * [gesture:...], igual que las emociones con [excited] y demás.
 *
 * El lado Node solo decide QUÉ gesto hacer; el navegador (vrm.html) anima
 * los huesos del VRM. Así el catálogo vive en un solo lugar compartido.
 */

/** Todos los gestos que Jarvis puede pedir, con su significado para el prompt. */
export const GESTURE_NAMES = [
  /** Saludo con la mano derecha. */
  "wave",
  /** Saludo con las dos manos. */
  "waveBoth",
  /** "veni": con la palma arriba, dibuja círculos chicos. */
  "beckon",
  /** "sí": cabeceo vertical. */
  "nod",
  /** "no": sacudida lateral de cabeza. */
  "shakeHead",
  /** Encogerse de hombros (no sé / me da igual). */
  "shrug",
  /** Mano al pecho, conmovida. */
  "handOnChest",
  /** Aplauso breve. */
  "clap",
  /** "pensando": mano al mentón. */
  "think",
  /** Estirarse, despertando. */
  "stretch",
  /** Brazos arriba, festejando. */
  "cheer",
  /** Tener la cabeza entre las manos (vergüenza / susto). */
  "facepalm",
  /** Mano levantada para tirar una idea (¡esa!). */
  "idea",
  /** Punyo cerrado, motivada. */
  "fist",
] as const;

export type JarvisGesture = (typeof GESTURE_NAMES)[number];

const GESTURE_SET: ReadonlySet<string> = new Set(GESTURE_NAMES);

/** Compatibilidad con nombres en inglés que el modelo podría escribir. */
const GESTURE_ALIASES: Record<string, JarvisGesture> = {
  nodding: "nod",
  headshake: "shakeHead",
  shake: "shakeHead",
  shoulder: "shrug",
  shoulders: "shrug",
  thinking: "think",
  celebrate: "cheer",
  excited: "cheer",
  facepalm: "facepalm",
  clap: "clap",
  applause: "clap",
  greeting: "wave",
  hello: "wave",
  hi: "wave",
  stretch: "stretch",
  fist: "fist",
  punch: "fist",
  "mano-al-pecho": "handOnChest",
  "no-sé": "shrug",
};

/** Extrae el primer gesto válido de un texto con tags [gesture:nombre]. */
export function gestureFromTags(text: string): JarvisGesture | undefined {
  const tags = text.match(/\[gesture:([a-zA-Z]+)\]/g) ?? [];

  for (const tag of tags) {
    const key = tag.slice("[gesture:".length, -1).trim();
    const gesture = resolveGesture(key);
    if (gesture) return gesture;
  }

  return undefined;
}

/** Extrae TODOS los gestos válidos de un texto (para mandar varios seguidos). */
export function gesturesFromTags(text: string): JarvisGesture[] {
  const tags = text.match(/\[gesture:([a-zA-Z]+)\]/g) ?? [];
  const found: JarvisGesture[] = [];

  for (const tag of tags) {
    const key = tag.slice("[gesture:".length, -1).trim();
    const gesture = resolveGesture(key);
    if (gesture && !found.includes(gesture)) found.push(gesture);
  }

  return found;
}

/** Resuelve un nombre de gesto, tolerando mayúsculas y alias en inglés. */
function resolveGesture(raw: string): JarvisGesture | undefined {
  const key = raw.trim().toLowerCase();
  if (GESTURE_SET.has(key)) return key as JarvisGesture;

  // Los alias también se normalizan a minúscula: el LLM escribe como sea.
  return GESTURE_ALIASES[key];
}

/** Quita los tags de gesto del texto visible en el chat. */
export function stripGestureTags(text: string): string {
  return text.replace(/\[gesture:[a-zA-Z]+\]/g, "").trim();
}

/** Líneas para el system prompt: el catálogo completo y cómo usarlo. */
export const GESTURE_PROMPT = `
GESTOS CON EL CUERPO (tu avatar 3D tiene brazos y cabeza animables):
- Podés pedir gestos insertando tags [gesture:nombre] entre tu texto, igual que
  los tags de audio, pero para el cuerpo: se ven en tu avatar, nunca se leen.
- Gestos disponibles:
  wave (saludo con una mano), waveBoth (saludo con las dos), beckon (vení, palma arriba),
  nod (decir sí con la cabeza), shakeHead (decir no), shrug (encoger hombros, no sé),
  handOnChest (mano al pecho, conmovida), clap (aplausos), think (mano al mentón),
  stretch (estirarte), cheer (brazos arriba, festejar), facepalm (cabeza entre las manos),
  idea (mano levantada, ¡se me ocurrió!), fist (punyo, motivada).
- Reglas: máximo un tag por respuesta y solo cuando la emoción lo justifique,
  para que se vea natural. Ejemplos: "holaa [gesture:wave]" al saludar,
  "[gesture:nod] posta" al confirmar, "[gesture:shrug] ni idea" cuando dudás.
`.trim();
