import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { validateConfig } from "./config.js";
import { Jarvis } from "./jarvis.js";
import { reminderFirePrompt } from "./ai/reminders.js";
import { VoiceService } from "./voice/voice.service.js";
import { playAudio } from "./voice/audio-player.js";
import { transcribeAudio } from "./voice/audio-tools.js";
import { FaceService } from "./face/face.service.js";
import { JarvisSession, base64ToBuffer } from "./session.js";

const config = validateConfig();

const jarvis = new Jarvis(config);
const voice = new VoiceService(config.elevenlabs);

// La ventana (Electron/navegador) entra por la misma sesión que la terminal.
let session: JarvisSession | undefined;

const face = new FaceService({
  onChat: (text) => sessionRef().send(text),
  onTranscribe: (audio, extension) => transcribeAudio(audio, extension),
});

session = new JarvisSession(jarvis, voice, face);

// Los recordatorios los entrega este canal: avisa en la terminal/ventana y
// habla si nadie está mirando la cara.
jarvis.reminders.start((reminder, overdueMs) => {
  void (async () => {
    console.log(`⏰ Recordatorio: ${reminder.message}`);
    const reply = await sessionRef().send(
      reminderFirePrompt(reminder, overdueMs),
    );
    await speakIfAlone(reply.audio);
  })();
});

function sessionRef(): JarvisSession {
  if (!session) throw new Error("Jarvis todavía no arrancó.");
  return session;
}

const readline = createInterface({
  input,
  output,
});

async function main(): Promise<void> {
  await jarvis.initialize();
  await face.start();

  console.log("🤖 Jarvis en línea.");
  console.log("Escribí 'salir' para cerrar la conversación.\n");

  while (true) {
    let message: string;

    try {
      message = await readline.question("Tú: ");
    } catch (error) {
      // stdin cerrado (EOF): salir con gracia.
      if ((error as NodeJS.ErrnoException)?.code !== "ERR_USE_AFTER_CLOSE") {
        console.error("❌ Error leyendo la entrada:", error);
      }
      break;
    }

    if (message.trim().toLowerCase() === "salir") {
      console.log("\n🤖 Jarvis: Hasta luego, Fran.");
      break;
    }

    if (!message.trim()) {
      continue;
    }

    try {
      const reply = await sessionRef().send(message);
      console.log(`Jarvis: ${reply.display}\n`);

      await speakIfAlone(reply.audio);
    } catch (error) {
      console.error("❌ Error al hablar con Jarvis:", error);
      // Él corta la charla con estilo, no con un stack trace.
      console.log(
        "Jarvis: Se me cruzaron los cables un segundo. Probá de nuevo, que ya estoy.\n",
      );
    }
  }

  readline.close();

  // Cerramos la ventana/servidor y dejamos la conversación guardada antes de
  // que el proceso termine (si no, el guardado programado se pierde).
  await face.stop();
  await jarvis.flush();
}

/**
 * Si hay ventana, el audio lo reproduce ella (y anima la boca en tiempo real).
 * Si no hay nadie mirando, lo escuchamos en la terminal como hasta ahora.
 */
async function speakIfAlone(audioBase64: string | undefined): Promise<void> {
  if (face.hasViewers()) return;

  if (!audioBase64) {
    console.log("🔇 Sin voz esta vez (ElevenLabs no respondió).");
    return;
  }

  console.log("🔊 Jarvis está hablando...");
  face.startSpeaking();

  try {
    await playAudio(base64ToBuffer(audioBase64));
  } catch (error) {
    console.warn("⚠️  No pude reproducir el audio:", error);
  } finally {
    face.stopSpeaking();
  }
}

main()
  .then(() => exitSoon(0))
  .catch((error: unknown) => {
    console.error("❌ Error inesperado:", error);
    readline.close();
    exitSoon(1);
  });

/** Sale dejando que stdout termine de escribir (si no se pierde el adiós). */
function exitSoon(code: number): void {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    process.exit(code);
  };

  const timer = setTimeout(finish, 1000);
  process.stdout.write("", () => {
    clearTimeout(timer);
    finish();
  });
}
