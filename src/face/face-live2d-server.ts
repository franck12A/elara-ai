import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { EventEmitter } from "node:events";
import { startLive2DSession } from "./live2d-session.js";

const VENDOR_DIR = fileURLToPath(new URL("./vendor", import.meta.url));
const HTML_PATH = fileURLToPath(new URL("./avatar.html", import.meta.url));
const PORT = Number(process.env.FACE_PORT || 4321);
const PORT_ATTEMPTS = 5;

const mime: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".moc3": "application/octet-stream",
  ".png": "image/png",
  "": "text/html; charset=utf-8",
};

async function serveFile(url: string, res: ServerResponse): Promise<void> {
  const decoded = decodeURIComponent(url.split("?")[0] ?? "");
  const relative = decoded.replace(/^\//, "");
  const filePath = path.normalize(path.join(VENDOR_DIR, relative));
  if (!filePath.startsWith(VENDOR_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mime[ext] ?? "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end();
  }
}

export interface Live2DClient {
  res: ServerResponse;
  close: () => void;
}

export type SessionEvent =
  | { type: "speak"; on: boolean }
  | {
      type: "params";
      timestamp: number;
      mouthOpenY: number;
      leftEyeOpen: number;
      rightEyeOpen: number;
      leftEyeSmile: number;
      rightEyeSmile: number;
      browLY: number;
      browRY: number;
      browLForm: number;
      browRForm: number;
      browLX: number;
      browRX: number;
      browLAngle: number;
      browRAngle: number;
      mouthForm: number;
      eyeForm: number;
      eyeBallForm: number;
      tere: number;
      headTilt: number;
      headYaw: number;
      headZoom: number;
      breath: number;
      blink: number;
      expression: string;
      intensity: number;
      // Nuevos parámetros para animación más realista
      bodyAngleX: number;
      bodyAngleY: number;
      breathAmount: number;
      shoulderMove: number;
      isPause: boolean;
      pauseDuration: number;
    };

export async function startFaceServer(port = PORT): Promise<{
  port: number;
  url: string;
  session: EventEmitter;
  close: () => Promise<void>;
}> {
  const clients: Set<ServerResponse> = new Set();
  const session = new EventEmitter();

  const html = await readFile(HTML_PATH, "utf8");

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";

    if (url.startsWith("/vendor/")) {
      serveFile(url, res);
      return;
    }

    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "Content-Type": mime[""] });
      res.end(html);
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
      req.on("close", () => {
        clients.delete(res);
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const close = async () => {
    for (const c of clients) c.destroy();
    clients.clear();
    session.removeAllListeners();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

  const start = (port: number) =>
    new Promise<void>((resolve, reject) => {
      try {
        server.listen(port, () => resolve());
      } catch (err) {
        reject(err as NodeJS.ErrnoException);
      }
    });

  try {
    await start(port);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    for (let attempt = 1; attempt < PORT_ATTEMPTS; attempt++) {
      const nextPort = port + attempt;
      try {
        await start(nextPort);
        return {
          port: nextPort,
          url: `http://localhost:${nextPort}`,
          session,
          close,
        };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE" || attempt >= PORT_ATTEMPTS - 1) {
          throw e;
        }
      }
    }
    throw new Error(`Could not start FaceServer on any port in [${port},${port + PORT_ATTEMPTS - 1}]`);
  }

  const live2dSession = startLive2DSession(session);

  return {
    port,
    url: `http://localhost:${port}`,
    session,
    close: async () => {
      live2dSession.destroy();
      await close();
    },
  };
}

function emitClients(event: SessionEvent, clients: Set<ServerResponse>): void {
  const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) {
    try {
      c.write(data);
    } catch {
      clients.delete(c);
    }
  }
}

// Re-export un helper externo que otras partes del sistema pueden usar para
// enviar parámetros en caliente sin esperar el pipeline completo.
export { emitClients as broadcastLive2DParams };
