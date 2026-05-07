import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import initSqlJs from "sql.js";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import os from "os";
import { spawn } from "child_process";
import * as im from "./imessage";
import { webSearch } from "./search";

// ── Types ──

interface ModelConfig {
    name: string;
    base_url: string;
    api_key?: string;
    model_id: string;
    temperature?: number;
    max_tokens?: number;
}

interface AppConfig {
    port: number;
    default_model: string;
    system_prompt: string;
    tavily_api_key?: string;
    models: Record<string, ModelConfig>;
    imessage: { enabled: boolean; poll_interval: number; cooldown: number };
}

interface IMContact {
    handle_id: string;
    name: string;
    auto_reply: number;
    model: string;
    trigger_mode: string;
    created_at: number;
}

type Msg = { role: string; content: string };

// ── Config ──

const ROOT = process.env.APP_ROOT || process.cwd();
const CFG: AppConfig = JSON.parse(
    fs.readFileSync(path.join(ROOT, "config.json"), "utf-8"),
);

const DB_DIR = path.join(os.homedir(), ".ai-assistant");
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const DB_PATH = path.join(DB_DIR, "chat.db");

// ── sql.js database ──

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

function dbQuery(sql: string, params: any[] = []): any[] {
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    const rows: any[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
}

function dbRun(sql: string, params: any[] = []): void {
    db.run(sql, params);
    dbSave();
}

async function initDB(): Promise<void> {
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
    dbSave();
}

// ── Model Streaming ──

async function* streamMimo(messages: Msg[]): AsyncGenerator<string> {
    const mc = CFG.models?.mimo;
    if (!mc?.api_key || mc.api_key === "YOUR_MIMO_API_KEY") {
        yield "\n\n**MiMo API Key not configured**";
        return;
    }
    const resp = await fetch(`${mc.base_url}/chat/completions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${mc.api_key}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: mc.model_id,
            messages,
            stream: true,
            temperature: mc.temperature ?? 0.7,
            max_tokens: mc.max_tokens ?? 4096,
        }),
    });
    if (!resp.ok) {
        yield `\n\n**MiMo API Error (${resp.status})**`;
        return;
    }
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of resp.body!) {
        buf += dec.decode(chunk, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const d = line.slice(6).trim();
            if (d === "[DONE]") return;
            try {
                const c = JSON.parse(d).choices?.[0]?.delta?.content;
                if (c) yield c;
            } catch {}
        }
    }
}

async function* streamOllama(messages: Msg[]): AsyncGenerator<string> {
    const mc = Object.values(CFG.models).find((m) =>
        m.base_url.includes("11434"),
    );
    if (!mc) {
        yield "\n\n**No Ollama model configured**";
        return;
    }
    const resp = await fetch(`${mc.base_url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: mc.model_id,
            messages,
            stream: true,
            options: {
                temperature: mc.temperature ?? 0.7,
                num_predict: mc.max_tokens ?? 4096,
            },
        }),
    });
    if (!resp.ok) {
        yield `\n\n**Ollama Error (${resp.status})**`;
        return;
    }
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of resp.body!) {
        buf += dec.decode(chunk, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
            if (!line) continue;
            try {
                const c = JSON.parse(line).message?.content;
                if (c) yield c;
            } catch {}
        }
    }
}

function getStreamFn(modelId: string): (m: Msg[]) => AsyncGenerator<string> {
    const mc = CFG.models?.[modelId];
    if (!mc) return streamMimo;
    if (mc.base_url.includes("11434")) return streamOllama;
    return streamMimo;
}

// ── 长期记忆 ──

// 从历史消息中提取关键信息（轻量级，不调 LLM）
function extractMemory(sessionId: string): string {
    // 取最近 50 条消息做摘要
    const msgs = dbQuery(
        "SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 50",
        [sessionId],
    ).reverse();

    if (msgs.length < 6) return ""; // 消息太少，不需要记忆

    // 提取用户提到的关键信息
    const userMsgs = msgs
        .filter((m: any) => m.role === "user")
        .map((m: any) => m.content);
    const topics: string[] = [];

    // 简单关键词提取：用户经常提到的主题
    const keywords =
        userMsgs.join(" ").match(/[\u4e00-\u9fa5a-zA-Z]{2,}/g) || [];
    const freq: Record<string, number> = {};
    for (const w of keywords) {
        if (w.length < 2) continue;
        freq[w] = (freq[w] || 0) + 1;
    }
    const topKeywords = Object.entries(freq)
        .filter(([w, n]) => n >= 2 && w.length >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([w]) => w);

    if (topKeywords.length > 0) {
        topics.push(`用户经常讨论的话题：${topKeywords.join("、")}`);
    }

    // 提取最近的对话主题（最后 3 轮）
    const recentPairs: string[] = [];
    for (let i = msgs.length - 1; i >= 0 && recentPairs.length < 3; i--) {
        const m = msgs[i];
        if (m.role === "user") {
            recentPairs.unshift(`用户问：${m.content.slice(0, 50)}`);
        }
    }

    if (recentPairs.length > 0) {
        topics.push(`最近对话：${recentPairs.join("；")}`);
    }

    return topics.join("\n");
}

