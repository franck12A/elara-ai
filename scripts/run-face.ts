import { startFaceServer } from "../src/face/face.server.js";

const port = Number(process.env.FACE_PORT) || 4321;
const server = await startFaceServer(port);
console.log(`Face server en ${server.url}`);
