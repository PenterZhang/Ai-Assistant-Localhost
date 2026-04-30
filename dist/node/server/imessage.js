"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAccess = checkAccess;
exports.getLatestRowId = getLatestRowId;
exports.getNewMessages = getNewMessages;
exports.sendMessage = sendMessage;
exports.diagnose = diagnose;
const sql_js_1 = __importDefault(require("sql.js"));
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
// ── 常量 ──
const CHAT_DB = path_1.default.join(os_1.default.homedir(), "Library", "Messages", "chat.db");
const CHAT_DB_WAL = CHAT_DB + "-wal";
const CHAT_DB_SHM = CHAT_DB + "-shm";
const APPLE_EPOCH_OFFSET = 978_307_200;
// ── sql.js 懒加载 ──
let sqlModule = null;
async function getSQL() {
    if (!sqlModule) {
        sqlModule = await (0, sql_js_1.default)();
    }
    return sqlModule;
}
// ── 复制数据库（避免 Messages.app 锁定）──
function copyChatDB() {
    const tmpDir = path_1.default.join(os_1.default.tmpdir(), "ai-assistant-im");
    if (!fs_1.default.existsSync(tmpDir))
        fs_1.default.mkdirSync(tmpDir, { recursive: true });
    const tmpDb = path_1.default.join(tmpDir, "chat.db");
    try {
        fs_1.default.copyFileSync(CHAT_DB, tmpDb);
        try {
            fs_1.default.copyFileSync(CHAT_DB_WAL, tmpDb + "-wal");
        }
        catch { }
        try {
            fs_1.default.copyFileSync(CHAT_DB_SHM, tmpDb + "-shm");
        }
        catch { }
        return fs_1.default.readFileSync(tmpDb);
    }
    catch (e) {
        console.error("[iMessage] 复制 chat.db 失败:", e.message);
        return null;
    }
    finally {
        try {
            fs_1.default.unlinkSync(tmpDb);
        }
        catch { }
        try {
            fs_1.default.unlinkSync(tmpDb + "-wal");
        }
        catch { }
        try {
            fs_1.default.unlinkSync(tmpDb + "-shm");
        }
        catch { }
    }
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
        const buf = copyChatDB();
        if (!buf)
            return 0;
        const SQL = await getSQL();
        const db = new SQL.Database(buf);
        const result = db.exec("SELECT COALESCE(MAX(ROWID), 0) AS max_id FROM message");
        db.close();
        if (result.length && result[0].values.length) {
            return result[0].values[0][0];
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
        const buf = copyChatDB();
        if (!buf)
            return [];
        const SQL = await getSQL();
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
        return result[0].values.map((row) => ({
            rowid: row[0],
            text: row[1] || "",
            sender: row[4],
            is_from_me: Boolean(row[2]),
            timestamp: row[3]
                ? new Date((row[3] / 1e9 + APPLE_EPOCH_OFFSET) * 1000).toISOString()
                : null,
        }));
    }
    catch (e) {
        console.error("[iMessage] getNewMessages:", e.message);
        return [];
    }
}
function sendMessage(handleId, text) {
    console.log(`[iMessage] 发送到 ${handleId}: ${text.slice(0, 50)}...`);
    const escaped = text
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/'/g, "'\\''");
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
        console.log("[iMessage] 发送成功 ✓");
        return true;
    }
    catch (e) {
        console.error("[iMessage] 发送失败:", e.message);
        if (e.stderr)
            console.error("  stderr:", e.stderr.toString());
        return false;
    }
}
// ── 诊断 ──
async function diagnose() {
    const issues = [];
    // 1. chat.db 是否存在
    if (!fs_1.default.existsSync(CHAT_DB)) {
        issues.push("❌ chat.db 不存在: " + CHAT_DB);
    }
    // 2. 是否可读
    try {
        fs_1.default.accessSync(CHAT_DB, fs_1.default.constants.R_OK);
        issues.push("✅ chat.db 可读");
    }
    catch {
        issues.push("❌ chat.db 不可读 → 系统设置 → 隐私与安全性 → 完全磁盘访问");
    }
    // 3. Messages.app 是否运行
    try {
        const result = (0, child_process_1.execSync)(`osascript -e 'tell application "System Events" to (name of processes) contains "Messages"'`, { timeout: 5000, stdio: "pipe" })
            .toString()
            .trim();
        if (result === "false") {
            issues.push("❌ Messages.app 未运行 → 请先打开 Messages.app");
        }
        else {
            issues.push("✅ Messages.app 正在运行");
        }
    }
    catch {
        issues.push("⚠️ 无法检测 Messages.app 状态");
    }
    // 4. AppleScript 权限
    try {
        (0, child_process_1.execSync)(`osascript -e 'tell application "Messages" to get name of first account'`, { timeout: 5000, stdio: "pipe" });
        issues.push("✅ AppleScript 可控制 Messages.app");
    }
    catch {
        issues.push("❌ AppleScript 无权控制 → 系统设置 → 隐私与安全性 → 辅助功能");
    }
    // 5. 尝试读取消息
    try {
        const buf = copyChatDB();
        if (buf) {
            const SQL = await getSQL();
            const db = new SQL.Database(buf);
            const result = db.exec("SELECT COUNT(*) FROM message");
            db.close();
            if (result.length) {
                issues.push("✅ 消息总数: " + result[0].values[0][0]);
            }
        }
        else {
            issues.push("❌ 无法复制 chat.db");
        }
    }
    catch (e) {
        issues.push("❌ 读取消息失败: " + e.message);
    }
    return issues;
}
//# sourceMappingURL=imessage.js.map