// 构建带记忆的消息数组
function buildMessages(
    systemPrompt: string,
    history: Msg[],
    memory: string,
): Msg[] {
    const messages: Msg[] = [];

    // System prompt + 长期记忆
    let fullSystem = systemPrompt;
    if (memory) {
        fullSystem += `\n\n【用户背景】\n${memory}\n\n请根据以上背景信息，更好地理解用户的问题和意图。`;
    }
    messages.push({ role: "system", content: fullSystem });

    // 短期记忆：最近 20 条
    const recentHistory = history.slice(-20);
    messages.push(...recentHistory);

    return messages;
}

// ── 记忆系统 ──

async function extractFacts(sessionId: string): Promise<void> {
    const msgs = dbQuery(
        "SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 10",
        [sessionId],
    ).reverse();

    if (msgs.length < 4) return;

    const mc =
        Object.values(CFG.models).find((m) => m.base_url.includes("11434")) ||
        CFG.models[CFG.default_model];
    if (!mc) return;

    const conversation = msgs
        .map((m: any) => `${m.role}: ${m.content}`)
        .join("\n");
    const isOllama = mc.base_url.includes("11434");
    const prompt: Msg[] = [
        {
            role: "system",
            content: `从对话中提取用户的关键个人信息和偏好，每条一行。
格式：关键词|事实
只提取明确提到的信息，不要推测。
如果没有值得记忆的信息，输出 NONE。

例如：
张三|用户名叫张三
北京|用户住在北京
Python|用户主要使用Python编程`,
        },
        { role: "user", content: conversation },
    ];

    let reply = "";
    try {
        if (isOllama) {
            const resp = await fetch(`${mc.base_url}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: mc.model_id,
                    messages: prompt,
                    stream: false,
                    options: { temperature: 0, num_predict: 200 },
                }),
                signal: AbortSignal.timeout(15000),
            });
            if (!resp.ok) return;
            reply = ((await resp.json()) as any).message?.content || "";
        } else {
            const resp = await fetch(`${mc.base_url}/chat/completions`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${mc.api_key}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: mc.model_id,
                    messages: prompt,
                    stream: false,
                    temperature: 0,
                    max_tokens: 200,
                }),
                signal: AbortSignal.timeout(15000),
            });
            if (!resp.ok) return;
            reply =
                ((await resp.json()) as any).choices?.[0]?.message?.content ||
                "";
        }
    } catch (e) {
        console.error("[Memory] extract error:", (e as Error).message);
        return;
    }

    if (!reply || reply.toUpperCase().includes("NONE")) return;

    const lines = reply.split("\n").filter((l: string) => l.includes("|"));
    for (const line of lines) {
        const [keywords, fact] = line.split("|").map((s: string) => s.trim());
        if (!fact || !keywords) continue;
        const existing = dbQuery(
            "SELECT id FROM memories WHERE fact = ? AND session_id = ?",
            [fact, sessionId],
        );
        if (existing.length > 0) continue;
        dbRun(
            "INSERT INTO memories (id, session_id, fact, keywords, created_at) VALUES (?,?,?,?,?)",
            [
                crypto.randomUUID(),
                sessionId,
                fact,
                keywords.toLowerCase(),
                Date.now() / 1000,
            ],
        );
        console.log(`[Memory] 存储: ${keywords} → ${fact}`);
    }
}

function recallMemories(query: string, limit: number = 5): string[] {
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

// ── 统一搜索系统 ──
async function rewriteQuery(query: string): Promise<string> {
    try {
        const mc =
            Object.values(CFG.models).find((m) =>
                m.base_url.includes("11434"),
            ) || CFG.models[CFG.default_model];
        if (!mc) return query;

        const isOllama = mc.base_url.includes("11434");
        const messages: Msg[] = [
            {
                role: "system",
                content: `把用户问题改写成搜索引擎关键词。只输出关键词，不要解释。
例如：
"小米最近咋样了" → 小米公司 2026 最新动态
"今天天气怎么样" → 今天天气预报
"skills是自己写还是下载" → AI agent skills 自己开发 对比 下载`,
            },
            { role: "user", content: query },
        ];

        let reply = "";

        if (isOllama) {
            const resp = await fetch(`${mc.base_url}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: mc.model_id,
                    messages,
                    stream: false,
                    options: { temperature: 0, num_predict: 50 },
                }),
                signal: AbortSignal.timeout(10000),
            });
            if (!resp.ok) return query;
            const data = (await resp.json()) as any;
            reply = (data.message?.content || "").trim();
        } else {
            const resp = await fetch(`${mc.base_url}/chat/completions`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${mc.api_key}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: mc.model_id,
                    messages,
                    stream: false,
                    temperature: 0,
                    max_tokens: 50,
                }),
                signal: AbortSignal.timeout(10000),
            });
            if (!resp.ok) return query;
            const data = (await resp.json()) as any;
            reply = (data.choices?.[0]?.message?.content || "").trim();
        }

        reply = reply
            .replace(/^["']|["']$/g, "")
            .replace(/\n/g, " ")
            .trim();
        console.log(`[Query Rewrite] "${query}" → "${reply}"`);
        return reply || query;
    } catch (e) {
        console.error("[Query Rewrite] error:", (e as Error).message);
        return query;
    }
}

