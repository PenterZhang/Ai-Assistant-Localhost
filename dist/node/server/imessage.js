"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAccess = checkAccess;
exports.getLatestRowId = getLatestRowId;
exports.getNewMessages = getNewMessages;
exports.sendMessage = sendMessage;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const CHAT_DB = path_1.default.join(os_1.default.homedir(), "Library", "Messages", "chat.db");
const APPLE_EPOCH_OFFSET = 978_307_200;
function checkAccess() {
    try {
        fs_1.default.accessSync(CHAT_DB, fs_1.default.constants.R_OK);
        return true;
    }
    catch {
        return false;
    }
}
function getLatestRowId() {
    if (!checkAccess())
        return 0;
    try {
        const db = new better_sqlite3_1.default(CHAT_DB, { readonly: true, fileMustExist: true });
        const row = db.prepare("SELECT COALESCE(MAX(ROWID), 0) AS max_id FROM message").get();
        db.close();
        return row.max_id;
    }
    catch (e) {
        console.error("[iMessage]", e.message);
        return 0;
    }
}
function getNewMessages(lastRowId) {
    if (!checkAccess())
        return [];
    try {
        const db = new better_sqlite3_1.default(CHAT_DB, { readonly: true, fileMustExist: true });
        const rows = db.prepare(`
      SELECT m.ROWID, m.text, m.is_from_me, m.date,
             COALESCE(h.id, 'unknown') AS sender
      FROM message m LEFT JOIN handle h ON m.handle_id = h.ROWID
      WHERE m.ROWID > ? ORDER BY m.ROWID ASC LIMIT 50
    `).all(lastRowId);
        db.close();
        return rows.map(r => ({
            rowid: r.ROWID,
            text: r.text || "",
            sender: r.sender,
            is_from_me: Boolean(r.is_from_me),
            timestamp: r.date ? new Date((r.date / 1e9 + APPLE_EPOCH_OFFSET) * 1000).toISOString() : null,
        }));
    }
    catch (e) {
        console.error("[iMessage]", e.message);
        return [];
    }
}
function sendMessage(handleId, text) {
    const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    const script = `
tell application "Messages"
  set targetService to 1st account whose service type is iMessage
  set targetBuddy to participant "${handleId}" of targetService
  send "${escaped}" to targetBuddy
end tell`;
    try {
        (0, child_process_1.execSync)(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 30_000, stdio: "pipe" });
        return true;
    }
    catch (e) {
        console.error("[iMessage] send:", e.message);
        return false;
    }
}
//# sourceMappingURL=imessage.js.map