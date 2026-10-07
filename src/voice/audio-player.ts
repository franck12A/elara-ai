import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function collectStream(
  stream: ReadableStream<Uint8Array>,
): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

export async function playAudio(
  input: ReadableStream<Uint8Array> | Buffer,
): Promise<void> {
  const audioBuffer = Buffer.isBuffer(input)
    ? input
    : await collectStream(input);

  const audioPath = path.join(
    process.cwd(),
    "temp-jarvis.wav",
  );

  await fs.writeFile(audioPath, audioBuffer);

  try {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$player = New-Object System.Media.SoundPlayer('${audioPath.replace(/'/g, "''")}'); $player.PlaySync();`,
      ],
    );
  } finally {
    await fs.rm(audioPath, { force: true });
  }
}