async function aiShouldSearch(query: string): Promise<boolean> {
    try {
        const mc =
            Object.values(CFG.models).find((m) =>
                m.base_url.includes("11434"),
            ) || CFG.models[CFG.default_model];
        if (!mc) return false;

        const isOllama = mc.base_url.includes("11434");
        const messages: Msg[] = [
            {
                role: "system",
                content: `判断用户问题是否需要联网搜索实时信息。
需要联网：新闻、时事、天气、股价、比赛、最新动态、今天/最近发生的事、实时数据、产品发布、公司动态。
不需要联网：常识、编程、数学、创意写作、闲聊、历史知识。
只回答 YES 或 NO`,
            },
            { role: "user", content: query },
        ];

        let reply = "";

        if (isOllama) {
            const resp = await fetch(`${mc.base_url}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: mc.model_id,
                    messages,
                    stream: false,
                    options: { temperature: 0, num_predict: 5 },
                }),
                signal: AbortSignal.timeout(10000),
            });
            if (!resp.ok) return false;
            const data = (await resp.json()) as any;
            reply = (data.message?.content || "").trim().toUpperCase();
        } else {
            const resp = await fetch(`${mc.base_url}/chat/completions`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${mc.api_key}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: mc.model_id,
                    messages,
                    stream: false,
                    temperature: 0,
                    max_tokens: 5,
                }),
                signal: AbortSignal.timeout(10000),
            });
            if (!resp.ok) return false;
            const data = (await resp.json()) as any;
            reply = (data.choices?.[0]?.message?.content || "")
                .trim()
                .toUpperCase();
        }

        const needSearch = reply.includes("YES");
        console.log(
            `[AI Judge] "${query.slice(0, 40)}" → ${reply} → ${needSearch ? "搜索" : "不搜索"}`,
        );
        return needSearch;
    } catch (e) {
        console.error("[AI Judge] error:", (e as Error).message);
        return false;
    }
}

async function doSearch(query: string): Promise<string | null> {
    if (!CFG.tavily_api_key?.trim()) {
        console.log("[Search] Tavily Key 未配置");
        return null;
    }

    const rewrittenQuery = await rewriteQuery(query);

    console.log(`[Search] 搜索: "${rewrittenQuery}"`);
    const results = await webSearch(rewrittenQuery, 5, CFG.tavily_api_key);
    console.log(`[Search] 返回 ${results.length} 条结果`);
    if (results.length === 0) return null;

    const context = results
        .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}`)
        .join("\n\n");
    console.log(`[Search] 上下文预览: ${context.slice(0, 150)}`);
    return context;
}

function buildSearchPrompt(query: string, context: string): string {
    return `你是一个信息整合助手。按以下步骤回答用户问题：

第一步：从搜索结果中找出与问题相关的片段
第二步：提取关键事实和观点
第三步：基于这些事实进行推理，给出结论

要求：
- 即使搜索结果没有直接答案，也要基于已有信息推理
- 绝对不能说"搜索结果未提供相关信息"或"无法判断"
- 如果信息不足，说"根据现有信息推测："然后给出推理
- 输出格式：先结论，再依据，末尾标注来源 [1] [2]

搜索结果：
${context}

用户问题：${query}

你的分析和结论：`;
}

async function decideAndSearch(
    query: string,
    manual?: boolean,
): Promise<string | null> {
    // ✅ 自动解析 /s 和 /ai 前缀
    if (query.startsWith("/s ")) {
        query = query.slice(3).trim();
        manual = true;
    } else if (query.startsWith("/ai ")) {
        query = query.slice(4).trim();
        manual = false;
    }

    if (manual === true) {
        console.log(`[Search] 手动触发`);
        return await doSearch(query);
    }
    if (manual === false) {
        return null;
    }
    const needSearch = await aiShouldSearch(query);
    if (!needSearch) return null;
    return await doSearch(query);
}

// ── AI + Send helper ──

async function generateAndSend(
    targetHandle: string,
    userText: string,
    contact: IMContact,
    search?: boolean,
): Promise<boolean> {
    let sid: string;
    const existing = dbQuery(
        "SELECT id FROM sessions WHERE imessage_handle = ? AND source = 'imessage'",
        [targetHandle],
    );
    if (existing.length) {
        sid = existing[0].id as string;
    } else {
        sid = crypto.randomUUID();
        const n = Date.now() / 1000;
        dbRun(
            "INSERT INTO sessions (id,title,model,source,imessage_handle,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
            [
                sid,
                `iMessage: ${contact.name || targetHandle}`,
                contact.model,
                "imessage",
                targetHandle,
                n,
                n,
            ],
        );
    }

    dbRun(
        "INSERT INTO messages (id,session_id,role,content,created_at) VALUES (?,?,?,?,?)",
        [crypto.randomUUID(), sid, "user", userText, Date.now() / 1000],
    );

    const history = dbQuery(
        "SELECT role,content FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 50",
        [sid],
    ).reverse() as unknown as Msg[];

    // 长期记忆
    const memory = extractMemory(sid);

    // 统一搜索决策
    const ctx = await decideAndSearch(userText, search);
    let messages: Msg[];

    if (ctx) {
        // 搜索模式：用搜索结果替换最后一条用户消息
        const historyForSearch = history.slice(0, -1);
        messages = buildMessages(CFG.system_prompt, historyForSearch, memory);
        messages.push({
            role: "user",
            content: buildSearchPrompt(userText, ctx),
        });
    } else {
        // 普通模式：直接用历史
        messages = buildMessages(CFG.system_prompt, history, memory);
    }

    const streamFn = getStreamFn(contact.model);
    let full = "";
    for await (const chunk of streamFn(messages)) full += chunk;

    if (!full || full.startsWith("\n\n**")) {
        console.error(`[iMessage] AI error: ${full.slice(0, 100)}`);
        return false;
    }

    dbRun(
        "INSERT INTO messages (id,session_id,role,content,model,created_at) VALUES (?,?,?,?,?,?)",
        [
            crypto.randomUUID(),
            sid,
            "assistant",
            full,
            contact.model,
            Date.now() / 1000,
        ],
    );

    const sent = im.sendMessage(targetHandle, full);
    if (sent) console.log(`[iMessage] replied: ${full.slice(0, 50)}`);
    return sent;
}

// ── iMessage Poller ──

let polling = false;

function startPoller() {
    if (!CFG.imessage?.enabled || polling) return;
    if (!im.checkAccess()) {
        console.log("[iMessage] chat.db not accessible");
        return;
    }

    polling = true;
    const state = { lastRowId: 0, ready: false };
    const cooldowns: Record<string, number> = {};
    let heartbeat = 0;

    im.getLatestRowId().then((id) => {
        state.lastRowId = id;
        state.ready = true;
        console.log(`[iMessage] polling from ROWID ${id}`);
    });

    async function poll() {
        try {
            if (!state.ready) return;
            heartbeat++;
            if (heartbeat % 10 === 0)
                console.log(
                    `[iMessage] heartbeat OK (ROWID=${state.lastRowId})`,
                );

            const msgs = await im.getNewMessages(state.lastRowId);
            if (msgs.length > 0)
                console.log(`[iMessage] ${msgs.length} new messages`);

            for (const m of msgs) {
                state.lastRowId = Math.max(state.lastRowId, m.rowid);
                if (!m.text.trim()) continue;

                // ── 自己发的消息 ──
                if (m.is_from_me) {
                    const trimmed = m.text.trim();
                    let prompt = "";
                    let searchOverride: boolean | undefined = undefined;

                    if (trimmed.startsWith("/s ")) {
                        prompt = trimmed.slice(3).trim();
                        searchOverride = true;
                    } else if (trimmed.startsWith("/ai ")) {
                        prompt = trimmed.slice(4).trim();
                        searchOverride = false;
                    } else {
                        prompt = trimmed;
                        // 不传，让 AI 自动判断
                    }

                    if (!prompt) continue;

                    const targetHandle = m.sender;
                    const contacts = dbQuery(
                        "SELECT * FROM imessage_contacts WHERE handle_id = ?",
                        [targetHandle],
                    );
                    const contact = contacts[0] as unknown as
                        | IMContact
                        | undefined;
                    if (!contact) {
                        console.log(
                            `[iMessage] skip: ${targetHandle} not in contacts`,
                        );
                        continue;
                    }

                    console.log(
                        `[iMessage] → ${targetHandle}: ${prompt.slice(0, 50)} (search=${searchOverride ?? "auto"})`,
                    );
                    try {
                        await generateAndSend(
                            targetHandle,
                            prompt,
                            contact,
                            searchOverride,
                        );
                    } catch (e) {
                        console.error(
                            `[iMessage] failed:`,
                            (e as Error).message,
                        );
                    }
                    continue;
                }

                // ── 别人发的消息：自动回复 ──
                const now = Date.now() / 1000;
                if (now - (cooldowns[m.sender] || 0) < CFG.imessage.cooldown)
                    continue;

                const contacts = dbQuery(
                    "SELECT * FROM imessage_contacts WHERE handle_id = ?",
                    [m.sender],
                );
                const contact = contacts[0] as unknown as IMContact | undefined;
                if (!contact?.auto_reply) continue;

                console.log(
                    `[iMessage] from ${m.sender}: ${m.text.slice(0, 50)}`,
                );

                let text = m.text;
                if (contact.trigger_mode === "prefix:/ai") {
                    if (!text.startsWith("/ai")) continue;
                    text = text.slice(3).trim();
                }

                try {
                    await generateAndSend(m.sender, text, contact);
                    cooldowns[m.sender] = Date.now() / 1000;
                } catch (e) {
                    console.error(
                        "[iMessage] auto reply failed:",
                        (e as Error).message,
                    );
                }
            }
        } catch (e) {
            console.error("[iMessage] poll error:", (e as Error).message);
        }
        setTimeout(poll, CFG.imessage.poll_interval * 1000);
    }

    setTimeout(poll, 1000);
}

// ── Sleep ──

let sleepPreventing = false;
let caffeinateProcess: ReturnType<typeof spawn> | null = null;

// ── Fastify ──

const fastify = Fastify({ logger: true });

// ── Health ──

fastify.get("/api/health", async () => {
    const s: Record<string, boolean> = { imessage: im.checkAccess() };
    for (const [key, mc] of Object.entries(CFG.models || {})) {
        try {
            const isOllama = mc.base_url.includes("11434");
            const url = isOllama
                ? `${mc.base_url}/api/tags`
                : `${mc.base_url}/models`;
            const headers: Record<string, string> = {};
            if (!isOllama && mc.api_key && mc.api_key !== "YOUR_MIMO_API_KEY")
                headers.Authorization = `Bearer ${mc.api_key}`;
            const r = await fetch(url, {
                headers,
                signal: AbortSignal.timeout(5000),
            });
            s[key] = r.ok;
        } catch {
            s[key] = false;
        }
    }
    return s;
});

// ── Config API ──

fastify.get("/api/config", async () => ({
    models: Object.entries(CFG.models || {}).map(([id, mc]) => ({
        id,
        name: mc.name,
        base_url: mc.base_url,
        model_id: mc.model_id,
        has_key: !!mc.api_key && mc.api_key !== "YOUR_MIMO_API_KEY",
        is_ollama: mc.base_url.includes("11434"),
        temperature: mc.temperature,
        max_tokens: mc.max_tokens,
    })),
    default_model: CFG.default_model,
    system_prompt: CFG.system_prompt,
    imessage: CFG.imessage,
    tavily_configured: !!CFG.tavily_api_key?.trim(),
}));

fastify.post("/api/config", async (req) => {
    const updates = req.body as Partial<AppConfig>;
    if (updates.default_model !== undefined)
        CFG.default_model = updates.default_model;
    if (updates.system_prompt !== undefined)
        CFG.system_prompt = updates.system_prompt;
    if (updates.imessage !== undefined)
        Object.assign(CFG.imessage, updates.imessage);
    fs.writeFileSync(
        path.join(ROOT, "config.json"),
        JSON.stringify(CFG, null, 2),
    );
    return { ok: true };
});

fastify.post("/api/config/models", async (req) => {
    const { id, name, base_url, api_key, model_id, temperature, max_tokens } =
        req.body as {
            id: string;
            name: string;
            base_url: string;
            api_key?: string;
            model_id: string;
            temperature?: number;
            max_tokens?: number;
        };
    if (!id || !model_id || !base_url)
        return { error: "id, model_id, base_url required" };
    CFG.models[id] = {
        name: name || id,
        base_url,
        api_key: api_key || undefined,
        model_id,
        temperature: temperature ?? 0.7,
        max_tokens: max_tokens ?? 4096,
    };
    fs.writeFileSync(
        path.join(ROOT, "config.json"),
        JSON.stringify(CFG, null, 2),
    );
    return { ok: true };
});

fastify.delete("/api/config/models/:id", async (req) => {
    const { id } = req.params as { id: string };
    if (Object.keys(CFG.models).length <= 1)
        return { error: "至少保留一个模型" };
    delete CFG.models[id];
    if (CFG.default_model === id)
        CFG.default_model = Object.keys(CFG.models)[0];
    fs.writeFileSync(
        path.join(ROOT, "config.json"),
        JSON.stringify(CFG, null, 2),
    );
    return { ok: true };
});

fastify.post("/api/config/test-model", async (req) => {
    const { id } = req.body as { id: string };
    const mc = CFG.models?.[id];
    if (!mc) return { error: "模型不存在" };
    try {
        const isOllama = mc.base_url.includes("11434");
        const url = isOllama
            ? `${mc.base_url}/api/tags`
            : `${mc.base_url}/models`;
        const headers: Record<string, string> = {};
        if (!isOllama && mc.api_key && mc.api_key !== "YOUR_MIMO_API_KEY")
            headers.Authorization = `Bearer ${mc.api_key}`;
        const r = await fetch(url, {
            headers,
            signal: AbortSignal.timeout(5000),
        });
        if (r.ok) return { ok: true, message: "连接成功 ✓" };
        return { ok: false, message: `HTTP ${r.status}` };
    } catch (e) {
        return { ok: false, message: (e as Error).message };
    }
});

fastify.get("/api/config/ollama-models", async () => {
    try {
        const r = await fetch("http://localhost:11434/api/tags", {
            signal: AbortSignal.timeout(3000),
        });
        if (!r.ok) return { models: [] };
        const data = (await r.json()) as any;
        return {
            models: (data.models || []).map((m: any) => ({
                name: m.name,
                size: (m.size / 1e9).toFixed(1) + " GB",
            })),
        };
    } catch {
        return { models: [] };
    }
});

fastify.post("/api/config/tavily", async (req) => {
    const { api_key } = req.body as { api_key: string };
    if (!api_key) return { error: "api_key required" };
    CFG.tavily_api_key = api_key;
    fs.writeFileSync(
        path.join(ROOT, "config.json"),
        JSON.stringify(CFG, null, 2),
    );
    return { ok: true };
});

fastify.get("/api/config/tavily/test", async () => {
    if (!CFG.tavily_api_key) return { ok: false, message: "API Key 未配置" };
    try {
        const results = await webSearch("test", 1, CFG.tavily_api_key);
        if (results.length > 0) return { ok: true, message: "连接成功 ✓" };
        return { ok: false, message: "返回空结果" };
    } catch (e) {
        return { ok: false, message: (e as Error).message };
    }
});

// ── Setup API ──

fastify.get("/api/setup/status", async () => {
    const status: any = {
        ollama: false,
        ollama_models: [],
        mimo_configured: false,
        needs_setup: true,
    };
    try {
        const r = await fetch("http://localhost:11434/api/tags", {
            signal: AbortSignal.timeout(3000),
        });
        if (r.ok) {
            status.ollama = true;
            const data = (await r.json()) as any;
            status.ollama_models = (data.models || []).map((m: any) => ({
                name: m.name,
                size: (m.size / 1e9).toFixed(1) + " GB",
            }));
        }
    } catch {}
    try {
        const mc = CFG.models?.mimo;
        if (mc?.api_key && mc.api_key !== "YOUR_MIMO_API_KEY")
            status.mimo_configured = true;
    } catch {}
    status.needs_setup = !status.ollama && !status.mimo_configured;
    return status;
});

fastify.post("/api/setup/pull-model", async (req, reply) => {
    const { model } = req.body as { model: string };
    if (!model) return reply.code(400).send({ error: "model required" });
    reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });
    try {
        const resp = await fetch("http://localhost:11434/api/pull", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: model, stream: true }),
        });
        if (!resp.ok) {
            reply.raw.write(
                `data: ${JSON.stringify({ error: `HTTP ${resp.status}` })}\n\n`,
            );
            reply.raw.end();
            return;
        }
        const dec = new TextDecoder();
        let buf = "";
        for await (const chunk of resp.body!) {
            buf += dec.decode(chunk, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() || "";
            for (const line of lines) {
                if (!line) continue;
                try {
                    reply.raw.write(
                        `data: ${JSON.stringify(JSON.parse(line))}\n\n`,
                    );
                } catch {}
            }
        }
        CFG.models.qwen = {
            name: "Qwen (本地)",
            base_url: "http://localhost:11434",
            model_id: model,
            temperature: 0.7,
            max_tokens: 4096,
        };
        CFG.default_model = "qwen";
        fs.writeFileSync(
            path.join(ROOT, "config.json"),
            JSON.stringify(CFG, null, 2),
        );
        reply.raw.write(`data: ${JSON.stringify({ done: true, model })}\n\n`);
    } catch (e) {
        reply.raw.write(
            `data: ${JSON.stringify({ error: (e as Error).message })}\n\n`,
        );
    }
    reply.raw.end();
});

