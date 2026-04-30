import Database from "better-sqlite3";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";

export interface IMessageRaw {
  rowid: number;
  text: string;
  sender: string;
  is_from_me: boolean;
  timestamp: string | null;
}

interface ChatDBRow {
  ROWID: number;
  text: string | null;
  is_from_me: number;
  date: number | null;
  sender: string;
}

const CHAT_DB = path.join(os.homedir(), "Library", "Messages", "chat.db");
const APPLE_EPOCH_OFFSET = 978_307_200;

export function checkAccess(): boolean {
  try {
    fs.accessSync(CHAT_DB, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function getLatestRowId(): number {
  if (!checkAccess()) return 0;
  try {
    const db = new Database(CHAT_DB, { readonly: true, fileMustExist: true });
    const row = db.prepare("SELECT COALESCE(MAX(ROWID), 0) AS max_id FROM message").get() as { max_id: number };
    db.close();
    return row.max_id;
  } catch (e) {
    console.error("[iMessage]", (e as Error).message);
    return 0;
  }
}

export function getNewMessages(lastRowId: number): IMessageRaw[] {
  if (!checkAccess()) return [];
  try {
    const db = new Database(CHAT_DB, { readonly: true, fileMustExist: true });
    const rows = db.prepare(`
      SELECT m.ROWID, m.text, m.is_from_me, m.date,
             COALESCE(h.id, 'unknown') AS sender
      FROM message m LEFT JOIN handle h ON m.handle_id = h.ROWID
      WHERE m.ROWID > ? ORDER BY m.ROWID ASC LIMIT 50
    `).all(lastRowId) as ChatDBRow[];
    db.close();
    return rows.map(r => ({
      rowid: r.ROWID,
      text: r.text || "",
      sender: r.sender,
      is_from_me: Boolean(r.is_from_me),
      timestamp: r.date ? new Date((r.date / 1e9 + APPLE_EPOCH_OFFSET) * 1000).toISOString() : null,
    }));
  } catch (e) {
    console.error("[iMessage]", (e as Error).message);
    return [];
  }
}

export function sendMessage(handleId: string, text: string): boolean {
  const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  const script = `
tell application "Messages"
  set targetService to 1st account whose service type is iMessage
  set targetBuddy to participant "${handleId}" of targetService
  send "${escaped}" to targetBuddy
end tell`;
  try {
    execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 30_000, stdio: "pipe" });
    return true;
  } catch (e) {
    console.error("[iMessage] send:", (e as Error).message);
    return false;
  }
}
