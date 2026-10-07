import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const VENDOR_DIR = fileURLToPath(new URL("./vendor", import.meta.url));

const MIME_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".moc3": "application/octet-stream",
  ".vrm": "application/octet-stream",
};

/** Límite de los POST (notas de voz del navegador). */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function serveStatic(url: string, res: ServerResponse): void {
  const decoded = decodeURIComponent(url.split("?")[0] ?? "");
  const relative = decoded.replace(/^\/vendor\//, "");
  const filePath = path.normalize(path.join(VENDOR_DIR, relative));

  // Evitar path traversal fuera de vendor/.
  if (!filePath.startsWith(VENDOR_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }

  readFile(filePath)
    .then((content) => {
      const mime =
        MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime });
      res.end(content);
    })
    .catch(() => {
      res.writeHead(404);
      res.end();
    });
}

export type FaceEvent =
  | { type: "expression"; expression: string }
  | { type: "speak"; on: boolean }
  | { type: "gesture"; gesture: string }
  | {
      type: "reply";
      text: string;
      emotion: string;
      /** Gesto corporal pedido con [gesture:...] (opcional). */
      gesture?: string | undefined;
      hasAudio: boolean;
      /** Voz de ElevenLabs en base64 (para animar la boca con audio real). */
      audio?: string | undefined;
    }
  | { type: "status"; status: "idle" | "thinking" | "speaking" };

/** Lo que la ventana necesita para mostrar la respuesta y animar la boca. */
export interface ChatReply {
  /** Texto sin tags de emoción, tal como se muestra en el chat. */
  display: string;
  /** Emoción detectada en los tags ([excited], …). */
  emotion: string;
  /** Gesto corporal detectado en los tags ([gesture:wave], …). */
  gesture?: string | undefined;
  /** Audio WAV en base64 (si ElevenLabs respondió). */
  audio?: string | undefined;
}

export interface FaceHandlers {
  onChat(text: string): Promise<ChatReply>;
  onTranscribe?(audio: Buffer, extension: string): Promise<string | undefined>;
}

export interface FaceServer {
  port: number;
  url: string;
  /** Cuántas ventanas/navegadores están mirando la cara. */
  viewerCount(): number;
  broadcast(event: FaceEvent): void;
  close(): Promise<void>;
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("body demasiado grande");
    }
    chunks.push(buf);
  }

  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = (await readBody(req)).toString("utf-8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function startFaceServer(
  port = 4321,
  handlers?: FaceHandlers,
): Promise<FaceServer> {
  const clients = new Set<ServerResponse>();

  const appHtml = await readFile(
    fileURLToPath(new URL("./pixel.html", import.meta.url)),
    "utf8",
  ).catch(() => "<h1>Falta pixel.html</h1>");

  const live2dHtml = await readFile(
    fileURLToPath(new URL("./avatar.html", import.meta.url)),
    "utf8",
  ).catch(() => "<h1>Falta avatar.html</h1>");

  const vrmHtml = await readFile(
    fileURLToPath(new URL("./vrm.html", import.meta.url)),
    "utf8",
  ).catch(() => "<h1>Falta vrm.html</h1>");

  const server: Server = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? "/";

      void handle(req, res, url).catch((error: unknown) => {
        console.error("❌ Error en el servidor de la cara:", error);
        if (!res.headersSent) json(res, 500, { ok: false, error: "error" });
        else res.end();
      });
    },
  );

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: string,
  ): Promise<void> {
    const method = req.method ?? "GET";

    if (url.startsWith("/vendor/")) {
      serveStatic(url, res);
      return;
    }

    if (url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("retry: 2000\n\n");
      clients.add(res);
      // Si la ventana muere de golpe (cierre, suspensión…), el socket puede
      // emitir EPIPE: lo sacamos del set en vez de dejar que crashee el nodo.
      res.on("error", () => {
        clients.delete(res);
      });
      req.on("close", () => {
        clients.delete(res);
      });
      return;
    }

    if (method === "POST" && url === "/api/chat") {
      const body = await readJson(req);
      const text = typeof body.text === "string" ? body.text.trim() : "";

      if (!text) {
        json(res, 400, { ok: false, error: "texto vacío" });
        return;
      }

      if (!handlers?.onChat) {
        json(res, 503, { ok: false, error: "sin sesión de Jarvis" });
        return;
      }

      const reply = await handlers.onChat(text);
      json(res, 200, { ok: true, reply });
      return;
    }

    if (method === "POST" && url === "/api/transcribe") {
      const body = await readJson(req);

      if (!handlers?.onTranscribe) {
        json(res, 503, { ok: false, error: "transcripción no disponible" });
        return;
      }

      const audioB64 = typeof body.audio === "string" ? body.audio : "";
      const ext = typeof body.ext === "string" ? body.ext : "webm";

      if (!audioB64) {
        json(res, 400, { ok: false, error: "audio vacío" });
        return;
      }

      const buffer = Buffer.from(audioB64, "base64");
      const text = await handlers.onTranscribe(buffer, ext.replace(/^\./, ""));
      json(res, 200, { ok: true, text: text ?? "" });
      return;
    }

    if (method === "GET" && url.startsWith("/live2d")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(live2dHtml);
      return;
    }

    if (method === "GET" && url === "/vrm") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(vrmHtml);
      return;
    }

    if (method === "GET" && (url === "/" || url.startsWith("/?"))) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(appHtml);
      return;
    }

    if (method === "GET" && url === "/health") {
      json(res, 200, { ok: true, viewers: clients.size });
      return;
    }

    json(res, 404, { ok: false, error: "no existe" });
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  return {
    port,
    url: `http://localhost:${port}`,

    viewerCount(): number {
      return clients.size;
    },

    broadcast(event: FaceEvent): void {
      const data = `data: ${JSON.stringify(event)}\n\n`;
      // Un viewer muerto a mitad de write no puede tirar abajo a Jarvis: si
      // falla (EPIPE, write after end…), simplemente lo damos de baja.
      for (const client of clients) {
        try {
          client.write(data);
        } catch {
          clients.delete(client);
        }
      }
    },

    async close(): Promise<void> {
      for (const client of clients) {
        client.end();
      }
      clients.clear();

      await new Promise<void>((resolve) => {
        // El EventSource de la ventana se reconecta solo: sin esto,
        // server.close() esperaría una conexión que nunca se cierra.
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };

        server.close(finish);
        server.closeAllConnections?.();
        setTimeout(finish, 1500);
      });
    },
  };
}
