import initSqlJs from "sql.js";
import path from "path";
import fs from "fs";
import os from "os";

const DB_DIR = path.join(os.homedir(), ".ai-assistant");
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
export const DB_PATH = path.join(DB_DIR, "chat.db");

let db: any;
let dbSaveTimer: ReturnType<typeof setTimeout> | null = null;

function dbSave() {
    if (dbSaveTimer) clearTimeout(dbSaveTimer);
    dbSaveTimer = setTimeout(() => {
        try {
            fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
        } catch (e) {
            console.error("[DB] save failed:", (e as Error).message);
        }
    }, 500);
}

export function dbQuery(sql: string, params: any[] = []): any[] {
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    const rows: any[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
}

export function dbRun(sql: string, params: any[] = []): void {
    db.run(sql, params);
    dbSave();
}

export async function initDB(): Promise<void> {
    const SQL = await initSqlJs();
    if (fs.existsSync(DB_PATH)) {
        db = new SQL.Database(fs.readFileSync(DB_PATH));
    } else {
        db = new SQL.Database();
    }
    db.run("PRAGMA foreign_keys = ON");
    db.run(`CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '新对话',
        model TEXT NOT NULL DEFAULT 'mimo', source TEXT NOT NULL DEFAULT 'web',
        imessage_handle TEXT, created_at REAL NOT NULL, updated_at REAL NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
        content TEXT NOT NULL, model TEXT, created_at REAL NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS imessage_contacts (
        handle_id TEXT PRIMARY KEY, name TEXT, auto_reply INTEGER DEFAULT 1,
        model TEXT DEFAULT 'mimo', trigger_mode TEXT DEFAULT 'always',
        created_at REAL NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY, session_id TEXT,
        fact TEXT NOT NULL, keywords TEXT NOT NULL,
        created_at REAL NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS topics (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
        title TEXT NOT NULL, start_msg_id TEXT NOT NULL,
        end_msg_id TEXT, summary TEXT,
        created_at REAL NOT NULL
    )`);
    dbSave();
}
