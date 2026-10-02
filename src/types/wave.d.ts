declare module "wave" {
  export interface WaveFile {
    getframerate(): number;
    getnchannels(): number;
    getnframes(): number;
    readframes(numFrames: number): Buffer;
    close(): void;
  }

  export function open(filename: string, mode: string): WaveFile;
}
