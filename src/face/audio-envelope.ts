import wave from "wave";

// Patrón global para generar parámetros consistentes
let _globalSeed = 0;

export interface AudioFrame {
  start: number;
  end: number;
  cummulative: number;
  eyeOpen: number;
  mouthForm: number;
  eyeForm: number;
  eyeBallForm: number;
  tere: number;
  browLY: number;
  browRY: number;
  browLForm: number;
  browRForm: number;
  browLX: number;
  browRX: number;
  browLAngle: number;
  browRAngle: number;
  headTilt: number;
  headYaw: number;
  breath: number;
  blink: number;
  leftEyeSmile: number;
  rightEyeSmile: number;
  emotion: string;
  // Parámetros de cuerpo para animación más realista
  bodyAngleX: number;
  bodyAngleY: number;
  breathAmount: number;
  shoulderMove: number;
  // Información para parpadeo contextual
  isPause: boolean;
  pauseDuration: number;
}

export interface AudioFrameResult {
  frames: AudioFrame[];
  sampleRate: number;
}

function smoothArray(arr: number[], windowSize: number): number[] {
  const result: number[] = [];
  const half = Math.floor(windowSize / 2);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = -half; j <= half; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < arr.length) {
        sum += arr[idx] ?? 0;
        count++;
      }
    }
    result.push(sum / count);
  }
  return result;
}

function detectSilence(energy: number[], threshold: number, minSilenceFrames: number): { isSilence: boolean[]; silenceStart: number[]; silenceDuration: number[] } {
  const isSilence: boolean[] = [];
  const silenceDuration: number[] = [];
  
  let inSilence = false;
  let silenceStartFrame = 0;
  
  for (let i = 0; i < energy.length; i++) {
    const silent = (energy[i] ?? 0) < threshold;
    isSilence.push(silent);
    silenceDuration.push(0);
    
    if (silent && !inSilence) {
      inSilence = true;
      silenceStartFrame = i;
    }
    
    if (!silent && inSilence) {
      inSilence = false;
      const duration = i - silenceStartFrame;
      for (let j = silenceStartFrame; j < i; j++) {
        silenceDuration[j] = duration;
      }
    }
  }
  
  return { isSilence, silenceStart: [], silenceDuration };
}

function generateRandomWalk(seed: number, length: number, amplitude: number, frequency: number): number[] {
  const result: number[] = [];
  let value = 0;
  
  for (let i = 0; i < length; i++) {
    // Pseudo-random basado en seed para reproducibilidad
    const t = i / length * frequency * Math.PI * 2;
    const noise = Math.sin(t + seed) * 0.5 + Math.sin(t * 1.7 + seed * 2) * 0.3 + Math.sin(t * 3.1 + seed * 0.5) * 0.2;
    value += (noise - value) * 0.1; // Suavizado
    result.push(value * amplitude);
  }
  
  return result;
}

function getGlobalSeed(): number {
  _globalSeed = (_globalSeed + 1) % 10000;
  return _globalSeed;
}

