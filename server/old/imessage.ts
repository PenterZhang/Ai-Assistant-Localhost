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

// ── sqlite3 CLI wrapper ──

function sqliteQuery(sql: string): any[][] {
    try {
        const result = execSync(
            `sqlite3 "${CHAT_DB}" "${sql.replace(/"/g, '\\"')}"`,
            { timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] },
        )
            .toString()
            .trim();

        if (!result) return [];
        return result.split("\n").map((line) => line.split("|"));
    } catch (e) {
        console.error("[iMessage] sqlite3 query failed:", (e as Error).message);
        return [];
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
                    console.log(`[iMessage] account: ${desc} (${id})`);
                    return id;
                }
            } catch {}
        }
        console.warn("[iMessage] no valid account found");
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
        const rows = sqliteQuery("SELECT COALESCE(MAX(ROWID), 0) FROM message");
        if (rows.length && rows[0].length) {
            return parseInt(rows[0][0] as string, 10) || 0;
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
        const rows = sqliteQuery(
            `SELECT m.ROWID, COALESCE(m.text, ''), m.is_from_me, m.date, COALESCE(h.id, 'unknown') FROM message m LEFT JOIN handle h ON m.handle_id = h.ROWID WHERE m.ROWID > ${lastRowId} ORDER BY m.ROWID ASC LIMIT 50`,
        );

        return rows.map((row) => ({
            rowid: parseInt(row[0] as string, 10),
            text: row[1] as string,
            sender: row[4] as string,
            is_from_me: row[2] === "1",
            timestamp: row[3]
                ? new Date(
                      (parseInt(row[3] as string, 10) / 1e9 +
                          APPLE_EPOCH_OFFSET) *
                          1000,
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
            "❌ chat.db not readable → System Settings → Privacy → Full Disk Access",
        );
    }

    try {
        const result = execSync(
            `osascript -e 'tell application "System Events" to (name of processes) contains "Messages"'`,
            { timeout: 5000, stdio: "pipe" },
        )
            .toString()
            .trim();
        issues.push(
            result === "false"
                ? "❌ Messages.app not running"
                : "✅ Messages.app running",
        );
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
        const rows = sqliteQuery("SELECT COUNT(*) FROM message");
        if (rows.length) {
            issues.push("✅ total messages: " + rows[0][0]);
        }
    } catch (e) {
        issues.push("❌ read messages failed: " + (e as Error).message);
    }

    return issues;
}
