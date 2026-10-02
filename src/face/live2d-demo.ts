import { startFaceServer } from "./face-live2d-server.js";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const port = Number(process.env.FACE_PORT || 4321);

  const server = await startFaceServer(port);
  console.log(`Servidor Live2D iniciado en http://localhost:${server.port}`);
  console.log("Abrí el navegador en:", server.url);

  const audioPath = path.join(__dirname, "../../voice.wav");
  const jsonPath = path.join(__dirname, "../../face_landmarks.json");

  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  await delay(1000);

  const eventSource = new EventSource(`${server.url}/events`);

  eventSource.onopen = () => {
    console.log("Conectado a eventos SSE");
  };

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "speak") {
      console.log("Habla:", data.on ? "INICIO" : "FIN");
    } else if (data.type === "params") {
      console.log("Parámetros:", data);
    }
  };

  eventSource.onerror = () => {
    console.log("Error de conexión SSE");
  };

  await delay(2000);

  console.log("El servidor está listo. Abrí un navegador en", server.url, "para ver la cara de Elara.");
  console.log("Presioná Ctrl+C para detener el servidor.");

  // Evitar que el proceso termine
  process.stdin.resume();
}

main().catch(console.error);