export function extractAudioEnvelope(audioPath: string): AudioFrameResult {
  const wav = wave.open(audioPath, "rb");
  const sampleRate = wav.getframerate();
  const channelCount = wav.getnchannels();
  const frameCount = wav.getnframes();
  const audioData = new Float32Array(frameCount * channelCount);

  for (let i = 0; i < frameCount; i++) {
    const buf = wav.readframes(1);
    if (!buf || buf.length < 2) {
      continue;
    }
    audioData[i * channelCount] = buf.readInt16LE(0) / 32768;
    if (channelCount > 1 && buf.length >= 4) {
      audioData[i * channelCount + 1] = buf.readInt16LE(1) / 32768;
    }
  }

  wav.close();

  const frames: AudioFrame[] = [];
  const hopLength = 512;
  const windowSize = 1024;
  const fps = sampleRate / hopLength;

  // Primera pasada: calcular energía por frame
  const energyData: { rms: number; start: number; end: number }[] = [];
  
  for (let i = 0; i < frameCount - windowSize; i += hopLength) {
    const start = i / sampleRate;
    const end = (i + windowSize) / sampleRate;

    let energy = 0;
    for (let j = 0; j < windowSize; j++) {
      const idx = (i + j) * channelCount;
      if (idx >= 0 && idx < audioData.length) {
        energy += audioData[idx]! * audioData[idx]!;
      }
    }
    const rms = Math.sqrt(energy / windowSize);
    energyData.push({ rms, start, end });
  }

  if (energyData.length === 0) {
    return { frames: [], sampleRate };
  }

  // Detectar silencios
  const energyValues: number[] = [];
  for (let i = 0; i < energyData.length; i++) {
    const e = energyData[i];
    if (e) energyValues.push(e.rms);
  }
  const maxRms = Math.max(...energyValues, 0.001);
  const normalizedEnergy: number[] = [];
  for (const v of energyValues) {
    normalizedEnergy.push(Math.min(1, v / maxRms * 3));
  }
  const silenceResult = detectSilence(normalizedEnergy, 0.08, 10);
  const isSilence = silenceResult.isSilence;
  const silenceDuration = silenceResult.silenceDuration;

  // Generar movimientos aleatorios para naturalidad
  const seed = getGlobalSeed();
  const headNod = generateRandomWalk(seed, energyData.length, 0.12, 2.5);
  const headSway = generateRandomWalk(seed + 100, energyData.length, 0.08, 1.8);
  const bodySway = generateRandomWalk(seed + 200, energyData.length, 0.06, 1.2);
  const breathCycle = generateRandomWalk(seed + 300, energyData.length, 0.3, 0.4);

  // Suavizar energía para evitar saltos bruscos
  const smoothedEnergy = smoothArray(normalizedEnergy, 3);

  for (let i = 0; i < energyData.length; i++) {
    const frameData = energyData[i];
    if (!frameData) continue;
    const normalizedPower = smoothedEnergy[i] ?? 0;
    const silent = isSilence[i] || false;
    const pauseDur = silenceDuration[i] || 0;

    // Boca: más responsive pero con suavizado
    const mouthOpenRaw = Math.max(0, normalizedPower * 1.8 - 0.15);
    const mouthOpenY = (silent || false) ? mouthOpenRaw * 0.3 : mouthOpenRaw;

    // CEJAS: reaccionan a la entonación (grados de energía)
    // Suben con energía, bajan en silencio
    const browBase = (silent || false) ? -0.15 : 0;
    const browEnergyVal = Math.max(-0.5, Math.min(0.8, normalizedPower * 1.5 - 0.3));
    const browLY = browBase + browEnergyVal * 0.7;
    const browRY = browBase + browEnergyVal * 0.7;

    // BRows form/angle: asimetría sutil para naturalidad
    const asymmetry = Math.sin(i * 0.1 + seed) * 0.15;
    const browLForm = Math.max(-0.5, Math.min(0.5, browEnergyVal * 0.5 + asymmetry));
    const browRForm = Math.max(-0.5, Math.min(0.5, browEnergyVal * 0.5 - asymmetry));
    const browLX = Math.max(-0.3, Math.min(0.3, normalizedPower * 0.4 - 0.1 + asymmetry * 0.5));
    const browRX = Math.max(-0.3, Math.min(0.3, normalizedPower * 0.4 - 0.1 - asymmetry * 0.5));
    const browLAngle = Math.max(-0.4, Math.min(0.4, normalizedPower * 0.3 - 0.1));
    const browRAngle = Math.max(-0.4, Math.min(0.4, normalizedPower * 0.3 - 0.1));

    // OJOS: parpadeo semi-natural + apertura por energía
    // Parpadeo espontáneo (no solo random simple)
    const blinkProbability = silent ? 0.02 : 0.008; // Más parpadeos en silencio (pensando)
    const blinkVal = Math.random() < blinkProbability ? 1 : 0;
    
    // Los ojos se abren menos cuando hay mucha energía (sonrisa, emoción)
    const eyeOpenBase = silent ? 0.95 : Math.max(0.5, 1 - normalizedPower * 0.25);
    const eyeOpen = blinkVal ? 0.1 : eyeOpenBase;

    // EyeForm: forma de ojo (sonrisa cierra ligeramente)
    const eyeForm = Math.max(0, 1 - normalizedPower * 0.3);
    const eyeBallForm = Math.max(0, 1 - normalizedPower * 0.2);

    // Tere (desenfoque sonriente)
    const tere = Math.max(0, Math.min(1, normalizedPower * 1.5 - 0.2));

    // HEAD: movimiento más natural con componentes múltiples
    const headTiltVal = (headNod[i] ?? 0) * ((silent || false) ? 0.4 : 1.0) + normalizedPower * 0.05;
    const headYawVal = (headSway[i] ?? 0) * ((silent || false) ? 0.5 : 0.8) + normalizedPower * 0.03;

    // BODY: movimiento de torso (ángulos del modelo)
    const bodyAngleXVal = (bodySway[i] ?? 0) * 0.5 + normalizedPower * 0.08;
    const bodyAngleYVal = Math.sin(i * 0.05) * 0.03 + normalizedPower * 0.04;

    // BRECHT (respiración): más evidente en silencio, sigue durante habla
    const breathBase = (breathCycle[i] ?? 0) * 0.4;
    const breathVal = (silent || false) ? breathBase * 0.8 : breathBase * 0.3 + normalizedPower * 0.1;

    // Shoulder/ hombro: se contraen ligeramente al hablar
    const shoulderMoveVal = (silent || false) ? 0 : normalizedPower * 0.15;

    // SILLAS DE OJOS (sonrisa)
    const leftEyeSmileVal = Math.max(0, Math.min(1, normalizedPower * 0.6 + 0.2));
    const rightEyeSmileVal = Math.max(0, Math.min(1, normalizedPower * 0.6 + 0.2));

    // MOUTH FORM: variación más rica
    const mouthFormVal = Math.sin(normalizedPower * Math.PI * 1.5) * 0.6 + normalizedPower * 0.3;

    // EMOCIÓN: detección un poco más avanzada
    let emotion = "neutral";
    if (normalizedPower > 0.7 && normalizedPower < 0.85) {
      emotion = "excited";
    } else if (normalizedPower > 0.85) {
      emotion = "excited";
    } else if ((silent || false) && pauseDur > 0.5) {
      emotion = "shy";
    }

    frames.push({
      start: frameData.start,
      end: frameData.end,
      cummulative: mouthOpenY,
      eyeOpen: eyeOpen,
      mouthForm: mouthFormVal,
      eyeForm,
      eyeBallForm,
      tere,
      browLY,
      browRY,
      browLForm,
      browRForm,
      browLX,
      browRX,
      browLAngle,
      browRAngle,
      headTilt: headTiltVal,
      headYaw: headYawVal,
      breath: breathVal,
      blink: blinkVal,
      leftEyeSmile: leftEyeSmileVal,
      rightEyeSmile: rightEyeSmileVal,
      emotion,
      bodyAngleX: bodyAngleXVal,
      bodyAngleY: bodyAngleYVal,
      breathAmount: breathVal,
      shoulderMove: shoulderMoveVal,
      isPause: silent ?? false,
      pauseDuration: pauseDur ?? 0,
    });
  }

  return { frames, sampleRate };
}

const SAMPLE_RATE = 22050;
