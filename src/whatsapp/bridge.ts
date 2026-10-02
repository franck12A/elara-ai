import pino from "pino";
import qrcode from "qrcode-terminal";
import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  getContentType,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import type { Elara } from "../elara.js";
import type { VoiceService } from "../voice/voice.service.js";
import {
  hasFfmpeg,
  transcribeAudio,
  wavToVoiceNote,
} from "../voice/audio-tools.js";

export type ReplyMode = "text" | "voice" | "both";

export interface WhatsAppBridgeOptions {
  /** Carpeta donde se guarda la sesión de WhatsApp (no commitear). */
  authDir: string;
  /**
   * Número propio de Elara (solo dígitos, con código de país).
   * Si está, la primera conexión se hace por código de 8 dígitos en
   * lugar de QR: Ajustes → Dispositivos vinculados → Vincular dispositivo.
   */
  pairingNumber?: string | undefined;
  /**
   * Número autorizado a hablar con Elara (solo dígitos, con código de país).
   * Si no está, cualquiera que le escriba obtiene respuesta.
   */
  ownerNumber?: string | undefined;
  /** Formato de respuesta: texto, nota de voz, o ambos. */
  replyMode: ReplyMode;
  /** Horarios locales (["HH:MM"]) en los que Elara escribe primero. */
  proactiveTimes: string[];
  /** Prompt opcional para guiar los mensajes proactivos. */
  proactivePrompt?: string | undefined;
}

/** Un "slice" corto para que las respuestas lleguen en orden por chat. */
interface ChatQueue {
  tail: Promise<void>;
}

const RECONNECT_DELAY_MS = 3_000;
const PROACTIVE_CHECK_MS = 30_000;
const DEFAULT_PROACTIVE_PROMPT =
  "No te estoy hablando: es un horario programado y querés saludarme. " +
  "Mandame un mensaje proactivo corto y natural, como lo haría una compañera " +
  "(buenos días, buenas noches o un seguimiento de algo de lo que hayamos hablado).";

export class WhatsAppBridge {
  private readonly elara: Elara;
  private readonly voice: VoiceService;
  private readonly options: WhatsAppBridgeOptions;
  private sock: WASocket | undefined;
  private connected = false;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private proactiveTimer: ReturnType<typeof setInterval> | undefined;
  private readonly proactiveFired = new Set<string>();
  private readonly queues = new Map<string, ChatQueue>();
  /** Mensaje de emparejamiento pendiente (se resuelve al escanear/ingresar el código). */
  private pairingRequested = false;

  constructor(elara: Elara, voice: VoiceService, options: WhatsAppBridgeOptions) {
    this.elara = elara;
    this.voice = voice;
    this.options = options;
  }