fastify.post("/api/setup/configure-cloud", async (req) => {
    const { provider, api_key, base_url, model_id } = req.body as {
        provider: string;
        api_key: string;
        base_url?: string;
        model_id?: string;
    };
    if (provider === "mimo") {
        CFG.models.mimo.api_key = api_key;
        if (base_url) CFG.models.mimo.base_url = base_url;
        if (model_id) CFG.models.mimo.model_id = model_id;
        CFG.default_model = "mimo";
    }
    fs.writeFileSync(
        path.join(ROOT, "config.json"),
        JSON.stringify(CFG, null, 2),
    );
    return { ok: true };
});

// ── iMessage API ──

fastify.get("/api/imessage/diagnose", async () => ({
    issues: await im.diagnose(),
}));

fastify.get("/api/imessage/debug", async () => {
    try {
        const latestRowId = await im.getLatestRowId();
        const newMsgs = await im.getNewMessages(latestRowId - 10);
        return {
            currentPollRowId: latestRowId,
            recentMessages: newMsgs.map((m) => ({
                rowid: m.rowid,
                from_me: m.is_from_me,
                sender: m.sender,
                text: m.text.slice(0, 50),
            })),
        };
    } catch (e) {
        return { error: (e as Error).message };
    }
});

fastify.post("/api/imessage/test", async (req) => {
    const { handle } = req.body as { handle: string };
    if (!handle) return { error: "handle required" };
    const contacts = dbQuery(
        "SELECT * FROM imessage_contacts WHERE handle_id = ?",
        [handle],
    );
    const contact = contacts[0] as unknown as IMContact | undefined;
    if (!contact) return { error: "contact not found" };
    try {
        let sid: string;
        const existing = dbQuery(
            "SELECT id FROM sessions WHERE imessage_handle = ? AND source = 'imessage'",
            [handle],
        );
        if (existing.length) {
            sid = existing[0].id as string;
        } else {
            sid = crypto.randomUUID();
            const now = Date.now() / 1000;
            dbRun(
                "INSERT INTO sessions (id,title,model,source,imessage_handle,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
                [
                    sid,
                    `iMessage: ${contact.name || handle}`,
                    contact.model,
                    "imessage",
                    handle,
                    now,
                    now,
                ],
            );
        }
        dbRun(
            "INSERT INTO messages (id,session_id,role,content,created_at) VALUES (?,?,?,?,?)",
            [
                crypto.randomUUID(),
                sid,
                "user",
                "你好，这是一条测试消息",
                Date.now() / 1000,
            ],
        );
        const history = dbQuery(
            "SELECT role,content FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 20",
            [sid],
        ).reverse();
        const messages: Msg[] = [
            { role: "system", content: CFG.system_prompt },
            ...(history as unknown as Msg[]),
        ];
        const streamFn = getStreamFn(contact.model || CFG.default_model);
        let full = "";
        for await (const chunk of streamFn(messages)) full += chunk;
        if (full) {
            dbRun(
                "INSERT INTO messages (id,session_id,role,content,model,created_at) VALUES (?,?,?,?,?,?)",
                [
                    crypto.randomUUID(),
                    sid,
                    "assistant",
                    full,
                    contact.model,
                    Date.now() / 1000,
                ],
            );
            return {
                sent: im.sendMessage(handle, full),
                reply: full,
                session_id: sid,
            };
        }
        return { error: "no AI reply" };
    } catch (e) {
        return { error: (e as Error).message };
    }
});

