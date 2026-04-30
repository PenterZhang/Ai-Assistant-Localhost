import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import os from "os";
import * as im from "./imessage";

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

// ── Config & DB ──

const ROOT = process.cwd();
const CFG: AppConfig = JSON.parse(
    fs.readFileSync(path.join(ROOT, "config.json"), "utf-8"),
);

const DB_DIR = path.join(os.homedir(), ".ai-assistant");
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, "chat.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '新对话',
    model TEXT NOT NULL DEFAULT 'mimo', source TEXT NOT NULL DEFAULT 'web',
    imessage_handle TEXT, created_at REAL NOT NULL, updated_at REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
    content TEXT NOT NULL, model TEXT, created_at REAL NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS imessage_contacts (
    handle_id TEXT PRIMARY KEY, name TEXT, auto_reply INTEGER DEFAULT 1,
    model TEXT DEFAULT 'mimo', trigger_mode TEXT DEFAULT 'always',
    created_at REAL NOT NULL
  );
`);

// ── Model Streaming ──

async function* streamMimo(messages: Msg[]): AsyncGenerator<string> {
    const mc = CFG.models.mimo;
    if (!mc.api_key || mc.api_key === "YOUR_MIMO_API_KEY") {
        yield "\n\n**MiMo API Key 未配置，请在 config.json 中填写 api_key**";
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
        const err = await resp.text();
        yield `\n\n**MiMo API Error (${resp.status})**: ${err.slice(0, 200)}`;
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
    // ✅ 通用 Ollama 调用，不绑定具体模型名
    // 从配置中找到第一个 base_url 包含 11434 的模型
    const ollamaModel = Object.values(CFG.models).find((m) =>
        m.base_url.includes("11434"),
    );
    if (!ollamaModel) {
        yield "\n\n**未配置 Ollama 模型**";
        return;
    }
    const resp = await fetch(`${ollamaModel.base_url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: ollamaModel.model_id,
            messages,
            stream: true,
            options: {
                temperature: ollamaModel.temperature ?? 0.7,
                num_predict: ollamaModel.max_tokens ?? 4096,
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

// ✅ 根据 modelId 自动选择正确的 stream 函数
function getStreamFn(modelId: string): (m: Msg[]) => AsyncGenerator<string> {
    const mc = CFG.models[modelId];
    if (!mc) return streamMimo;
    // base_url 包含 11434 → Ollama
    if (mc.base_url.includes("11434")) return streamOllama;
    // 其他 → OpenAI 兼容（MiMo）
    return streamMimo;
}

// ── iMessage Poller ──

let polling = false;

function startPoller() {
    if (!CFG.imessage?.enabled || polling) return;
    if (!im.checkAccess()) {
        console.log("[iMessage] chat.db not accessible");
        return;
    }

    let lastRowId = im.getLatestRowId();
    const cooldowns: Record<string, number> = {};
    polling = true;
    console.log(`[iMessage] polling from ROWID ${lastRowId}`);

    setInterval(async () => {
        try {
            for (const m of im.getNewMessages(lastRowId)) {
                lastRowId = Math.max(lastRowId, m.rowid);
                if (m.is_from_me || !m.text.trim()) continue;
                const now = Date.now() / 1000;
                if (now - (cooldowns[m.sender] || 0) < CFG.imessage.cooldown)
                    continue;

                const contact = db
                    .prepare(
                        "SELECT * FROM imessage_contacts WHERE handle_id=?",
                    )
                    .get(m.sender) as IMContact | undefined;
                if (!contact?.auto_reply) continue;
                if (contact.trigger_mode === "prefix:/ai") {
                    if (!m.text.startsWith("/ai")) continue;
                    m.text = m.text.slice(3).trim();
                }

                let sid: string;
                const existing = db
                    .prepare(
                        "SELECT id FROM sessions WHERE imessage_handle=? AND source='imessage'",
                    )
                    .get(m.sender) as { id: string } | undefined;
                if (existing) {
                    sid = existing.id;
                } else {
                    sid = crypto.randomUUID();
                    const now = Date.now() / 1000;
                    db.prepare(
                        "INSERT INTO sessions (id,title,model,source,imessage_handle,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
                    ).run(
                        sid,
                        `iMessage: ${contact.name || m.sender}`,
                        contact.model,
                        "imessage",
                        m.sender,
                        now,
                        now,
                    );
                }

                db.prepare(
                    "INSERT INTO messages (id,session_id,role,content,created_at) VALUES (?,?,?,?,?)",
                ).run(
                    crypto.randomUUID(),
                    sid,
                    "user",
                    m.text,
                    Date.now() / 1000,
                );

                const history = (
                    db
                        .prepare(
                            "SELECT role,content FROM messages WHERE session_id=? ORDER BY created_at DESC LIMIT 20",
                        )
                        .all(sid) as Msg[]
                ).reverse();
                const messages: Msg[] = [
                    { role: "system", content: CFG.system_prompt },
                    ...history,
                ];

                // ✅ 用 getStreamFn
                const streamFn = getStreamFn(contact.model);
                let full = "";
                for await (const chunk of streamFn(messages)) full += chunk;

                if (full) {
                    db.prepare(
                        "INSERT INTO messages (id,session_id,role,content,model,created_at) VALUES (?,?,?,?,?,?)",
                    ).run(
                        crypto.randomUUID(),
                        sid,
                        "assistant",
                        full,
                        contact.model,
                        Date.now() / 1000,
                    );
                    im.sendMessage(m.sender, full);
                    cooldowns[m.sender] = Date.now() / 1000;
                }
            }
        } catch (e) {
            console.error("[iMessage]", (e as Error).message);
        }
    }, CFG.imessage.poll_interval * 1000);
}

// ── Fastify ──

const fastify = Fastify({ logger: false });

// Health
fastify.get("/api/health", async () => {
    const s: Record<string, boolean> = { imessage: im.checkAccess() };
    for (const [key, mc] of Object.entries(CFG.models)) {
        try {
            const isOllama = mc.base_url.includes("11434");
            const url = isOllama
                ? `${mc.base_url}/api/tags`
                : `${mc.base_url}/models`;
            const headers: Record<string, string> = {};
            if (!isOllama && mc.api_key && mc.api_key !== "YOUR_MIMO_API_KEY") {
                headers.Authorization = `Bearer ${mc.api_key}`;
            }
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

// Models
fastify.get("/api/models", async () =>
    Object.entries(CFG.models).map(([id, m]) => ({ id, name: m.name || id })),
);

// Sessions CRUD
fastify.get("/api/sessions", async () =>
    db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all(),
);

fastify.post("/api/sessions", async (req) => {
    const { model } = req.body as { model?: string };
    const id = crypto.randomUUID();
    const now = Date.now() / 1000;
    db.prepare(
        "INSERT INTO sessions (id,title,model,source,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    ).run(id, "新对话", model || CFG.default_model, "web", now, now);
    return {
        id,
        title: "新对话",
        model: model || CFG.default_model,
        source: "web",
        created_at: now,
        updated_at: now,
    };
});

fastify.put("/api/sessions/:id", async (req) => {
    const { id } = req.params as { id: string };
    const { title, model } = req.body as { title?: string; model?: string };
    if (title)
        db.prepare("UPDATE sessions SET title=? WHERE id=?").run(title, id);
    if (model)
        db.prepare("UPDATE sessions SET model=? WHERE id=?").run(model, id);
    return { ok: true };
});

fastify.delete("/api/sessions/:id", async (req) => {
    const { id } = req.params as { id: string };
    db.prepare("DELETE FROM messages WHERE session_id=?").run(id);
    db.prepare("DELETE FROM sessions WHERE id=?").run(id);
    return { ok: true };
});

// Messages
fastify.get("/api/sessions/:id/messages", async (req) => {
    const { id } = req.params as { id: string };
    return db
        .prepare(
            "SELECT * FROM messages WHERE session_id=? ORDER BY created_at",
        )
        .all(id);
});

// Chat SSE
fastify.post("/api/chat", async (req, reply) => {
    const { session_id, message, model } = req.body as {
        session_id: string;
        message: string;
        model?: string;
    };
    if (!message?.trim()) return reply.code(400).send({ error: "empty" });

    const now = Date.now() / 1000;
    const modelId = model || CFG.default_model;
    db.prepare(
        "INSERT INTO messages (id,session_id,role,content,created_at) VALUES (?,?,?,?,?)",
    ).run(crypto.randomUUID(), session_id, "user", message.trim(), now);
    db.prepare("UPDATE sessions SET updated_at=? WHERE id=?").run(
        now,
        session_id,
    );

    const history = db
        .prepare(
            "SELECT role,content FROM messages WHERE session_id=? ORDER BY created_at",
        )
        .all(session_id) as Msg[];
    const messages: Msg[] = [
        { role: "system", content: CFG.system_prompt },
        ...history,
    ];

    reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });

    // ✅ 用 getStreamFn
    const streamFn = getStreamFn(modelId);
    let full = "";
    try {
        for await (const chunk of streamFn(messages)) {
            full += chunk;
            reply.raw.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        }
    } catch (e) {
        reply.raw.write(
            `data: ${JSON.stringify({ content: `[Error] ${(e as Error).message}` })}\n\n`,
        );
    }

    db.prepare(
        "INSERT INTO messages (id,session_id,role,content,model,created_at) VALUES (?,?,?,?,?,?)",
    ).run(
        crypto.randomUUID(),
        session_id,
        "assistant",
        full,
        modelId,
        Date.now() / 1000,
    );

    // ✅ 错误不设标题
    const n = (
        db
            .prepare(
                "SELECT COUNT(*) AS n FROM messages WHERE session_id=? AND role='user'",
            )
            .get(session_id) as { n: number }
    ).n;
    if (n === 1 && !full.startsWith("\n\n**")) {
        db.prepare("UPDATE sessions SET title=? WHERE id=?").run(
            full.slice(0, 40) + (full.length > 40 ? "…" : ""),
            session_id,
        );
    }

    reply.raw.write("data: [DONE]\n\n");
    reply.raw.end();
});

// iMessage Contacts
fastify.get("/api/imessage/contacts", async () =>
    db
        .prepare("SELECT * FROM imessage_contacts ORDER BY created_at DESC")
        .all(),
);

fastify.post("/api/imessage/contacts", async (req) => {
    const { handle_id, name, trigger_mode } = req.body as {
        handle_id: string;
        name?: string;
        trigger_mode?: string;
    };
    db.prepare(
        "INSERT OR REPLACE INTO imessage_contacts (handle_id,name,auto_reply,model,trigger_mode,created_at) VALUES (?,?,?,?,?,?)",
    ).run(
        handle_id,
        name || "",
        1,
        "mimo",
        trigger_mode || "always",
        Date.now() / 1000,
    );
    return { ok: true };
});

fastify.delete("/api/imessage/contacts/:id", async (req) => {
    const { id } = req.params as { id: string };
    db.prepare("DELETE FROM imessage_contacts WHERE handle_id=?").run(id);
    return { ok: true };
});

// Sleep
let caffeinate: ReturnType<typeof import("child_process").spawn> | null = null;
fastify.post("/api/sleep/toggle", async () => {
    const { spawn } = await import("child_process");
    if (caffeinate && !caffeinate.killed) {
        caffeinate.kill();
        caffeinate = null;
        return { preventing: false };
    }
    caffeinate = spawn("caffeinate", ["-i", "-s"], { stdio: "ignore" });
    return { preventing: true };
});

// ── 静态文件 ──

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
    const port = CFG.port || 18789;
    await fastify.listen({ port, host: "127.0.0.1" });
    console.log(`[Server] API:  http://127.0.0.1:${port}`);
    if (!isProd)
        console.log(`[Server] UI:   http://localhost:5173  ← 打开这个`);
    startPoller();
}

export { fastify };

if (require.main === module) {
    startServer().catch(console.error);
}
