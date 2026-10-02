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
};

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
        MIME_TYPES[path.extname(filePath).toLowerCase()] ??
        "application/octet-stream";
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
  | { type: "speak"; on: boolean };

export interface FaceServer {
  port: number;
  url: string;
  broadcast(event: FaceEvent): void;
  close(): Promise<void>;
}

export async function startFaceServer(port = 4321): Promise<FaceServer> {
  const clients = new Set<ServerResponse>();

  const htmlPath = fileURLToPath(new URL("./avatar.html", import.meta.url));
  const html = await readFile(htmlPath, "utf8");

  const server: Server = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? "/";

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
        req.on("close", () => {
          clients.delete(res);
        });
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
      });
      res.end(html);
    }
  );

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

    broadcast(event: FaceEvent): void {
      const data = `data: ${JSON.stringify(event)}\n\n`;
      for (const client of clients) {
        client.write(data);
      }
    },

    async close(): Promise<void> {
      for (const client of clients) {
        client.end();
      }
      clients.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