fastify.get("/api/imessage/contacts", async () =>
    dbQuery("SELECT * FROM imessage_contacts ORDER BY created_at DESC"),
);

fastify.post("/api/imessage/contacts", async (req) => {
    const { handle_id, name, trigger_mode } = req.body as {
        handle_id: string;
        name?: string;
        trigger_mode?: string;
    };
    dbRun(
        "INSERT OR REPLACE INTO imessage_contacts (handle_id,name,auto_reply,model,trigger_mode,created_at) VALUES (?,?,?,?,?,?)",
        [
            handle_id,
            name || "",
            1,
            CFG.default_model,
            trigger_mode || "always",
            Date.now() / 1000,
        ],
    );
    return { ok: true };
});

fastify.delete("/api/imessage/contacts/:id", async (req) => {
    const { id } = req.params as { id: string };
    dbRun("DELETE FROM imessage_contacts WHERE handle_id = ?", [id]);
    return { ok: true };
});

// ── Sessions CRUD ──

fastify.get("/api/models", async () =>
    Object.entries(CFG.models || {}).map(([id, m]) => ({
        id,
        name: m.name || id,
    })),
);

fastify.get("/api/sessions", async () =>
    dbQuery("SELECT * FROM sessions ORDER BY updated_at DESC"),
);

