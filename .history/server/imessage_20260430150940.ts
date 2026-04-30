import initSqlJs from "sql.js";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";

// ── Types ──

export interface IMessageRaw {
    rowid: number;
    text: string;
    sender: string;
    is_from_me: boolean;
    timestamp: string | null;
}

// ── 常量 ──

const CHAT_DB = path.join(os.homedir(), "Library", "Messages", "chat.db");
const CHAT_DB_WAL = CHAT_DB + "-wal";
const CHAT_DB_SHM = CHAT_DB + "-shm";
const APPLE_EPOCH_OFFSET = 978_307_200;

// ── sql.js 懒加载 ──

let sqlModule: any = null;

async function getSQL() {
    if (!sqlModule) {
        sqlModule = await initSqlJs();
    }
    return sqlModule;
}

// ── 复制数据库 ──

function copyChatDB(): Buffer | null {
    const tmpDir = path.join(os.tmpdir(), "ai-assistant-im");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const tmpDb = path.join(tmpDir, "chat.db");
    try {
        fs.copyFileSync(CHAT_DB, tmpDb);
        try {
            fs.copyFileSync(CHAT_DB_WAL, tmpDb + "-wal");
        } catch {}
        try {
            fs.copyFileSync(CHAT_DB_SHM, tmpDb + "-shm");
        } catch {}
        return fs.readFileSync(tmpDb);
    } catch (e) {
        console.error("[iMessage] 复制 chat.db 失败:", (e as Error).message);
        return null;
    } finally {
        try {
            fs.unlinkSync(tmpDb);
        } catch {}
        try {
            fs.unlinkSync(tmpDb + "-wal");
        } catch {}
        try {
            fs.unlinkSync(tmpDb + "-shm");
        } catch {}
    }
}

// ── 自动查找 iMessage Account ID ──

let cachedAccountId: string | null = null;

function findIMessageAccountId(): string | null {
    if (cachedAccountId) return cachedAccountId;

    try {
        const result = execSync(
            `osascript -e 'tell application "Messages" to get id of every account'`,
            { timeout: 5000, stdio: "pipe" },
        )
            .toString()
            .trim();

        const ids = result.split(",").map((s) => s.trim());

        // 试每个 account，找到能发消息的那个
        for (const id of ids) {
            try {
                const desc = execSync(
                    `osascript -e 'tell application "Messages" to get description of account id "${id}"'`,
                    { timeout: 5000, stdio: "pipe" },
                )
                    .toString()
                    .trim();

                // 有 description 且包含 @ 的就是 iMessage 账号
                if (desc && desc !== "missing value" && desc.includes("@")) {
                    cachedAccountId = id;
                    console.log(`[iMessage] 找到账号: ${desc} (${id})`);
                    return id;
                }
            } catch {}
        }

        console.warn("[iMessage] 未找到有效的 iMessage 账号");
        return null;
    } catch (e) {
        console.error("[iMessage] 查找账号失败:", (e as Error).message);
        return null;
    }
}

// ── 公共方法 ──

export function checkAccess(): boolean {
    try {
        fs.accessSync(CHAT_DB, fs.constants.R_OK);
        return true;
    } catch {
        return false;
    }
}

export async function getLatestRowId(): Promise<number> {
    if (!checkAccess()) return 0;
    try {
        const buf = copyChatDB();
        if (!buf) return 0;
        const SQL = await getSQL();
        const db = new SQL.Database(buf);
        const result = db.exec(
            "SELECT COALESCE(MAX(ROWID), 0) AS max_id FROM message",
        );
        db.close();
        if (result.length && result[0].values.length) {
            return result[0].values[0][0] as number;
        }
        return 0;
    } catch (e) {
        console.error("[iMessage] getLatestRowId:", (e as Error).message);
        return 0;
    }
}

export async function getNewMessages(
    lastRowId: number,
): Promise<IMessageRaw[]> {
    if (!checkAccess()) return [];
    try {
        const buf = copyChatDB();
        if (!buf) return [];
        const SQL = await getSQL();
        const db = new SQL.Database(buf);
        const result = db.exec(
            `
      SELECT m.ROWID, m.text, m.is_from_me, m.date,
             COALESCE(h.id, 'unknown') AS sender
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      WHERE m.ROWID > ?
      ORDER BY m.ROWID ASC
      LIMIT 50
    `,
            [lastRowId],
        );
        db.close();
        if (!result.length) return [];
        return result[0].values.map((row: any[]) => ({
            rowid: row[0] as number,
            text: (row[1] as string) || "",
            sender: row[4] as string,
            is_from_me: Boolean(row[2]),
            timestamp: row[3]
                ? new Date(
                      ((row[3] as number) / 1e9 + APPLE_EPOCH_OFFSET) * 1000,
                  ).toISOString()
                : null,
        }));
    } catch (e) {
        console.error("[iMessage] getNewMessages:", (e as Error).message);
        return [];
    }
}

export function sendMessage(handleId: string, text: string): boolean {
    const accountId = findIMessageAccountId();
    if (!accountId) {
        console.error("[iMessage] 无法发送：未找到 iMessage 账号");
        return false;
    }

    console.log(`[iMessage] 发送到 ${handleId}: ${text.slice(0, 50)}...`);

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
        execSync(`osascript -e '${script}'`, {
            timeout: 30_000,
            stdio: "pipe",
        });
        console.log("[iMessage] 发送成功 ✓");
        return true;
    } catch (e: any) {
        console.error("[iMessage] 发送失败:", e.message);
        return false;
    }
}

// ── 诊断 ──

export async function diagnose(): Promise<string[]> {
    const issues: string[] = [];

    // 1. chat.db
    if (!fs.existsSync(CHAT_DB)) {
        issues.push("❌ chat.db 不存在: " + CHAT_DB);
    }
    try {
        fs.accessSync(CHAT_DB, fs.constants.R_OK);
        issues.push("✅ chat.db 可读");
    } catch {
        issues.push(
            "❌ chat.db 不可读 → 系统设置 → 隐私与安全性 → 完全磁盘访问",
        );
    }

    // 2. Messages.app
    try {
        const result = execSync(
            `osascript -e 'tell application "System Events" to (name of processes) contains "Messages"'`,
            { timeout: 5000, stdio: "pipe" },
        )
            .toString()
            .trim();
        if (result === "false") {
            issues.push("❌ Messages.app 未运行");
        } else {
            issues.push("✅ Messages.app 正在运行");
        }
    } catch {
        issues.push("⚠️ 无法检测 Messages.app 状态");
    }

    // 3. iMessage 账号
    const accountId = findIMessageAccountId();
    if (accountId) {
        issues.push("✅ iMessage 账号已找到 (" + accountId + ")");
    } else {
        issues.push(
            "❌ 未找到 iMessage 账号 → 请在 Messages.app 里登录 Apple ID",
        );
    }

    // 4. 消息数量
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
        } else {
            issues.push("❌ 无法复制 chat.db");
        }
    } catch (e) {
        issues.push("❌ 读取消息失败: " + (e as Error).message);
    }

    return issues;
}
