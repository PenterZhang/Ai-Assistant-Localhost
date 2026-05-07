import { app, BrowserWindow, powerSaveBlocker, nativeImage } from "electron";
import path from "path";
import fs from "fs";

const ROOT = app.isPackaged ? app.getAppPath() : process.cwd();
const PORT = (() => {
    try {
        return (
            JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf-8"))
                .port || 18789
        );
    } catch {
        return 18789;
    }
})();
const isDev = !app.isPackaged;

let win: BrowserWindow | null = null;
let blockerId: number | null = null;

function createWindow() {
    const iconPath = path.join(ROOT, "src", "assets", "logo.png");
    let icon;
    try {
        if (fs.existsSync(iconPath))
            icon = nativeImage.createFromPath(iconPath);
    } catch {}

    win = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: "甲核",
        titleBarStyle: "hiddenInset",
        backgroundColor: "#060606",
        icon,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    // ✅ 先显示加载中页面
    win.loadURL(
        `data:text/html,<html><body style="background:#060606;color:#6a655c;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>甲核 启动中...</p></body></html>`,
    );

    win.on("close", (e) => {
        if (!(app as any)._quitting) {
            e.preventDefault();
            win?.hide();
        }
    });
}

app.whenReady().then(async () => {
    // Dock 图标
    if (process.platform === "darwin" && app.dock) {
        const iconPath = path.join(ROOT, "src", "assets", "logo.png");
        try {
            if (fs.existsSync(iconPath))
                app.dock.setIcon(nativeImage.createFromPath(iconPath));
        } catch {}
    }

    // ✅ 先创建窗口，让用户看到东西
    createWindow();

    // ✅ 再启动 server
    if (!isDev) {
        try {
            // ✅ 把 ROOT 传给 server
            process.env.APP_ROOT = ROOT;
            const { startServer } = require(
                path.join(ROOT, "dist", "node", "server", "core", "index"),
            );
            await startServer();
        } catch (e) {
            console.error("[Electron] server start failed:", e);
        }
    }

    // ✅ server 启动后，加载实际页面
    if (win) {
        const url = isDev
            ? "http://localhost:5173"
            : `http://127.0.0.1:${PORT}`;
        win.loadURL(url);
    }

    blockerId = powerSaveBlocker.start("prevent-app-suspension");

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
