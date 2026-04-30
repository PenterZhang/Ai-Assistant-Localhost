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

// ── Constants ──

const CHAT_DB = path.join(os.homedir(), "Library", "Messages", "chat.db");
const APPLE_EPOCH_OFFSET = 978_307_200;

// ── sql.js lazy load ──

let sqlModule: any = null;

async function getSQL() {
    if (!sqlModule) {
        sqlModule = await initSqlJs();
    }
    return sqlModule;
}

// ── Copy chat.db (avoid Messages.app lock) ──

function copyChatDB(): Buffer | null {
    const tmpDir = path.join(os.tmpdir(), "ai-assistant-im");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const tmpDb = path.join(tmpDir, "chat.db");
    try {
        fs.copyFileSync(CHAT_DB, tmpDb);
        try {
            fs.copyFileSync(CHAT_DB + "-wal", tmpDb + "-wal");
        } catch {}
        try {
            fs.copyFileSync(CHAT_DB + "-shm", tmpDb + "-shm");
        } catch {}
        return fs.readFileSync(tmpDb);
    } catch (e) {
        console.error("[iMessage] copy chat.db failed:", (e as Error).message);
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

// ── Find iMessage account ──

let cachedAccountId: string | null = null;

export function findAccountId(): string | null {
    if (cachedAccountId) return cachedAccountId;
    try {
        const result = execSync(
            `osascript -e 'tell application "Messages" to get id of every account'`,
            { timeout: 5000, stdio: "pipe" },
        )
            .toString()
            .trim();
        const ids = result.split(",").map((s) => s.trim());
        for (const id of ids) {
            try {
                const desc = execSync(
                    `osascript -e 'tell application "Messages" to get description of account id "${id}"'`,
                    { timeout: 5000, stdio: "pipe" },
                )
                    .toString()
                    .trim();
                if (desc && desc !== "missing value" && desc.includes("@")) {
                    cachedAccountId = id;
                    console.log(`[iMessage] account found: ${desc} (${id})`);
                    return id;
                }
            } catch {}
        }
        console.warn("[iMessage] no valid iMessage account found");
        return null;
    } catch (e) {
        console.error("[iMessage] find account failed:", (e as Error).message);
        return null;
    }
}

// ── Public functions ──

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
    const accountId = findAccountId();
    if (!accountId) {
        console.error("[iMessage] cannot send: no iMessage account");
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
        execSync(`osascript -e '${script}'`, {
            timeout: 30_000,
            stdio: "pipe",
        });
        console.log("[iMessage] sent ✓");
        return true;
    } catch (e: any) {
        console.error("[iMessage] send failed:", e.message);
        return false;
    }
}

export async function diagnose(): Promise<string[]> {
    const issues: string[] = [];

    if (!fs.existsSync(CHAT_DB)) {
        issues.push("❌ chat.db not found: " + CHAT_DB);
    }
    try {
        fs.accessSync(CHAT_DB, fs.constants.R_OK);
        issues.push("✅ chat.db readable");
    } catch {
        issues.push(
            "❌ chat.db not readable → System Settings → Privacy & Security → Full Disk Access",
        );
    }

    try {
        const result = execSync(
            `osascript -e 'tell application "System Events" to (name of processes) contains "Messages"'`,
            { timeout: 5000, stdio: "pipe" },
        )
            .toString()
            .trim();
        if (result === "false") {
            issues.push("❌ Messages.app not running");
        } else {
            issues.push("✅ Messages.app running");
        }
    } catch {
        issues.push("⚠️ cannot detect Messages.app");
    }

    const accountId = findAccountId();
    if (accountId) {
        issues.push("✅ iMessage account found (" + accountId + ")");
    } else {
        issues.push("❌ no iMessage account → login in Messages.app");
    }

    try {
        const buf = copyChatDB();
        if (buf) {
            const SQL = await getSQL();
            const db = new SQL.Database(buf);
            const result = db.exec("SELECT COUNT(*) FROM message");
            db.close();
            if (result.length) {
                issues.push("✅ total messages: " + result[0].values[0][0]);
            }
        } else {
            issues.push("❌ cannot copy chat.db");
        }
    } catch (e) {
        issues.push("❌ read messages failed: " + (e as Error).message);
    }

    return issues;
}
