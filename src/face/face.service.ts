import { execFile } from "node:child_process";
import {
  EMOTION_EXPRESSIONS,
  emotionFromTags,
  type ElaraEmotion,
} from "./emotions.js";
import { startFaceServer, type FaceServer } from "./face.server.js";

const DEFAULT_PORT = 4321;
const PORT_ATTEMPTS = 5;

export class FaceService {
  private server: FaceServer | undefined;

  async start(): Promise<void> {
    const preferredPort = Number(process.env.FACE_PORT) || DEFAULT_PORT;

    // Si el puerto está ocupado (ej. un proceso viejo escuchando),
    // probamos los siguientes en lugar de quedarnos sin cara.
    for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
      const port = preferredPort + attempt;

      try {
        this.server = await startFaceServer(port);
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code === "EADDRINUSE" &&
          attempt < PORT_ATTEMPTS - 1
        ) {
          continue;
        }

        console.warn(
          `⚠️  No se pudo iniciar la cara de Elara (puerto ${port} ocupado). Seguí sin avatar.`,
        );
        return;
      }

      console.log(`😊 Cara de Elara: ${this.server.url}`);
      openBrowser(this.server.url);
      return;
    }
  }

  setExpression(emotion: ElaraEmotion): void {
    this.server?.broadcast({
      type: "expression",
      expression: EMOTION_EXPRESSIONS[emotion],
    });
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

  async stop(): Promise<void> {
    await this.server?.close();
  }
}

function openBrowser(url: string): void {
  execFile("cmd.exe", ["/c", "start", "", url], (error) => {
    if (error) {
      console.warn(`⚠️  No pude abrir el navegador. Entrá a ${url} a mano.`);
    }
  });
}
