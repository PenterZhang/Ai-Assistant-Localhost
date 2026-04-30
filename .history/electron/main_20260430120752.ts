import { app, BrowserWindow, powerSaveBlocker } from "electron";
import path from "path";
import fs from "fs";

// ✅ process.cwd() 永远指向项目根目录
const ROOT = process.cwd();
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf-8"));
const PORT = CFG.port || 18789;

let win: BrowserWindow | null = null;
let blockerId: number | null = null;

async function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#060606",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadURL(`http://127.0.0.1:${PORT}`);

  win.on("close", (e) => {
    if (!(app as any)._quitting) {
      e.preventDefault();
      win?.hide();
    }
  });
}

app.whenReady().then(async () => {
  const { startServer } = require("../server/index");
  await startServer();

  blockerId = powerSaveBlocker.start("prevent-app-suspension");

  await createWindow();

  app.on("activate", () => {
    if (!win) createWindow();
    else win.show();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  (app as any)._quitting = true;
  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
    powerSaveBlocker.stop(blockerId);
  }
});
