import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function playAudio(
  stream: ReadableStream<Uint8Array>,
): Promise<void> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (value) {
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const audioBuffer = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
  );

  const audioPath = path.join(
    process.cwd(),
    "temp-elara.wav",
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