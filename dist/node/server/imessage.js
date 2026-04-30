"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findAccountId = findAccountId;
exports.checkAccess = checkAccess;
exports.getLatestRowId = getLatestRowId;
exports.getNewMessages = getNewMessages;
exports.sendMessage = sendMessage;
exports.diagnose = diagnose;
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
// ── Constants ──
const CHAT_DB = path_1.default.join(os_1.default.homedir(), "Library", "Messages", "chat.db");
const APPLE_EPOCH_OFFSET = 978_307_200;
// ── sqlite3 CLI wrapper ──
function sqliteQuery(sql) {
    try {
        const result = (0, child_process_1.execSync)(`sqlite3 "${CHAT_DB}" "${sql.replace(/"/g, '\\"')}"`, { timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] })
            .toString()
            .trim();
        if (!result)
            return [];
        return result.split("\n").map((line) => line.split("|"));
    }
    catch (e) {
        console.error("[iMessage] sqlite3 query failed:", e.message);
        return [];
    }
}
// ── Find iMessage account ──
let cachedAccountId = null;
function findAccountId() {
    if (cachedAccountId)
        return cachedAccountId;
    try {
        const result = (0, child_process_1.execSync)(`osascript -e 'tell application "Messages" to get id of every account'`, { timeout: 5000, stdio: "pipe" })
            .toString()
            .trim();
        const ids = result.split(",").map((s) => s.trim());
        for (const id of ids) {
            try {
                const desc = (0, child_process_1.execSync)(`osascript -e 'tell application "Messages" to get description of account id "${id}"'`, { timeout: 5000, stdio: "pipe" })
                    .toString()
                    .trim();
                if (desc && desc !== "missing value" && desc.includes("@")) {
                    cachedAccountId = id;
                    console.log(`[iMessage] account: ${desc} (${id})`);
                    return id;
                }
            }
            catch { }
        }
        console.warn("[iMessage] no valid account found");
        return null;
    }
    catch (e) {
        console.error("[iMessage] find account failed:", e.message);
        return null;
    }
}
// ── Public functions ──
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
        const rows = sqliteQuery("SELECT COALESCE(MAX(ROWID), 0) FROM message");
        if (rows.length && rows[0].length) {
            return parseInt(rows[0][0], 10) || 0;
        }
        return 0;
    }
    catch (e) {
        console.error("[iMessage] getLatestRowId:", e.message);
        return 0;
    }
}
async function getNewMessages(lastRowId) {
    if (!checkAccess())
        return [];
    try {
        const rows = sqliteQuery(`SELECT m.ROWID, COALESCE(m.text, ''), m.is_from_me, m.date, COALESCE(h.id, 'unknown') FROM message m LEFT JOIN handle h ON m.handle_id = h.ROWID WHERE m.ROWID > ${lastRowId} ORDER BY m.ROWID ASC LIMIT 50`);
        return rows.map((row) => ({
            rowid: parseInt(row[0], 10),
            text: row[1],
            sender: row[4],
            is_from_me: row[2] === "1",
            timestamp: row[3]
                ? new Date((parseInt(row[3], 10) / 1e9 +
                    APPLE_EPOCH_OFFSET) *
                    1000).toISOString()
                : null,
        }));
    }
    catch (e) {
        console.error("[iMessage] getNewMessages:", e.message);
        return [];
    }
}
function sendMessage(handleId, text) {
    const accountId = findAccountId();
    if (!accountId) {
        console.error("[iMessage] cannot send: no account");
        return false;
    }
    console.log(`[iMessage] sending to ${handleId}: ${text.slice(0, 50)}...`);
    const escaped = text
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/'/g, "'\\''");
    const script = `
tell application "Messages"
  set myAccount to account id "${accountId}"
  send "${escaped}" to participant "${handleId}" of myAccount
end tell`;
    try {
        (0, child_process_1.execSync)(`osascript -e '${script}'`, {
            timeout: 30_000,
            stdio: "pipe",
        });
        console.log("[iMessage] sent ✓");
        return true;
    }
    catch (e) {
        console.error("[iMessage] send failed:", e.message);
        return false;
    }
}
async function diagnose() {
    const issues = [];
    if (!fs_1.default.existsSync(CHAT_DB)) {
        issues.push("❌ chat.db not found: " + CHAT_DB);
    }
    try {
        fs_1.default.accessSync(CHAT_DB, fs_1.default.constants.R_OK);
        issues.push("✅ chat.db readable");
    }
    catch {
        issues.push("❌ chat.db not readable → System Settings → Privacy → Full Disk Access");
    }
    try {
        const result = (0, child_process_1.execSync)(`osascript -e 'tell application "System Events" to (name of processes) contains "Messages"'`, { timeout: 5000, stdio: "pipe" })
            .toString()
            .trim();
        issues.push(result === "false"
            ? "❌ Messages.app not running"
            : "✅ Messages.app running");
    }
    catch {
        issues.push("⚠️ cannot detect Messages.app");
    }
    const accountId = findAccountId();
    if (accountId) {
        issues.push("✅ iMessage account found (" + accountId + ")");
    }
    else {
        issues.push("❌ no iMessage account → login in Messages.app");
    }
    try {
        const rows = sqliteQuery("SELECT COUNT(*) FROM message");
        if (rows.length) {
            issues.push("✅ total messages: " + rows[0][0]);
        }
    }
    catch (e) {
        issues.push("❌ read messages failed: " + e.message);
    }
    return issues;
}
//# sourceMappingURL=imessage.js.map