fastify.post("/api/sessions", async (req) => {
    const { model } = req.body as { model?: string };
    const id = crypto.randomUUID();
    const now = Date.now() / 1000;
    const m = model || CFG.default_model;
    dbRun(
        "INSERT INTO sessions (id,title,model,source,created_at,updated_at) VALUES (?,?,?,?,?,?)",
        [id, "新对话", m, "web", now, now],
    );
    return {
        id,
        title: "新对话",
        model: m,
        source: "web",
        created_at: now,
        updated_at: now,
    };
});

fastify.put("/api/sessions/:id", async (req) => {
    const { id } = req.params as { id: string };
    const { title, model } = req.body as { title?: string; model?: string };
    if (title) dbRun("UPDATE sessions SET title = ? WHERE id = ?", [title, id]);
    if (model) dbRun("UPDATE sessions SET model = ? WHERE id = ?", [model, id]);
    return { ok: true };
});

fastify.delete("/api/sessions/:id", async (req) => {
    const { id } = req.params as { id: string };
    dbRun("DELETE FROM messages WHERE session_id = ?", [id]);
    dbRun("DELETE FROM sessions WHERE id = ?", [id]);
    return { ok: true };
});

fastify.get("/api/sessions/:id/messages", async (req) => {
    const { id } = req.params as { id: string };
    return dbQuery(
        "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at",
        [id],
    );
});

