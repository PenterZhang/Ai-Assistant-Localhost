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
const APPLE_EPOCH_OFFSET = 978_307_200;

// ── sql.js 懒加载 ──

let sqlModule: any = null;

async function getSQL() {
    if (!sqlModule) {
        sqlModule = await initSqlJs();
    }
    return sqlModule;
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
        const SQL = await getSQL();
        const buf = fs.readFileSync(CHAT_DB);
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
        console.error("[iMessage]", (e as Error).message);
        return 0;
    }
}

export async function getNewMessages(
    lastRowId: number,
): Promise<IMessageRaw[]> {
    if (!checkAccess()) return [];
    try {
        const SQL = await getSQL();
        const buf = fs.readFileSync(CHAT_DB);
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

        return result[0].values.map((row: any[]) => {
            const dateVal = row[3] as number | null;
            return {
                rowid: row[0] as number,
                text: (row[1] as string) || "",
                sender: row[4] as string,
                is_from_me: Boolean(row[2]),
                timestamp: dateVal
                    ? new Date(
                          (dateVal / 1e9 + APPLE_EPOCH_OFFSET) * 1000,
                      ).toISOString()
                    : null,
            };
        });
    } catch (e) {
        console.error("[iMessage]", (e as Error).message);
        return [];
    }
}

export function sendMessage(handleId: string, text: string): boolean {
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
        execSync(`osascript -e '${script}'`, {
            timeout: 30_000,
            stdio: "pipe",
        });
        return true;
    } catch (e) {
        console.error("[iMessage] send:", (e as Error).message);
        return false;
    }
}
