import { EventEmitter } from "node:events";
import { writeFileSync, existsSync } from "node:fs";
import { execSync, execFileSync } from "node:child_process";
import type { SessionEvent } from "./face-live2d-server.js";
import { extractAudioEnvelope, type AudioFrame, type AudioFrameResult } from "./audio-envelope.js";

interface SSEEmitter extends EventEmitter {
  emit(event: string, data: unknown): boolean;
}

export interface SessionConfig {
  audioPath?: string;
  jsonPath?: string;
  sink?: SSEEmitter;
}

export class Live2DSession {
  private sink: SSEEmitter;
  private audioFrames: AudioFrame[] = [];
  private sampleRate: number = 22050;
  private running = false;
  private looping = false;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private currentExpression: string = "neutral";
  private expressionChangeAt = 0;

  constructor(config: SessionConfig) {
    this.sink = config.sink ?? new EventEmitter() as unknown as SSEEmitter;
    if (config.audioPath) {
      this.loadAudio(config.audioPath);
    }
  }

  loadAudio(audioPath: string): void {
    const result = extractAudioEnvelope(audioPath);
    this.audioFrames = result.frames;
    this.sampleRate = result.sampleRate;
  }

  startSpeaking(audioPath?: string): void {
    if (audioPath) {
      this.loadAudio(audioPath);
    }
    if (this.audioFrames.length === 0) return;
    if (this.running) this.stopSpeaking();
    this.looping = true;
    this.running = true;
    this.currentExpression = "neutral";
    this.expressionChangeAt = 0;
    this.scheduleNextFrame();
  }

  stopSpeaking(): void {
    this.running = false;
    this.looping = false;
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    this.broadcastDefaultParams();
  }

  private broadcastDefaultParams(): void {
    this.emitParams(0);
  }

  private scheduleNextFrame(): void {
    if (!this.looping) return;

    const now = Date.now() / 1000;
    const eps = 1e-4;

    // Buscar primer frame cuya ventana de tiempo pase por ahora
    for (const frame of this.audioFrames) {
      if (frame.start - eps <= now && now <= frame.end + eps) {
        this.emitParams(frame.start);
        // Siguiente frame al final de su ventana para mantener ritmo
        const delay = Math.max(0, (frame.end - now) * 1000);
        this.timeout = setTimeout(() => this.scheduleNextFrame(), delay);
        return;
      }
    }

    // Si llegamos aquí, avanzamos manualmente hasta el siguiente frame
    let nextFrame: AudioFrame | undefined;
    for (const frame of this.audioFrames) {
      if (frame.end > now) {
        nextFrame = frame;
        break;
      }
    }

    if (nextFrame) {
      const delay = Math.max(0, (nextFrame.start - now) * 1000);
      this.timeout = setTimeout(() => this.scheduleNextFrame(), delay);
    } else {
      // Fin del audio; parpadear o volver a empezar si looping
      if (this.looping) {
        this.stopSpeaking();
        setTimeout(() => {
          if (this.looping) this.startSpeaking();
        }, 2000);
      }
      this.running = false;
    }
  }