// ── Chat SSE ──

fastify.post("/api/chat", async (req, reply) => {
    const { session_id, message, model, search } = req.body as {
        session_id: string;
        message: string;
        model?: string;
        search?: boolean;
    };
    if (!message?.trim()) return reply.code(400).send({ error: "empty" });

    const now = Date.now() / 1000;
    const modelId = model || CFG.default_model;

    dbRun(
        "INSERT INTO messages (id,session_id,role,content,created_at) VALUES (?,?,?,?,?)",
        [crypto.randomUUID(), session_id, "user", message.trim(), now],
    );
    dbRun("UPDATE sessions SET updated_at = ? WHERE id = ?", [now, session_id]);

    const history = dbQuery(
        "SELECT role,content FROM messages WHERE session_id = ? ORDER BY created_at",
        [session_id],
    ) as unknown as Msg[];

    reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });

    // 长期记忆
    const memory = extractMemory(session_id);

    // 统一搜索决策
    const ctx = await decideAndSearch(message.trim(), search);
    console.log(
        `[Chat] search=${!!ctx} (manual=${search}) message="${message.slice(0, 30)}"`,
    );

    let messages: Msg[];

    if (ctx) {
        reply.raw.write(`data: ${JSON.stringify({ searching: true })}\n\n`);
        const historyForSearch = history.slice(0, -1);
        messages = buildMessages(CFG.system_prompt, historyForSearch, memory);
        messages.push({
            role: "user",
            content: buildSearchPrompt(message.trim(), ctx),
        });
    } else {
        messages = buildMessages(CFG.system_prompt, history, memory);
    }

    const streamFn = getStreamFn(modelId);
    let full = "";
    try {
        for await (const chunk of streamFn(messages)) {
            full += chunk;
            reply.raw.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        }
    } catch (e) {
        const errMsg = `[Error] ${(e as Error).message}`;
        reply.raw.write(`data: ${JSON.stringify({ content: errMsg })}\n\n`);
        full = errMsg;
    }

    dbRun(
        "INSERT INTO messages (id,session_id,role,content,model,created_at) VALUES (?,?,?,?,?,?)",
        [
            crypto.randomUUID(),
            session_id,
            "assistant",
            full,
            modelId,
            Date.now() / 1000,
        ],
    );

    const n =
        (dbQuery(
            "SELECT COUNT(*) as n FROM messages WHERE session_id = ? AND role = 'user'",
            [session_id],
        )[0]?.n as number) || 0;
    if (n === 1 && !full.startsWith("\n\n**") && !full.startsWith("[Error]")) {
        dbRun("UPDATE sessions SET title = ? WHERE id = ?", [
            full.slice(0, 40) + (full.length > 40 ? "…" : ""),
            session_id,
        ]);
    }

    reply.raw.write("data: [DONE]\n\n");
    reply.raw.end();

    extractFacts(session_id).catch(() => {});
});

