import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  EMOTION_EXPRESSIONS,
  emotionFromTags,
  type JarvisEmotion,
} from "./emotions.js";
import {
  startFaceServer,
  type ChatReply,
  type FaceServer,
  type FaceHandlers,
} from "./face.server.js";

const DEFAULT_PORT = 4321;
const PORT_ATTEMPTS = 5;

/**
 * Reintento de puertos compartido: lo usan FaceService y scripts/serve-mock.ts
 * (que antes crasheaba crudo con EADDRINUSE si el 4321 estaba ocupado, ej.
 * cuando `npm run dev` ya está corriendo).
 */
export async function startFaceServerWithFallback(
  handlers?: FaceHandlers,
): Promise<FaceServer | undefined> {
  const preferredPort = Number(process.env.FACE_PORT) || DEFAULT_PORT;

  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
    const port = preferredPort + attempt;
    try {
      return await startFaceServer(port, handlers);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EADDRINUSE" && attempt < PORT_ATTEMPTS - 1) continue;
      throw error;
    }
  }
  return undefined;
}

export class FaceService {
  private server: FaceServer | undefined;
  private readonly handlers: FaceHandlers | undefined;

  constructor(handlers?: FaceHandlers) {
    this.handlers = handlers;
  }

  async start(): Promise<void> {
    // Si el puerto está ocupado (ej. un proceso viejo escuchando),
    // probamos los siguientes en lugar de quedarnos sin cara.
    try {
      this.server = await startFaceServerWithFallback(this.handlers);
    } catch {
      console.warn(
        `⚠️  No se pudo iniciar la cara de Jarvis (puertos ocupados). Seguí sin avatar.`,
      );
      return;
    }

    if (!this.server) return;

    console.log(`😊 Cara de Jarvis: ${this.server.url}`);
    openFaceWindow(this.server.url);
  }

  /** ¿Hay una ventana (o pestaña) mirando? Para no duplicar el audio. */
  hasViewers(): boolean {
    return (this.server?.viewerCount() ?? 0) > 0;
  }

  setExpression(emotion: JarvisEmotion): void {
    this.server?.broadcast({
      type: "expression",
      expression: EMOTION_EXPRESSIONS[emotion],
    });
  }

  /** Dispara un gesto corporal (brazos/cabeza) en el avatar 3D. */
  setGesture(gesture: string): void {
    this.server?.broadcast({ type: "gesture", gesture });
  }

  /**
   * Lee los tags de emoción de una respuesta (ej. "[excited]")
   * y cambia la expresión de la cara.
   */
  expressFromText(text: string): void {
    this.setExpression(emotionFromTags(text));
  }

  startSpeaking(): void {
    this.server?.broadcast({ type: "speak", on: true });
  }

  stopSpeaking(): void {
    this.server?.broadcast({ type: "speak", on: false });
  }

  /** Manda la respuesta completa a la ventana (chat + audio + animación). */
  broadcastReply(reply: ChatReply): void {
    this.server?.broadcast({
      type: "reply",
      text: reply.display,
      emotion: reply.emotion,
      gesture: reply.gesture,
      hasAudio: Boolean(reply.audio),
      audio: reply.audio,
    });
  }

  setStatus(status: "idle" | "thinking" | "speaking"): void {
    this.server?.broadcast({ type: "status", status });
  }

  async stop(): Promise<void> {
    await this.server?.close();
  }
}

/** Proceso de la ventana, para cerrarla cuando Jarvis se apaga. */
let windowProcess: ChildProcess | undefined;

function closeWindow(): void {
  if (!windowProcess) return;
  try {
    windowProcess.kill();
  } catch {
    // ya estaba muerta
  }
  windowProcess = undefined;
}

process.on("exit", closeWindow);
process.on("SIGINT", closeWindow);
process.on("SIGTERM", closeWindow);

/** Binario de Electron instalado en node_modules (undefined si no está). */
function electronBinary(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const binary = require("electron");
    return typeof binary === "string" && existsSync(binary) ? binary : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Qué cara abre la ventana: "vrm" (default), "pixel" o "live2d".
 * Se elige con FACE_STYLE (ej. FACE_STYLE=pixel npm run face).
 */
function facePath(): string {
  const style = (process.env.FACE_STYLE || "vrm").toLowerCase();
  if (style === "pixel") return "/";
  if (style === "live2d") return "/live2d";
  return "/vrm";
}

/**
 * Abre la app: primero intenta la ventana de Electron; si no está instalada,
 * cae en el navegador (misma URL, misma cara).
 * Exportado para poder previsualizar la cara sin levantar toda Jarvis.
 */
export function openFaceWindow(url: string): void {
  const faceUrl = new URL(facePath(), url).toString();

  if (process.env.FACE_WINDOW === "browser") {
    openBrowser(faceUrl);
    return;
  }

  const electronEntry = path.join(process.cwd(), "desktop", "main.mjs");
  const binary = electronBinary();

  if (binary && existsSync(electronEntry)) {
    windowProcess = spawn(binary, [electronEntry], {
      cwd: process.cwd(),
      env: { ...process.env, FACE_URL: faceUrl },
      stdio: "ignore",
      // Separada del árbol: así no traba la terminal cuando Jarvis termina.
      detached: true,
    });

    windowProcess.on("error", (error) => {
      console.warn(
        `⚠️  No pude abrir la ventana de Electron (${error.message}). ` +
          `Entrá a ${faceUrl} a mano.`,
      );
      windowProcess = undefined;
    });

    windowProcess.unref();
    console.log(`🖥️  Ventana de Jarvis: ${url}`);
    return;
  }

  openBrowser(url);
}

function openBrowser(url: string): void {
  if (process.platform !== "win32") {
    const command = process.platform === "darwin" ? "open" : "xdg-open";
    execFile(command, [url], (error) => {
      if (error) {
        console.warn(`⚠️  No pude abrir el navegador. Entrá a ${url} a mano.`);
      }
    });
    return;
  }

  execFile("cmd.exe", ["/c", "start", "", url], (error) => {
    if (error) {
      console.warn(`⚠️  No pude abrir el navegador. Entrá a ${url} a mano.`);
    }
  });
}
