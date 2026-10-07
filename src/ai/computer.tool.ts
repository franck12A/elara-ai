import { spawn } from "node:child_process";
import type { JarvisTool } from "./tools.js";

type ComputerAction =
  | "open"
  | "volume_up"
  | "volume_down"
  | "volume_mute"
  | "lock";

/** Códigos de tecla multimedia de Windows para SendKeys. */
const VK_VOLUME_UP = 175;
const VK_VOLUME_DOWN = 174;
const VK_VOLUME_MUTE = 173;
/** Pulsaciones por llamada (cada una ≈ 2% de volumen). */
const VOLUME_STEPS = 5;

function fireDetached(command: string, args: string[]): void {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", (error) => {
    console.warn(`⚠️  No pude ejecutar "${command}":`, error);
  });
  child.unref();
}

async function runWindowsCommand(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (!command) throw new Error("comando vacío");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, rest, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`exit ${code}`));
    });
  });
}

async function runPowerShell(script: string): Promise<void> {
  await runWindowsCommand([
    "powershell",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ]);
}

async function setVolume(action: ComputerAction): Promise<string> {
  if (process.platform !== "win32") {
    return "Esta acción de volumen solo está disponible en Windows (por ahora).";
  }

  const vk =
    action === "volume_up"
      ? VK_VOLUME_UP
      : action === "volume_down"
        ? VK_VOLUME_DOWN
        : VK_VOLUME_MUTE;
  const repeats = action === "volume_mute" ? 1 : VOLUME_STEPS;

  const script =
    `$w = New-Object -ComObject WScript.Shell; ` +
    `1..${repeats} | ForEach-Object { $w.SendKeys([char]${vk}) }`;
  await runPowerShell(script);

  if (action === "volume_mute") return "Volumen silenciado.";
  if (action === "volume_up") return "Subí el volumen un poco.";
  return "Bajé el volumen un poco.";
}

export function createComputerTool(): JarvisTool {
  return {
    name: "computer",

    description:
      "Controla la PC de Fran: abrir una app o sitio web, subir/bajar/silenciar " +
      "el volumen o bloquear la pantalla. Usala SOLO cuando Fran lo pida " +
      "explícitamente, nunca por iniciativa propia.",

    parameters: {
      type: "object",

      properties: {
        action: {
          type: "string",
          enum: ["open", "volume_up", "volume_down", "volume_mute", "lock"],
          description:
            "Acción: 'open' (abrir target), 'volume_up', 'volume_down', " +
            "'volume_mute' o 'lock' (bloquear la sesión de Windows).",
        },
        target: {
          type: "string",
          description:
            "Para 'open': nombre de la app (ej: 'chrome', 'spotify', 'code') " +
            "o URL (ej: 'https://github.com').",
        },
      },

      required: ["action"],
    },

    async execute(args): Promise<string> {
      const action = args.action as ComputerAction;

      switch (action) {
        case "open": {
          const target = args.target?.trim();
          if (!target) {
            return "Falta 'target': la app o la URL a abrir.";
          }

          const looksLikeUrl = /^https?:\/\//i.test(target);
          if (!looksLikeUrl && /[\\"/]/.test(target)) {
            return "Por seguridad solo abro apps instaladas o URLs, no rutas de archivos.";
          }

          if (process.platform === "win32") {
            fireDetached("cmd", ["/c", "start", "", target]);
          } else if (process.platform === "darwin") {
            fireDetached("open", [target]);
          } else {
            fireDetached("xdg-open", [target]);
          }

          return `Abriendo ${target}.`;
        }

        case "volume_up":
        case "volume_down":
        case "volume_mute":
          return setVolume(action);

        case "lock": {
          if (process.platform !== "win32") {
            return "Bloquear la pantalla solo está disponible en Windows (por ahora).";
          }
          fireDetached("rundll32.exe", ["user32.dll,LockWorkStation"]);
          return "Bloqueando la pantalla.";
        }

        default:
          return `Acción "${args.action}" no reconocida.`;
      }
    },
  };
}
