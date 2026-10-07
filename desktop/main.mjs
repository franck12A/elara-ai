// Ventana desktop de Jarvis (Electron).
// Se lanza con `npm run desktop` o automáticamente desde FaceService.
//
//   FACE_URL=http://localhost:4321/ npm run desktop
import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.FACE_URL || "http://localhost:4321/";
const TITLE = "Jarvis";

/** Evita que cada arranque abra una ventana más. */
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  let win = null;

  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  const createWindow = () => {
    win = new BrowserWindow({
      width: 460,
      height: 800,
      minWidth: 360,
      minHeight: 560,
      title: TITLE,
      backgroundColor: "#0c0c12",
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    win.once("ready-to-show", () => win.show());

    // Links externos salen en el navegador del sistema, no en la app.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });

    win.on("closed", () => {
      win = null;
    });

    void win.loadURL(APP_URL);
  };

  void app.whenReady().then(() => {
    createWindow();

    ipcMain.on("jarvis:minimize", () => win?.minimize());
    ipcMain.on("jarvis:close", () => win?.close());
    ipcMain.on("jarvis:always-on-top", (_event, on) => {
      win?.setAlwaysOnTop(Boolean(on));
    });

    // En macOS hay que reabrir la ventana si tocan el ícono en el dock.
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  // Si la ventana de la cara todavía no está, reintentamos cargar la URL.
  app.on("webContents-created", (_event, contents) => {
    contents.on("did-fail-load", (_e, code, description) => {
      console.error(`[Jarvis] no pude cargar la app (${code}): ${description}`);
      setTimeout(() => {
        if (win) void win.loadURL(APP_URL);
      }, 1500);
    });
  });

  // Si Jarvis se apaga, la ventana no tiene motivo para seguir abierta.
  const HEALTH_URL = new URL("/health", APP_URL).toString();
  let healthFailures = 0;

  setInterval(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    fetch(HEALTH_URL, { signal: controller.signal })
      .then(() => {
        healthFailures = 0;
      })
      .catch(() => {
        healthFailures += 1;
        // ~20 segundos sin servidor → cerramos solos.
        if (healthFailures >= 10) app.quit();
      })
      .finally(() => clearTimeout(timer));
  }, 2000);
}
