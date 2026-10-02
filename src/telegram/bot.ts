import { Bot, GrammyError, InputFile, type Context } from "grammy";
import type { Elara } from "../elara.js";
import type { VoiceService } from "../voice/voice.service.js";
import {
  hasFfmpeg,
  transcribeAudio,
  wavToVoiceNote,
} from "../voice/audio-tools.js";

export type ReplyMode = "text" | "voice" | "both" | "mixed";

export interface TelegramBotOptions {
  /** Token que entrega @BotFather. */
  token: string;
  /** ID numérico (123456789) o @username del dueño. Vacío = cualquiera. */
  ownerId?: string | undefined;
  /** Formato de respuesta: texto, nota de voz, o ambos. */
  replyMode: ReplyMode;
  /** Horarios locales (["HH:MM"]) en los que Elara escribe primero. */
  proactiveTimes: string[];
  /** Prompt opcional para guiar los mensajes proactivos. */
  proactivePrompt?: string | undefined;

  /** Ventana horaria "HH:MM-HH:MM" en la que puede escribir por antojo. */
  spontaneousWindow?: string | undefined;
  /** Minutos de silencio mínimos antes de un antojo (default 45). */
  spontaneousMinMinutes?: number | undefined;
  /** Minutos de silencio máximos entre antojos (default 180). */
  spontaneousMaxMinutes?: number | undefined;
}

const PROACTIVE_CHECK_MS = 30_000;
const DEFAULT_PROACTIVE_PROMPT =
  "No te estoy hablando: es un horario programado y querés saludarme. " +
  "Mandame un mensaje proactivo corto y natural, como lo haría una compañera " +
  "(buenos días, buenas noches o un seguimiento de algo de lo que hayamos hablado).";

// ── Mensajes espontáneos ("antojos": escribe cuando quiere) ─────────
const DEFAULT_SPONTANEOUS_MIN_MINUTES = 45;
const DEFAULT_SPONTANEOUS_MAX_MINUTES = 180;
const DEFAULT_SPONTANEOUS_WINDOW: [number, number] = [540, 1380];
/** A veces no le pinta y no manda nada: así no queda predecible. */
const SPONTANEOUS_SKIP_CHANCE = 0.25;
const DEFAULT_SPONTANEOUS_PROMPT =
  "No te estoy hablando: te agarró el antojo de escribirte de la nada. " +
  "Mandame un mensaje espontáneo corto y natural, como lo haría una compañera " +
  "que está pensando en la otra persona: algo que se te ocurrió, una pregunta, " +
  "un comentario o un saludo según la hora.";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parte un texto en mensajes cortos por oraciones, como escribiría una persona. */