  private emitParams(referenceTime: number): void {
    if (this.audioFrames.length === 0) return;

    const now = Date.now() / 1000;
    const elapsed = now - referenceTime;

    // Parámetros por defecto (neutral)
    let mouthOpenY = 0;
    let leftEyeOpen = 1;
    let rightEyeOpen = 1;
    let leftEyeSmile = 0;
    let rightEyeSmile = 0;
    let browLY = 0;
    let browRY = 0;
    let browLForm = 0;
    let browRForm = 0;
    let browLX = 0;
    let browRX = 0;
    let browLAngle = 0;
    let browRAngle = 0;
    let mouthForm = 0;
    let eyeForm = 0;
    let eyeBallForm = 0;
    let tere = 0;
    let headTilt = 0;
    let headYaw = 0;
    let headZoom = 1;
    let breath = 0;
    let blink = 0;
    let emotion = "neutral";
    let intensity = 0;
    let bodyAngleX = 0;
    let bodyAngleY = 0;
    let breathAmount = 0;
    let shoulderMove = 0;
    let isPause = false;
    let pauseDuration = 0;

    // Buscar frame correspondiente al tiempo actual
    for (const frame of this.audioFrames) {
      if (frame.start - 1e-4 <= now && now <= frame.end + 1e-4) {
        // Envolvente vocal + parámetros derivados
        mouthOpenY = Math.max(0, Math.min(1, frame.cummulative));
        leftEyeOpen = Math.max(0, Math.min(1, 1 - Math.abs(frame.eyeOpen)));
        rightEyeOpen = Math.max(0, Math.min(1, 1 - Math.abs(frame.eyeOpen)));
        mouthForm = frame.mouthForm;
        eyeForm = frame.eyeForm;
        eyeBallForm = frame.eyeBallForm;
        tere = frame.tere;
        browLY = frame.browLY;
        browRY = frame.browRY;
        browLForm = frame.browLForm;
        browRForm = frame.browRForm;
        browLX = frame.browLX;
        browRX = frame.browRX;
        browLAngle = frame.browLAngle;
        browRAngle = frame.browRAngle;
        headTilt = frame.headTilt;
        headYaw = frame.headYaw;
        breath = frame.breath;
        blink = frame.blink;
        leftEyeSmile = frame.leftEyeSmile;
        rightEyeSmile = frame.rightEyeSmile;
        emotion = frame.emotion;
        intensity = Math.min(1, mouthOpenY);
        bodyAngleX = frame.bodyAngleX;
        bodyAngleY = frame.bodyAngleY;
        breathAmount = frame.breathAmount;
        shoulderMove = frame.shoulderMove;
        isPause = frame.isPause;
        pauseDuration = frame.pauseDuration;
        break;
      }
    }

    this.emitParamsFrame(
      this.currentExpression,
      mouthOpenY,
      leftEyeOpen,
      rightEyeOpen,
      leftEyeSmile,
      rightEyeSmile,
      browLY,
      browRY,
      browLForm,
      browRForm,
      browLX,
      browRX,
      browLAngle,
      browRAngle,
      mouthForm,
      eyeForm,
      eyeBallForm,
      tere,
      headTilt,
      headYaw,
      headZoom,
      breath,
      blink,
      emotion,
      intensity,
      bodyAngleX,
      bodyAngleY,
      breathAmount,
      shoulderMove,
      isPause,
      pauseDuration
    );
  }

  private emitParamsFrame(
    expression: string,
    mouthOpenY: number,
    leftEyeOpen: number,
    rightEyeOpen: number,
    leftEyeSmile: number,
    rightEyeSmile: number,
    browLY: number,
    browRY: number,
    browLForm: number,
    browRForm: number,
    browLX: number,
    browRX: number,
    browLAngle: number,
    browRAngle: number,
    mouthForm: number,
    eyeForm: number,
    eyeBallForm: number,
    tere: number,
    headTilt: number,
    headYaw: number,
    headZoom: number,
    breath: number,
    blink: number,
    emotion: string,
    intensity: number,
    bodyAngleX: number,
    bodyAngleY: number,
    breathAmount: number,
    shoulderMove: number,
    isPause: boolean,
    pauseDuration: number
  ): void {
    // Aplicar expresión si está por cambiar (basado en tiempo y contexto)
    if (this.expressionChangeAt > 0 && Date.now() / 1000 > this.expressionChangeAt) {
      expression = this.currentExpression;
      intensity = 1;
    }

    this.sink.emit("params", {
      type: "params",
      timestamp: Date.now(),
      mouthOpenY,
      leftEyeOpen,
      rightEyeOpen,
      leftEyeSmile,
      rightEyeSmile,
      browLY,
      browRY,
      browLForm,
      browRForm,
      browLX,
      browRX,
      browLAngle,
      browRAngle,
      mouthForm,
      eyeForm,
      eyeBallForm,
      tere,
      headTilt,
      headYaw,
      headZoom,
      breath,
      blink,
      expression,
      intensity,
      bodyAngleX,
      bodyAngleY,
      breathAmount,
      shoulderMove,
      isPause,
      pauseDuration,
    });
  }

  setExpression(name: string): void {
    this.currentExpression = name;
    this.expressionChangeAt = Date.now() / 1000 + 0.15;
  }

  setLoop(looping: boolean): void {
    this.looping = looping;
  }

  destroy(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    this.stopSpeaking();
  }
}

export function startLive2DSession(session: EventEmitter): Live2DSession {
  const cfg: SessionConfig = { sink: session as unknown as SSEEmitter };
  const inst = new Live2DSession(cfg);
  return inst;
}
