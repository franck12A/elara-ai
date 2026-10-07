import type { Jarvis } from "./jarvis.js";
import type { VoiceService } from "./voice/voice.service.js";
import type { FaceService } from "./face/face.service.js";
import { emotionFromTags, type JarvisEmotion } from "./face/emotions.js";
import { gestureFromTags, stripGestureTags } from "./face/gestures.js";
import type { ChatReply } from "./face/face.server.js";

/**
 * Lo que ElevenLabs puede hablar: sin tags nuestros ([gesture:*]) ni sus
 * propios tags acústicos ([laughs], [sighs]…), que ElevenLabs ya quita y
 * si queda vacío revienta el pedido con 400 input_text_empty.
 */
export function spokenOf(text: string): string {
  return stripGestureTags(
    text.replace(/\[[^\]]{1,24}\]/g, ""),
  ).trim();
}

/**
 * ¿Queda algo hablable? ElevenLabs quita speaker tags Y EMOJIS: si después
 * de eso no queda nada (respuesta solo-emoji o solo-gesto), no lo llamamos.
 */
export function speakableOf(text: string): string {
  const spoken = spokenOf(text);
  const withoutEmojis = spoken.replace(
    /[\p{Extended_Pictographic}\p{P}\p{S}\p{Zs}\u200d\ufe0f]/gu,
    "",
  );
  return withoutEmojis ? spoken : "";
}

/** Los tags de emoción ([excited], …) no se muestran en el chat. */
function stripTags(text: string): string {
  return text.replace(/\[[^\]]+\]/g, "").trim();
}

const ERROR_REPLY =
  "[nervous] Se me cruzaron los cables un segundo. Probá de nuevo, que ya estoy";

/**
 * Un solo turno de Jarvis, compartido por la terminal y por la ventana:
 * piensa, arma la respuesta, le genera la voz y avisa a la cara.
 */
export class JarvisSession {
  /** Serializa turnos: la terminal y la ventana no pueden pisarse. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly jarvis: Jarvis,
    private readonly voice: VoiceService | undefined,
    private readonly face: FaceService,
  ) {}

  send(userText: string): Promise<ChatReply> {
    const turn = this.queue.then(
      () => this.runTurn(userText),
      () => this.runTurn(userText),
    );
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private async runTurn(userText: string): Promise<ChatReply> {
    this.face.setStatus("thinking");

    let text: string;
    try {
      text = await this.jarvis.chat(userText);
    } catch (error) {
      console.error("❌ Error de Jarvis:", error);
      const reply: ChatReply = { display: ERROR_REPLY, emotion: "shy" };
      this.face.broadcastReply(reply);
      this.face.setStatus("idle");
      return reply;
    }

    const emotion: JarvisEmotion = emotionFromTags(text);
    const gesture = gestureFromTags(text);
    const display = stripGestureTags(stripTags(text)) || "…";

    this.face.setExpression(emotion);
    if (gesture) this.face.setGesture(gesture);

    let audio: string | undefined;
    if (this.voice) {
      // El TTS hablasa un texto espejo (sin tags): si tras quitar tags y
      // emojis no queda nada (respuesta con solo un gesto o un emoji),
      // lo llamamos así ElevenLabs no devuelve 400 input_text_empty.
      const spoken = speakableOf(text);
      if (spoken) {
        try {
          const stream = await this.voice.generateSpeech(spoken);
          audio = await streamToBase64(stream);
        } catch (error) {
          console.warn("⚠️  No pude generar la voz esta vez:", error);
        }
      } else {
        console.log("🔇 Silencio: la respuesta fue solo un gesto/exprisión.");
      }
    }

    const reply: ChatReply = {
      display,
      emotion,
      gesture: gesture ?? undefined,
      audio,
    };

    // La ventana recibe todo junto: mensaje + audio para animar la boca.
    this.face.broadcastReply(reply);
    this.face.setStatus("idle");

    return reply;
  }
}

async function streamToBase64(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
    "base64",
  );
}

export function base64ToBuffer(base64: string): Buffer {
  return Buffer.from(base64, "base64");
}
