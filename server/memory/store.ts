import { dbQuery, dbRun } from "../core/db";
import type { Msg } from "../core/types";
import { uuid } from "../utils/crypto";
import { now } from "../utils/time";

// ── Memory Store ──

export function storeMemory(
    sessionId: string,
    keywords: string,
    fact: string,
): void {
    const existing = dbQuery(
        "SELECT id FROM memories WHERE fact = ? AND session_id = ?",
        [fact, sessionId],
    );
    if (existing.length > 0) return;
    dbRun(
        "INSERT INTO memories (id, session_id, fact, keywords, created_at) VALUES (?,?,?,?,?)",
        [uuid(), sessionId, fact, keywords.toLowerCase(), now()],
    );
    console.log(`[Memory] 存储: ${keywords} → ${fact}`);
}

export function queryMemories(query: string, limit = 5): string[] {
    const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 1);
    if (words.length === 0) return [];
    const facts: string[] = [];
    for (const word of words) {
        const rows = dbQuery(
            "SELECT DISTINCT fact FROM memories WHERE keywords LIKE ? ORDER BY created_at DESC LIMIT ?",
            [`%${word}%`, limit],
        );
        for (const row of rows) {
            if (!facts.includes(row.fact)) facts.push(row.fact);
        }
    }
    return facts.slice(0, limit);
}

// ── Topic Store ──

export function getCurrentTopic(sessionId: string): string | null {
    const rows = dbQuery(
        "SELECT id FROM topics WHERE session_id = ? AND end_msg_id IS NULL ORDER BY created_at DESC LIMIT 1",
        [sessionId],
    );
    return rows.length > 0 ? (rows[0].id as string) : null;
}

export function closeTopic(sessionId: string, endMsgId: string): void {
    const topicId = getCurrentTopic(sessionId);
    if (topicId) {
        dbRun("UPDATE topics SET end_msg_id = ? WHERE id = ?", [
            endMsgId,
            topicId,
        ]);
    }
}

export function createTopic(
    sessionId: string,
    title: string,
    startMsgId: string,
): void {
    dbRun(
        "INSERT INTO topics (id, session_id, title, start_msg_id, created_at) VALUES (?,?,?,?,?)",
        [uuid(), sessionId, title, startMsgId, now()],
    );
}

export function getTopicContext(sessionId: string, topicId: string): any[] {
    const topic = dbQuery("SELECT * FROM topics WHERE id = ?", [topicId]);
    if (topic.length === 0) return [];
    return dbQuery(
        "SELECT role, content FROM messages WHERE session_id = ? AND created_at >= (SELECT created_at FROM messages WHERE id = ?) ORDER BY created_at",
        [sessionId, topic[0].start_msg_id],
    );
}

export function getRecentTopicsSummary(sessionId: string, limit = 3): string {
    const topics = dbQuery(
        "SELECT title, summary FROM topics WHERE session_id = ? AND end_msg_id IS NOT NULL ORDER BY created_at DESC LIMIT ?",
        [sessionId, limit],
    );
    if (topics.length === 0) return "";
    return topics
        .map((t: any) => `- ${t.title}: ${t.summary || "（无摘要）"}`)
        .join("\n");
}

// ✅ 话题判断：用规则代替 LLM（省 5 秒）
export function detectTopicShift(
    sessionId: string,
    newMessage: string,
): boolean {
    const lastMsgs = dbQuery(
        "SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY created_at DESC LIMIT 1",
        [sessionId],
    );
    if (lastMsgs.length === 0) return false;

    const lastMsg = (lastMsgs[0].content as string).toLowerCase();
    const newMsg = newMessage.toLowerCase();

    // 规则 1：新消息很短且包含指代词 → 同一话题
    const pronouns = [
        "它",
        "这个",
        "那个",
        "刚才",
        "上面",
        "之前",
        "继续",
        "还有",
        "然后呢",
        "怎么",
        "为什么",
    ];
    if (newMessage.length < 15 && pronouns.some((p) => newMsg.includes(p))) {
        console.log(`[Topic] "${newMessage.slice(0, 20)}" → SAME (指代词)`);
        return false;
    }

    // 规则 2：提取关键词，看重叠度
    const extractKeywords = (text: string) => {
        return text
            .replace(/[，。？！、；：""''（）\s]/g, " ")
            .split(/\s+/)
            .filter((w) => w.length > 1);
    };

    const lastWords = new Set(extractKeywords(lastMsg));
    const newWords = extractKeywords(newMsg);
    const overlap = newWords.filter((w) => lastWords.has(w)).length;
    const overlapRate = newWords.length > 0 ? overlap / newWords.length : 0;

    // 重叠超过 30% → 同一话题
    const isSame = overlapRate > 0.3;
    console.log(
        `[Topic] "${newMessage.slice(0, 20)}" overlap=${(overlapRate * 100).toFixed(0)}% → ${isSame ? "SAME" : "DIFFERENT"}`,
    );
    return !isSame;
}