// ── Search API ──

fastify.post("/api/search", async (req) => {
    const { query } = req.body as { query: string };
    if (!query?.trim()) return { error: "query required" };
    return { results: await webSearch(query.trim(), 5, CFG.tavily_api_key) };
});

// ── Sleep ──

fastify.post("/api/sleep/toggle", async () => {
    if (sleepPreventing && caffeinateProcess) {
        caffeinateProcess.kill();
        caffeinateProcess = null;
        sleepPreventing = false;
        return { preventing: false };
    }
    caffeinateProcess = spawn("caffeinate", ["-i", "-s"], { stdio: "ignore" });
    sleepPreventing = true;
    caffeinateProcess.on("error", () => {
        sleepPreventing = false;
        caffeinateProcess = null;
    });
    return { preventing: true };
});

// ── Static files ──

const RENDERER_DIR = path.join(ROOT, "dist", "renderer");
const isProd = fs.existsSync(RENDERER_DIR);

if (isProd) {
    fastify.register(fastifyStatic, { root: RENDERER_DIR, prefix: "/" });
    fastify.setNotFoundHandler((req, reply) => {
        if (req.url.startsWith("/api"))
            reply.code(404).send({ error: "not found" });
        else reply.sendFile("index.html");
    });
} else {
    fastify.get("/", async () => ({
        status: "ok",
        message: "API server running. Open http://localhost:5173 for the UI.",
    }));
}

// ── Start ──

export async function startServer() {
    try {
        await initDB();
        const port = CFG.port || 18789;
        await fastify.listen({ port, host: "127.0.0.1" });
        console.log(`[Server] API:  http://127.0.0.1:${port}`);
        if (!isProd) console.log(`[Server] UI:   http://localhost:5173`);
        startPoller();
    } catch (err: any) {
        if (err.code === "EADDRINUSE")
            console.warn(`[Server] port ${CFG.port} in use`);
        else console.error("[Server] startup failed:", err);
    }
}

export { fastify };

if (require.main === module) {
    startServer().catch(console.error);
}
