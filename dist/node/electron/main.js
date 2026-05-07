"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const ROOT = electron_1.app.isPackaged ? electron_1.app.getAppPath() : process.cwd();
const PORT = (() => {
    try {
        return (JSON.parse(fs_1.default.readFileSync(path_1.default.join(ROOT, "config.json"), "utf-8"))
            .port || 18789);
    }
    catch {
        return 18789;
    }
})();
const isDev = !electron_1.app.isPackaged;
let win = null;
let blockerId = null;
function createWindow() {
    const iconPath = path_1.default.join(ROOT, "src", "assets", "logo.png");
    let icon;
    try {
        if (fs_1.default.existsSync(iconPath))
            icon = electron_1.nativeImage.createFromPath(iconPath);
    }
    catch { }
    win = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: "甲核",
        titleBarStyle: "hiddenInset",
        backgroundColor: "#060606",
        icon,
        webPreferences: {
            preload: path_1.default.join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    // ✅ 先显示加载中页面
    win.loadURL(`data:text/html,<html><body style="background:#060606;color:#6a655c;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>甲核 启动中...</p></body></html>`);
    win.on("close", (e) => {
        if (!electron_1.app._quitting) {
            e.preventDefault();
            win?.hide();
        }
    });
}
electron_1.app.whenReady().then(async () => {
    // Dock 图标
    if (process.platform === "darwin" && electron_1.app.dock) {
        const iconPath = path_1.default.join(ROOT, "src", "assets", "logo.png");
        try {
            if (fs_1.default.existsSync(iconPath))
                electron_1.app.dock.setIcon(electron_1.nativeImage.createFromPath(iconPath));
        }
        catch { }
    }
    // ✅ 先创建窗口，让用户看到东西
    createWindow();
    // ✅ 再启动 server
    if (!isDev) {
        try {
            // ✅ 把 ROOT 传给 server
            process.env.APP_ROOT = ROOT;
            const { startServer } = require(path_1.default.join(ROOT, "dist", "node", "server", "core", "index"));
            await startServer();
        }
        catch (e) {
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
    blockerId = electron_1.powerSaveBlocker.start("prevent-app-suspension");
    electron_1.app.on("activate", () => {
        if (!win)
            createWindow();
        else
            win.show();
    });
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        electron_1.app.quit();
});
electron_1.app.on("before-quit", () => {
    electron_1.app._quitting = true;
    if (blockerId !== null && electron_1.powerSaveBlocker.isStarted(blockerId)) {
        electron_1.powerSaveBlocker.stop(blockerId);
    }
});
//# sourceMappingURL=main.js.map