  async start(): Promise<void> {
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.proactiveTimer) clearInterval(this.proactiveTimer);
    this.sock?.end(undefined);
    this.sock = undefined;
  }

  private async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(
      this.options.authDir,
    );

    // El logger de Baileys es muy ruidoso (JSON por línea); silencio por
    // defecto y lo abro con WA_LOG_LEVEL=debug si hace falta investigar.
    const sock = makeWASocket({
      auth: state,
      logger: pino({ level: process.env.WA_LOG_LEVEL || "silent" }),
    });
    this.sock = sock;
    this.pairingRequested = false;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        await this.handlePairingOrQr(sock, qr, state.creds.registered);
      }

      if (connection === "open") {
        this.connected = true;
        console.log("✅ Elara conectada a WhatsApp.");
        this.startProactiveScheduler();
      }

      if (connection === "close") {
        this.connected = false;
        this.stopProactiveScheduler();

        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
          ?.output?.statusCode;

        if (statusCode === DisconnectReason.loggedOut) {
          console.error(
            "❌ Sesión cerrada en WhatsApp. Borrá la carpeta " +
              `${this.options.authDir} y volvé a emparejar.`,
          );
          this.stopped = true;
          return;
        }

        if (!this.stopped) {
          console.log(`🔁 Reconectando en ${RECONNECT_DELAY_MS / 1000}s…`);
          this.reconnectTimer = setTimeout(() => {
            void this.connect();
          }, RECONNECT_DELAY_MS);
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const message of messages) {
        await this.enqueueMessage(sock, message);
      }
    });
  }

  private async handlePairingOrQr(
    sock: WASocket,
    qr: string,
    registered: boolean,
  ): Promise<void> {
    if (registered) return;

    if (this.options.pairingNumber) {
      if (this.pairingRequested) return;
      this.pairingRequested = true;

      try {
        const code = await sock.requestPairingCode(this.options.pairingNumber);
        console.log("\n📱 Para vincular a Elara, en tu celular:");
        console.log("   Ajustes → Dispositivos vinculados → Vincular dispositivo");
        console.log("   → \"Vincular con número de teléfono\"");
        console.log(`   Código: ${code}\n`);
      } catch (error) {
        console.warn("⚠️  No pude pedir el código de emparejamiento:", error);
        console.log("Escaneá este QR en su lugar:\n");
        qrcode.generate(qr, { small: true });
      }
      return;
    }

    console.log("\n📱 Escaneá este QR con Elara (Ajustes → Dispositivos vinculados):\n");
    qrcode.generate(qr, { small: true });
  }

  // ── Mensajes entrantes ──────────────────────────────────────────────

  /** Encola el manejo de un mensaje para que las respuestas salgan en orden. */
  private enqueueMessage(sock: WASocket, message: WAMessage): Promise<void> {
    const jid = message.key.remoteJid;
    if (!jid) return Promise.resolve();

    const queue = this.queues.get(jid) ?? { tail: Promise.resolve() };
    this.queues.set(jid, queue);

    queue.tail = queue.tail
      .then(() => this.handleMessage(sock, message, jid))
      .catch((error) => {
        console.error("❌ Error manejando mensaje:", error);
      });

    return queue.tail;
  }

  private async handleMessage(
    sock: WASocket,
    message: WAMessage,
    jid: string,
  ): Promise<void> {
    if (message.key.fromMe) return;
    if (jid === "status@broadcast") return;
    if (jid.endsWith("@g.us") || jid.endsWith("@newsletter")) return;
    if (!this.isAuthorized(jid)) return;

    const content = message.message;
    if (!content) return;

    const contentType = getContentType(content);
    if (!contentType) return;

    const userText = await this.extractUserText(sock, message, contentType);
    if (!userText) return;

    console.log(`📨 WhatsApp → Elara: ${userText}`);

    await sock.sendPresenceUpdate("composing", jid);

    let response: string;
    try {
      response = await this.elara.chat(userText);
    } catch (error) {
      console.error("❌ Error de Elara:", error);
      await sock.sendPresenceUpdate("paused", jid);
      return;
    }

    await sock.sendPresenceUpdate("paused", jid);
    await this.sendReply(sock, jid, response);
  }

  /** Solo el dueño (si está configurado) puede hablar con Elara. */
  private isAuthorized(jid: string): boolean {
    const owner = this.options.ownerNumber;
    if (!owner) return true;
    if (jid.startsWith(`${owner}@`)) return true;

    // Los jid @lid no traen el número a la vista; en uso personal los
    // aceptamos para no bloquear al dueño por un cambio de privacidad.
    if (jid.endsWith("@lid")) return true;

    console.log(`🚫 Mensaje ignorado de ${jid} (no es el dueño).`);
    return false;
  }

  private async extractUserText(
    sock: WASocket,
    message: WAMessage,
    contentType: string,
  ): Promise<string | undefined> {
    const content = message.message;
    if (!content) return undefined;

    if (contentType === "conversation") {
      return content.conversation?.trim() || undefined;
    }

    if (contentType === "extendedTextMessage") {
      return content.extendedTextMessage?.text?.trim() || undefined;
    }

    if (
      contentType === "imageMessage" ||
      contentType === "videoMessage"
    ) {
      const caption =
        contentType === "imageMessage"
          ? content.imageMessage?.caption
          : content.videoMessage?.caption;
      return caption?.trim() || undefined;
    }

    if (contentType === "audioMessage") {
      return this.transcribeVoiceNote(sock, message, content.audioMessage?.mimetype);
    }

    return undefined;
  }

  private async transcribeVoiceNote(
    sock: WASocket,
    message: WAMessage,
    mimetype: string | null | undefined,
  ): Promise<string | undefined> {
    try {
      const buffer = await downloadMediaMessage(message, "buffer", {}, {
        logger: sock.logger,
        reuploadRequest: sock.updateMediaMessage,
      });

      const extension = mimetype?.includes("ogg")
        ? ".ogg"
        : mimetype?.includes("mp4")
          ? ".m4a"
          : ".ogg";

      const text = await transcribeAudio(buffer, extension);

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

  private async sendReply(
    sock: WASocket,
    jid: string,
    response: string,
  ): Promise<void> {
    // Los tags de emoción ([excited], …) se interpretan en ElevenLabs,
    // pero no deben mostrarse en el chat.
    const displayText = response.replace(/\[[^\]]+\]/g, "").trim() || "…";
    const mode = this.options.replyMode;

    if (mode === "text" || mode === "both") {
      await sock.sendMessage(jid, { text: displayText });
    }

    if (mode === "voice" || mode === "both") {
      // El fallback a texto solo aplica en modo "voice"; en "both" ya
      // mandamos el texto y duplicarlo sería un dolor.
      const fallback = mode === "voice" ? displayText : "";
      await this.sendVoiceNote(sock, jid, response, fallback);
    }
  }

  /** Genera la voz con ElevenLabs y la manda como nota de voz (ptt). */
  private async sendVoiceNote(
    sock: WASocket,
    jid: string,
    responseWithTags: string,
    fallbackText: string,
  ): Promise<void> {
    if (!(await hasFfmpeg())) {
      console.warn("⚠️  ffmpeg no está instalado; respondo con texto.");
      if (fallbackText) await sock.sendMessage(jid, { text: fallbackText });
      return;
    }

    try {
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

      await sock.sendMessage(jid, {
        audio: ogg,
        mimetype: "audio/ogg; codecs=opus",
        ptt: true,
      });
    } catch (error) {
      console.warn("⚠️  No pude generar la nota de voz:", error);
      if (fallbackText) await sock.sendMessage(jid, { text: fallbackText });
    }
  }

  // ── Mensajes proactivos (que Elara escriba primero) ────────────────

  private startProactiveScheduler(): void {
    if (this.proactiveTimer) return;
    if (this.options.proactiveTimes.length === 0) return;
    if (!this.options.ownerNumber) {
      console.warn(
        "⚠️  WA_PROACTIVE_TIMES configurado pero sin WA_OWNER_NUMBER: " +
          "Elara no sabría a quién escribirle.",
      );
      return;
    }

    this.proactiveTimer = setInterval(() => {
      void this.checkProactive();
    }, PROACTIVE_CHECK_MS);
    void this.checkProactive();
  }

  private stopProactiveScheduler(): void {
    if (this.proactiveTimer) {
      clearInterval(this.proactiveTimer);
      this.proactiveTimer = undefined;
    }
  }

  private async checkProactive(): Promise<void> {
    if (!this.connected || !this.sock || !this.options.ownerNumber) return;

    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes(),
    ).padStart(2, "0")}`;

    if (!this.options.proactiveTimes.includes(hhmm)) return;

    // Disparar una sola vez por día y horario.
    const key = `${now.toDateString()} ${hhmm}`;
    if (this.proactiveFired.has(key)) return;
    this.proactiveFired.add(key);

    const jid = `${this.options.ownerNumber}@s.whatsapp.net`;
    const prompt = this.options.proactivePrompt ?? DEFAULT_PROACTIVE_PROMPT;

    try {
      console.log(`🌅 Mensaje proactivo programado (${hhmm}).`);
      const response = await this.elara.chat(prompt);
      await this.sendReply(this.sock, jid, response);
    } catch (error) {
      console.error("❌ Error en mensaje proactivo:", error);
    }
  }

}
