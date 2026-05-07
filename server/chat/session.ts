import { dbQuery, dbRun } from "../core/db";
import { uuid } from "../utils/crypto";
import { now } from "../utils/time";

export function getHistory(sessionId: string): any[] {
    return dbQuery(
        "SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at",
        [sessionId],
    );
}

export function getHistoryDesc(sessionId: string, limit = 20): any[] {
    return dbQuery(
        "SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?",
        [sessionId, limit],
    ).reverse();
}

// ✅ 返回消息 ID
export function saveUserMessage(sessionId: string, content: string): string {
    const id = uuid();
    dbRun(
        "INSERT INTO messages (id,session_id,role,content,created_at) VALUES (?,?,?,?,?)",
        [id, sessionId, "user", content, now()],
    );
    return id;
}

export function saveAssistantMessage(
    sessionId: string,
    content: string,
    model: string,
): void {
    dbRun(
        "INSERT INTO messages (id,session_id,role,content,model,created_at) VALUES (?,?,?,?,?,?)",
        [uuid(), sessionId, "assistant", content, model, now()],
    );
}

export function updateSessionTime(sessionId: string): void {
    dbRun("UPDATE sessions SET updated_at = ? WHERE id = ?", [
        now(),
        sessionId,
    ]);
}

export function autoTitle(sessionId: string, content: string): void {
    const n =
        (dbQuery(
            "SELECT COUNT(*) as n FROM messages WHERE session_id = ? AND role = 'user'",
            [sessionId],
        )[0]?.n as number) || 0;
    if (
        n === 1 &&
        !content.startsWith("\n\n**") &&
        !content.startsWith("[Error]")
    ) {
        dbRun("UPDATE sessions SET title = ? WHERE id = ?", [
            content.slice(0, 40) + (content.length > 40 ? "…" : ""),
            sessionId,
        ]);
    }
}

export function findOrCreateIMSession(
    handle: string,
    name: string,
    model: string,
): string {
    const existing = dbQuery(
        "SELECT id FROM sessions WHERE imessage_handle = ? AND source = 'imessage'",
        [handle],
    );
    if (existing.length) return existing[0].id as string;
    const sid = uuid();
    const n = now();
    dbRun(
        "INSERT INTO sessions (id,title,model,source,imessage_handle,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
        [sid, `iMessage: ${name || handle}`, model, "imessage", handle, n, n],
    );
    return sid;
}
