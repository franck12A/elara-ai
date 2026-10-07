import { execFile } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import Groq from "groq-sdk";

const execFileAsync = promisify(execFile);

const DEFAULT_WHISPER_MODEL = "whisper-large-v3-turbo";

let ffmpegCheck: Promise<boolean> | undefined;

/** ¿Hay ffmpeg disponible en el PATH? (se chequea una sola vez) */
export function hasFfmpeg(): Promise<boolean> {
  ffmpegCheck ??= execFileAsync("ffmpeg", ["-version"])
    .then(() => true)
    .catch(() => false);
  return ffmpegCheck;
}

async function runFfmpeg(args: string[]): Promise<void> {
  await execFileAsync("ffmpeg", ["-y", ...args], {
    maxBuffer: 16 * 1024 * 1024,
  });
}

async function withTempFiles<T>(
  suffixes: string[],
  fn: (paths: string[]) => Promise<T>,
): Promise<T> {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const paths = suffixes.map((suffix, i) =>
    path.join(os.tmpdir(), `jarvis-wa-${id}-${i}${suffix}`),
  );

  try {
    return await fn(paths);
  } finally {
    await Promise.all(
      paths.map((p) => fs.rm(p, { force: true })),
    );
  }
}

/**
 * Convierte un WAV ( ElevenLabs, 22050 Hz mono ) en OGG/Opus,
 * el formato que WhatsApp acepta como nota de voz (ptt).
 */
export async function wavToVoiceNote(wav: Buffer): Promise<Buffer> {
  return withTempFiles([".wav", ".ogg"], async ([inPath, outPath]) => {
    await fs.writeFile(inPath!, wav);
    await runFfmpeg([
      "-i", inPath!,
      "-c:a", "libopus",
      "-b:a", "32k",
      "-ar", "48000",
      "-ac", "1",
      "-application", "voip",
      outPath!,
    ]);
    return fs.readFile(outPath!);
  });
}

/** Cualquier audio (OGG/Opus de WhatsApp, mp3, …) a WAV 16 kHz mono para Whisper. */
async function toWav16k(input: Buffer, extension: string): Promise<Buffer> {
  const ext = extension.startsWith(".") ? extension : `.${extension}`;

  return withTempFiles([ext, ".wav"], async ([inPath, outPath]) => {
    await fs.writeFile(inPath!, input);
    await runFfmpeg([
      "-i", inPath!,
      "-ar", "16000",
      "-ac", "1",
      "-c:a", "pcm_s16le",
      outPath!,
    ]);
    return fs.readFile(outPath!);
  });
}

/**
 * Transcribe un audio con Groq Whisper (tier gratis).
 * Devuelve undefined si no hay GROQ_API_KEY configurada.
 */
export async function transcribeAudio(
  audio: Buffer,
  extension: string,
): Promise<string | undefined> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return undefined;
  }

  const wav = await toWav16k(audio, extension);
  const model = process.env.GROQ_WHISPER_MODEL || DEFAULT_WHISPER_MODEL;

  return withTempFiles([".wav"], async ([wavPath]) => {
    await fs.writeFile(wavPath!, wav);

    const groq = new Groq({ apiKey });
    const transcription = await groq.audio.transcriptions.create({
      file: createReadStream(wavPath!),
      model,
      language: "es",
      response_format: "json",
    });

    return transcription.text.trim();
  });
}