function splitLikeAPerson(text: string): string[] {
  const sentences = text
    .split(/\n+|(?<=[.!?…])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const parts: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (current && candidate.length > 180) {
      parts.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);

  return parts.length > 0 ? parts : [text];
}

/** Parsea "HH:MM-HH:MM" a minutos; null si el formato es inválido. */
export function parseSpontaneousWindow(
  value: string,
): [number, number] | null {
  const match = value
    .trim()
    .match(/^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;

  const from = Number(match[1]) * 60 + Number(match[2]);
  const to = Number(match[3]) * 60 + Number(match[4]);
  return [from, to];
}

function formatWindow([from, to]: [number, number]): string {
  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${hhmm(from)}-${hhmm(to)}`;
}

export class ElaraTelegramBot {
  private readonly bot: Bot;
  private readonly elara: Elara;
  private readonly voice: VoiceService;
  private readonly options: TelegramBotOptions;
  private readonly queues = new Map<number, { tail: Promise<void> }>();
  private readonly proactiveFired = new Set<string>();
  private proactiveTimer: ReturnType<typeof setInterval> | undefined;
  private spontaneousTimer: ReturnType<typeof setTimeout> | undefined;
  private spontaneousWindow: [number, number] = DEFAULT_SPONTANEOUS_WINDOW;
  /** Última vez que el dueño mandó algo (para respetar el silencio). */
  private lastInteractionAt = Date.now();
  private polling: Promise<void> | undefined;
  private connected = false;
  /** Últimos modos usados, para variar texto/voz en modo "mixed". */
  private readonly replyHistory: Array<"text" | "voice"> = [];

  constructor(
    elara: Elara,
    voice: VoiceService,
    options: TelegramBotOptions,
  ) {
    this.elara = elara;
    this.voice = voice;
    this.options = options;
    this.bot = new Bot(options.token);

    this.spontaneousWindow =
      parseSpontaneousWindow(options.spontaneousWindow ?? "") ??
      DEFAULT_SPONTANEOUS_WINDOW;
  }

  /** Valida el token, engancha los handlers y arranca el polling. */
  async start(): Promise<void> {
    const me = await this.bot.api.getMe().catch((error: unknown) => {
      if (error instanceof GrammyError) {
        console.error(
          `\n❌ Telegram rechazó TG_BOT_TOKEN (HTTP ${error.error_code}: ${error.description}).\n` +
            "   Revisá que el token esté bien copiado de @BotFather.\n",
        );
      } else {
        throw error;
      }
      process.exit(1);
    });

    this.bot.on("message:text", (ctx) => this.enqueue(ctx));
    this.bot.on("message:voice", (ctx) => this.enqueue(ctx));
    this.bot.catch((error) => {
      console.error("❌ Error de Telegram:", error.error);
    });

    this.connected = true;
    console.log(`🤖 Elara está en Telegram como @${me.username}.`);
    this.startProactiveScheduler();
    this.startSpontaneousScheduler();

    this.polling = this.bot
      .start({ drop_pending_updates: true })
      .catch((error: unknown) => {
        if (error instanceof GrammyError) {
          console.error(`❌ Telegram rechazó el token: ${error.description}`);
        } else {
          console.error("❌ Se cortó la conexión con Telegram:", error);
        }
        process.exit(1);
      });
  }

  async stop(): Promise<void> {
    this.connected = false;
    if (this.proactiveTimer) {
      clearInterval(this.proactiveTimer);
      this.proactiveTimer = undefined;
    }
    if (this.spontaneousTimer) {
      clearTimeout(this.spontaneousTimer);
      this.spontaneousTimer = undefined;
    }
    await this.bot.stop();
    await this.polling;
  }

  // ── Mensajes entrantes ──────────────────────────────────────────────

  /** Serializa por chat para que las respuestas salgan en orden. */
  private enqueue(ctx: Context): Promise<void> {
    if (!ctx.chat) return Promise.resolve();
    const chatId = ctx.chat.id;
    const queue = this.queues.get(chatId) ?? { tail: Promise.resolve() };
    this.queues.set(chatId, queue);

    queue.tail = queue.tail
      .then(() => this.handle(ctx))
      .catch((error) => {
        console.error("❌ Error manejando mensaje:", error);
      });

    return queue.tail;
  }

  private async handle(ctx: Context): Promise<void> {
    const message = ctx.message;
    const chat = ctx.chat;
    if (!message || !chat || chat.type !== "private") return;
    if (!this.isAuthorized(ctx)) return;

    const userText = await this.extractUserText(ctx);
    if (!userText) return;

    this.lastInteractionAt = Date.now();
    console.log(
      `📨 [${ctx.from?.id ?? "?"}] Telegram → Elara: ${userText}`,
    );

    await ctx.replyWithChatAction("typing").catch(() => undefined);

    let response: string;
    try {
      response = await this.elara.chat(userText);
    } catch (error) {
      console.error("❌ Error de Elara:", error);
      return;
    }

    await this.deliver(chat.id, response);
  }

  private isAuthorized(ctx: Context): boolean {
    const owner = this.options.ownerId;
    if (!owner) return true;
    if (!ctx.from) return false;

    const asId = String(ctx.from.id);
    const asUsername = ctx.from.username ? `@${ctx.from.username}` : "";

    if (owner === asId || owner.toLowerCase() === asUsername.toLowerCase()) {
      return true;
    }

    console.log(`🚫 Mensaje ignorado de ${asId} (${asUsername || "sin username"}).`);
    return false;
  }

  private async extractUserText(ctx: Context): Promise<string | undefined> {
    const message = ctx.message;
    if (!message) return undefined;

    if ("text" in message) {
      return message.text.trim() || undefined;
    }

    if ("voice" in message) {
      return this.transcribeVoiceNote(ctx);
    }

    return undefined;
  }

  private async transcribeVoiceNote(ctx: Context): Promise<string | undefined> {
    const message = ctx.message;
    if (!message || !("voice" in message)) return undefined;

    try {
      const file = await ctx.getFile();
      if (!file.file_path) return undefined;

      const url = `https://api.telegram.org/file/bot${this.options.token}/${file.file_path}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`descarga falló: HTTP ${response.status}`);
      }
      const audio = Buffer.from(await response.arrayBuffer());

      const text = await transcribeAudio(audio, ".ogg");

      if (!text) {
        return (
          "Me mandaste una nota de voz, pero no tengo GROQ_API_KEY " +
          "configurada para transcribirla. Escribime con texto 🙏"
        );
      }

      console.log(`🎤 Nota de voz transcrita: ${text}`);
      return text;
    } catch (error) {
      console.warn("⚠️  No pude transcribir la nota de voz:", error);
      return undefined;
    }
  }

  // ── Respuestas ──────────────────────────────────────────────────────

  private async deliver(chatId: number, response: string): Promise<void> {
    // Los tags de emoción ([excited], …) se interpretan en ElevenLabs,
    // pero no deben mostrarse en el chat.
    const displayText = response.replace(/\[[^\]]+\]/g, "").trim() || "…";
    const mode =
      this.options.replyMode === "mixed"
        ? this.pickReplyMode(displayText)
        : this.options.replyMode;

    if (mode === "text" || mode === "both") {
      await this.sendTextMessages(chatId, displayText);
    }

    if (mode === "voice" || mode === "both") {
      // El fallback a texto solo aplica en modo "voice"; en "both" ya
      // mandamos el texto y duplicarlo sería un dolor.
      const fallback = mode === "voice" ? displayText : "";
      await this.sendVoiceNote(chatId, response, fallback);
    }
  }

  /**
   * En modo "mixed", decide si responde texto o audio como una persona real:
   * lo corto casi siempre texto, lo largo casi siempre audio, y nunca tres
   * seguidas del mismo tipo (así siempre varía).
   */
  private pickReplyMode(displayText: string): "text" | "voice" {
    const last2 = this.replyHistory.slice(-2);
    let useVoice: boolean;

    if (last2.length === 2 && last2[0] === last2[1]) {
      useVoice = last2[0] === "text";
    } else {
      const len = displayText.length;
      const probability = len < 70 ? 0.2 : len < 180 ? 0.55 : 0.85;
      useVoice = Math.random() < probability;
    }

    this.replyHistory.push(useVoice ? "voice" : "text");
    if (this.replyHistory.length > 4) this.replyHistory.shift();
    return useVoice ? "voice" : "text";
  }

  /** Manda el texto como uno o varios mensajes cortos, con pausa entre cada uno. */
  private async sendTextMessages(chatId: number, text: string): Promise<void> {
    const parts = splitLikeAPerson(text);

    let first = true;
    for (const part of parts) {
      if (!first) {
        await sleep(600 + Math.random() * 900);
      }
      first = false;
      await this.bot.api.sendMessage(chatId, part);
    }
  }

  /** Genera la voz con ElevenLabs y la manda como nota de voz. */
  private async sendVoiceNote(
    chatId: number,
    responseWithTags: string,
    fallbackText: string,
  ): Promise<void> {
    if (!(await hasFfmpeg())) {
      console.warn("⚠️  ffmpeg no está instalado; respondo con texto.");
      if (fallbackText) await this.bot.api.sendMessage(chatId, fallbackText);
      return;
    }

    try {
      await this.bot.api
        .sendChatAction(chatId, "record_voice")
        .catch(() => undefined);

      const stream = await this.voice.generateSpeech(responseWithTags);
      const chunks: Uint8Array[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }

      const wav = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      const ogg = await wavToVoiceNote(wav);

      await this.bot.api.sendVoice(chatId, new InputFile(ogg, "elara.ogg"));
    } catch (error) {
      console.warn("⚠️  No pude generar la nota de voz:", error);
      if (fallbackText) await this.bot.api.sendMessage(chatId, fallbackText);
    }
  }

  // ── Mensajes proactivos (que Elara escriba primero) ────────────────

  private startProactiveScheduler(): void {
    if (this.proactiveTimer) return;
    if (this.options.proactiveTimes.length === 0) return;

    const owner = this.options.ownerId;
    if (!owner || !/^\d+$/.test(owner)) {
      console.warn(
        "⚠️  TG_PROACTIVE_TIMES configurado pero TG_OWNER_ID no es un ID " +
          "numérico: Elara no sabe a quién escribirle (usá tu ID, no el @username).",
      );
      return;
    }

    this.proactiveTimer = setInterval(() => {
      void this.checkProactive();
    }, PROACTIVE_CHECK_MS);
    void this.checkProactive();
  }

  private async checkProactive(): Promise<void> {
    if (!this.connected) return;
    const owner = this.options.ownerId;
    if (!owner || !/^\d+$/.test(owner)) return;

    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes(),
    ).padStart(2, "0")}`;

    if (!this.options.proactiveTimes.includes(hhmm)) return;

    // Disparar una sola vez por día y horario.
    const key = `${now.toDateString()} ${hhmm}`;
    if (this.proactiveFired.has(key)) return;
    this.proactiveFired.add(key);

    const chatId = Number(owner);
    const prompt = this.options.proactivePrompt ?? DEFAULT_PROACTIVE_PROMPT;

    try {
      console.log(`🌅 Mensaje proactivo programado (${hhmm}).`);
      const response = await this.elara.chat(prompt);
      await this.deliver(chatId, response);
    } catch (error) {
      console.error("❌ Error en mensaje proactivo:", error);
    }
  }

  // ── Mensajes espontáneos (que Elara escriba cuando quiera) ─────────

  private startSpontaneousScheduler(): void {
    if (this.spontaneousTimer) return;

    const owner = this.options.ownerId;
    if (!owner || !/^\d+$/.test(owner)) {
      console.warn(
        "⚠️  Mensajes espontánes desactivados: TG_OWNER_ID tiene que ser un " +
          "ID numérico para que Elara sepa a quién escribirle.",
      );
      return;
    }

    const min =
      this.options.spontaneousMinMinutes ?? DEFAULT_SPONTANEOUS_MIN_MINUTES;
    const max =
      this.options.spontaneousMaxMinutes ?? DEFAULT_SPONTANEOUS_MAX_MINUTES;

    this.scheduleNextSpontaneous(min, max);
    console.log(
      `✨ Antojos activos: Elara puede escribir sola entre ` +
        `${formatWindow(this.spontaneousWindow)} si pasan más de ${min} min sin charlar.`,
    );
  }

  /** Agenda el próximo antojo con un delay aleatorio entre min y max minutos. */
  private scheduleNextSpontaneous(min: number, max: number): void {
    const minutes = min + Math.random() * Math.max(max - min, 0);
    this.spontaneousTimer = setTimeout(
      () => {
        void this.checkSpontaneous();
        this.scheduleNextSpontaneous(min, max);
      },
      minutes * 60_000,
    );
  }

  private async checkSpontaneous(): Promise<void> {
    if (!this.connected) return;

    const owner = this.options.ownerId;
    if (!owner || !/^\d+$/.test(owner)) return;

    // Solo si estamos dentro de la ventana horaria permitida.
    if (!this.inSpontaneousWindow()) return;

    // Respetar el silencio: solo escribe si hace rato no charlan.
    const minMinutes =
      this.options.spontaneousMinMinutes ?? DEFAULT_SPONTANEOUS_MIN_MINUTES;
    const silentMinutes =
      (Date.now() - this.lastInteractionAt) / 60_000;
    if (silentMinutes < minMinutes) return;

    // A veces no le pinta y manda nada.
    if (Math.random() < SPONTANEOUS_SKIP_CHANCE) return;

    const chatId = Number(owner);
    const prompt = DEFAULT_SPONTANEOUS_PROMPT;

    try {
      console.log(
        `✨ Antojo de Elara (${silentMinutes.toFixed(0)} min de silencio).`,
      );
      const response = await this.elara.chat(prompt);
      // Cuenta como interacción para no amontonar antojos seguidos.
      this.lastInteractionAt = Date.now();
      await this.deliver(chatId, response);
    } catch (error) {
      console.error("❌ Error en mensaje espontáneo:", error);
    }
  }

  private inSpontaneousWindow(): boolean {
    const minutes = new Date().getHours() * 60 + new Date().getMinutes();
    const [from, to] = this.spontaneousWindow;

    if (from <= to) return minutes >= from && minutes < to;
    // Ventana que cruza medianoche (ej: 20:00-02:00).
    return minutes >= from || minutes < to;
  }
}
