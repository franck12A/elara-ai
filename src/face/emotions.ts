export type JarvisEmotion =
  | "neutral"
  | "happy"
  | "sad"
  | "angry"
  | "shy"
  | "surprised";

const TAG_TO_EMOTION: Record<string, JarvisEmotion> = {
  excited: "happy",
  happy: "happy",
  laughs: "happy",
  laughing: "happy",
  giggle: "happy",
  smile: "happy",
  sad: "sad",
  sighs: "sad",
  tired: "sad",
  disappointed: "sad",
  angry: "angry",
  furious: "angry",
  annoyed: "angry",
  whispers: "shy",
  shy: "shy",
  nervous: "shy",
  surprised: "surprised",
  shocked: "surprised",
};

/**
 * Expresiones del modelo Haru (haru_greeter_t03).
 * Verificadas en sus archivos .exp3.json:
 * - f00: neutra (boca ligeramente abierta)
 * - f01: enojada (cejas tensas, boca abierta)
 * - f03: preocupada/avergonzada (ojos entrecerrados, cejas caídas)
 * - f04: feliz (ojos cerrados sonriendo)
 * - f05: sorprendida (ojos muy abiertos, cejas arriba)
 * - f07: triste (cejas caídas, boca fruncida)
 */
export const EMOTION_EXPRESSIONS: Record<JarvisEmotion, string> = {
  neutral: "f00",
  happy: "f04",
  sad: "f07",
  angry: "f01",
  shy: "f03",
  surprised: "f05",
};

export function emotionFromTags(text: string): JarvisEmotion {
  const tags = text.match(/\[[^\]]+\]/g) ?? [];

  for (const tag of tags) {
    const key = tag.slice(1, -1).trim().toLowerCase();
    const emotion = TAG_TO_EMOTION[key];

    if (emotion) {
      return emotion;
    }
  }

  return "neutral";
}
