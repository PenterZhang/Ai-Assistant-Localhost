import { app, BrowserWindow, powerSaveBlocker } from "electron";
import path from "path";
import fs from "fs";

const ROOT = process.cwd();
const CFG = JSON.parse(
    fs.readFileSync(path.join(ROOT, "config.json"), "utf-8"),
);
const PORT = CFG.port || 18789;

// ✅ 开发模式：不打包时 isPackaged = false
const isDev = !app.isPackaged;

let win: BrowserWindow | null = null;
let blockerId: number | null = null;

function createWindow() {
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

    // ✅ 开发模式加载 Vite，生产模式加载自己的 server
    if (isDev) {
        win.loadURL("http://localhost:5173");
    } else {
        win.loadURL(`http://127.0.0.1:${PORT}`);
    }

    win.on("close", (e) => {
        if (!(app as any)._quitting) {
            e.preventDefault();
            win?.hide();
        }
    });
}

app.whenReady().then(async () => {
    // ✅ 生产模式才启动 server，开发模式由外部启动
    if (!isDev) {
        const { startServer } = require(
            path.join(ROOT, "dist", "node", "server", "index"),
        );
        await startServer();
    }

    blockerId = powerSaveBlocker.start("prevent-app-suspension");

    createWindow();

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
