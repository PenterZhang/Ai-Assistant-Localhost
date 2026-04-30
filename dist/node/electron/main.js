"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// ✅ process.cwd() 永远指向项目根目录
const ROOT = process.cwd();
const CFG = JSON.parse(fs_1.default.readFileSync(path_1.default.join(ROOT, "config.json"), "utf-8"));
const PORT = CFG.port || 18789;
let win = null;
let blockerId = null;
async function createWindow() {
    win = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        titleBarStyle: "hiddenInset",
        backgroundColor: "#060606",
        webPreferences: {
            preload: path_1.default.join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    win.loadURL(`http://127.0.0.1:${PORT}`);
    win.on("close", (e) => {
        if (!electron_1.app._quitting) {
            e.preventDefault();
            win?.hide();
        }
    });
}
electron_1.app.whenReady().then(async () => {
    const { startServer } = require("../server/index");
    await startServer();
    blockerId = electron_1.powerSaveBlocker.start("prevent-app-suspension");
    await createWindow();
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