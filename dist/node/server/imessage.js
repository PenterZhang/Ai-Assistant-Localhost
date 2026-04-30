"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAccess = checkAccess;
exports.getLatestRowId = getLatestRowId;
exports.getNewMessages = getNewMessages;
exports.sendMessage = sendMessage;
const sql_js_1 = __importDefault(require("sql.js"));
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
// ── 常量 ──
const CHAT_DB = path_1.default.join(os_1.default.homedir(), "Library", "Messages", "chat.db");
const APPLE_EPOCH_OFFSET = 978_307_200;
// ── sql.js 懒加载 ──
let sqlModule = null;
async function getSQL() {
    if (!sqlModule) {
        sqlModule = await (0, sql_js_1.default)();
    }
    return sqlModule;
}
// ── 公共方法 ──
function checkAccess() {
    try {
        fs_1.default.accessSync(CHAT_DB, fs_1.default.constants.R_OK);
        return true;
    }
    catch {
        return false;
    }
}
async function getLatestRowId() {
    if (!checkAccess())
        return 0;
    try {
        const SQL = await getSQL();
        const buf = fs_1.default.readFileSync(CHAT_DB);
        const db = new SQL.Database(buf);
        const result = db.exec("SELECT COALESCE(MAX(ROWID), 0) AS max_id FROM message");
        db.close();
        if (result.length && result[0].values.length) {
            return result[0].values[0][0];
        }
        return 0;
    }
    catch (e) {
        console.error("[iMessage]", e.message);
        return 0;
    }
}
async function getNewMessages(lastRowId) {
    if (!checkAccess())
        return [];
    try {
        const SQL = await getSQL();
        const buf = fs_1.default.readFileSync(CHAT_DB);
        const db = new SQL.Database(buf);
        const result = db.exec(`
      SELECT m.ROWID, m.text, m.is_from_me, m.date,
             COALESCE(h.id, 'unknown') AS sender
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      WHERE m.ROWID > ?
      ORDER BY m.ROWID ASC
      LIMIT 50
    `, [lastRowId]);
        db.close();
        if (!result.length)
            return [];
        return result[0].values.map((row) => {
            const dateVal = row[3];
            return {
                rowid: row[0],
                text: row[1] || "",
                sender: row[4],
                is_from_me: Boolean(row[2]),
                timestamp: dateVal
                    ? new Date((dateVal / 1e9 + APPLE_EPOCH_OFFSET) * 1000).toISOString()
                    : null,
            };
        });
    }
    catch (e) {
        console.error("[iMessage]", e.message);
        return [];
    }
}
function sendMessage(handleId, text) {
    const escaped = text
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/'/g, "\\'");
    const script = `
tell application "Messages"
  set targetService to 1st account whose service type is iMessage
  set targetBuddy to participant "${handleId}" of targetService
  send "${escaped}" to targetBuddy
end tell`;
    try {
        (0, child_process_1.execSync)(`osascript -e '${script}'`, {
            timeout: 30_000,
            stdio: "pipe",
        });
        return true;
    }
    catch (e) {
        console.error("[iMessage] send:", e.message);
        return false;
    }
}
//# sourceMappingURL=imessage.js.map