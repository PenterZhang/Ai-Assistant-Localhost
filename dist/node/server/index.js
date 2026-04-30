"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fastify = void 0;
exports.startServer = startServer;
const fastify_1 = __importDefault(require("fastify"));
const static_1 = __importDefault(require("@fastify/static"));
const sql_js_1 = __importDefault(require("sql.js"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
const os_1 = __importDefault(require("os"));
const im = __importStar(require("./imessage"));
// ── Config ──
const ROOT = process.cwd();
const CFG = JSON.parse(fs_1.default.readFileSync(path_1.default.join(ROOT, "config.json"), "utf-8"));
const DB_DIR = path_1.default.join(os_1.default.homedir(), ".ai-assistant");
if (!fs_1.default.existsSync(DB_DIR))
    fs_1.default.mkdirSync(DB_DIR, { recursive: true });
const DB_PATH = path_1.default.join(DB_DIR, "chat.db");
// ── sql.js 数据库封装 ──
let db;
let dbSaveTimer = null;
function dbSave() {
    // 防抖：多次写入合并为一次磁盘写入
    if (dbSaveTimer)
        clearTimeout(dbSaveTimer);
    dbSaveTimer = setTimeout(() => {
        const data = db.export();
        fs_1.default.writeFileSync(DB_PATH, Buffer.from(data));
    }, 500);
}
function dbQuery(sql, params = []) {
    const stmt = db.prepare(sql);
    if (params.length)
        stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}
function dbRun(sql, params = []) {
    db.run(sql, params);
    dbSave();
}
async function initDB() {
    const SQL = await (0, sql_js_1.default)();
    if (fs_1.default.existsSync(DB_PATH)) {
        const buf = fs_1.default.readFileSync(DB_PATH);
        db = new SQL.Database(buf);
    }
    else {
        db = new SQL.Database();
    }
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");
    db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '新对话',
      model TEXT NOT NULL DEFAULT 'mimo', source TEXT NOT NULL DEFAULT 'web',
      imessage_handle TEXT, created_at REAL NOT NULL, updated_at REAL NOT NULL
    )
  `);
    db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, model TEXT, created_at REAL NOT NULL
    )
  `);
    db.run(`
    CREATE TABLE IF NOT EXISTS imessage_contacts (
      handle_id TEXT PRIMARY KEY, name TEXT, auto_reply INTEGER DEFAULT 1,
      model TEXT DEFAULT 'mimo', trigger_mode TEXT DEFAULT 'always',
      created_at REAL NOT NULL
    )
  `);
    dbSave();
}
// ── Model Streaming ──
async function* streamMimo(messages) {
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
    for await (const chunk of resp.body) {
        buf += dec.decode(chunk, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
            if (!line.startsWith("data: "))
                continue;
            const d = line.slice(6).trim();
            if (d === "[DONE]")
                return;
            try {
                const c = JSON.parse(d).choices?.[0]?.delta?.content;
                if (c)
                    yield c;
            }
            catch { }
        }
    }
}
async function* streamOllama(messages) {
    const ollamaModel = Object.values(CFG.models).find((m) => m.base_url.includes("11434"));
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
    for await (const chunk of resp.body) {
        buf += dec.decode(chunk, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
            if (!line)
                continue;
            try {
                const c = JSON.parse(line).message?.content;
                if (c)
                    yield c;
            }
            catch { }
        }
    }
}
function getStreamFn(modelId) {
    const mc = CFG.models[modelId];
    if (!mc)
        return streamMimo;
    if (mc.base_url.includes("11434"))
        return streamOllama;
    return streamMimo;
}
// ── iMessage Poller ──
let polling = false;
function startPoller() {
    if (!CFG.imessage?.enabled || polling)
        return;
    if (!im.checkAccess()) {
        console.log("[iMessage] chat.db not accessible");
        return;
    }
    polling = true;
    // ✅ 用一个对象包裹，方便在闭包里修改
    const state = { lastRowId: 0, ready: false };
    const cooldowns = {};
    // ✅ 异步初始化 ROWID
    im.getLatestRowId().then((id) => {
        state.lastRowId = id;
        state.ready = true;
        console.log(`[iMessage] polling from ROWID ${id}`);
    });
    setInterval(async () => {
        if (!state.ready)
            return;
        try {
            const msgs = await im.getNewMessages(state.lastRowId);
            for (const m of msgs) {
                state.lastRowId = Math.max(state.lastRowId, m.rowid);
                if (m.is_from_me || !m.text.trim())
                    continue;
                const now = Date.now() / 1000;
                if (now - (cooldowns[m.sender] || 0) < CFG.imessage.cooldown)
                    continue;
                const contacts = dbQuery("SELECT * FROM imessage_contacts WHERE handle_id = ?", [m.sender]);
                const contact = contacts[0];
                if (!contact?.auto_reply)
                    continue;
                if (contact.trigger_mode === "prefix:/ai") {
                    if (!m.text.startsWith("/ai"))
                        continue;
                    m.text = m.text.slice(3).trim();
                }
                let sid;
                const existing = dbQuery("SELECT id FROM sessions WHERE imessage_handle = ? AND source = 'imessage'", [m.sender]);
                if (existing.length) {
                    sid = existing[0].id;
                }
                else {
                    sid = crypto_1.default.randomUUID();
                    const n = Date.now() / 1000;
                    dbRun("INSERT INTO sessions (id,title,model,source,imessage_handle,created_at,updated_at) VALUES (?,?,?,?,?,?,?)", [
                        sid,
                        `iMessage: ${contact.name || m.sender}`,
                        contact.model,
                        "imessage",
                        m.sender,
                        n,
                        n,
                    ]);
                }
                dbRun("INSERT INTO messages (id,session_id,role,content,created_at) VALUES (?,?,?,?,?)", [
                    crypto_1.default.randomUUID(),
                    sid,
                    "user",
                    m.text,
                    Date.now() / 1000,
                ]);
                const history = dbQuery("SELECT role,content FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 20", [sid]).reverse();
                const messages = [
                    { role: "system", content: CFG.system_prompt },
                    ...history,
                ];
                const streamFn = getStreamFn(contact.model);
                let full = "";
                for await (const chunk of streamFn(messages))
                    full += chunk;
                if (full) {
                    dbRun("INSERT INTO messages (id,session_id,role,content,model,created_at) VALUES (?,?,?,?,?,?)", [
                        crypto_1.default.randomUUID(),
                        sid,
                        "assistant",
                        full,
                        contact.model,
                        Date.now() / 1000,
                    ]);
                    im.sendMessage(m.sender, full);
                    cooldowns[m.sender] = Date.now() / 1000;
                }
            }
        }
        catch (e) {
            console.error("[iMessage]", e.message);
        }
    }, CFG.imessage.poll_interval * 1000);
}
// ── Fastify ──
const fastify = (0, fastify_1.default)({ logger: false });
exports.fastify = fastify;
// Health
fastify.get("/api/health", async () => {
    // ✅ checkAccess 是同步的，不需要改
    const s = { imessage: im.checkAccess() };
    for (const [key, mc] of Object.entries(CFG.models)) {
        try {
            const isOllama = mc.base_url.includes("11434");
            const url = isOllama
                ? `${mc.base_url}/api/tags`
                : `${mc.base_url}/models`;
            const headers = {};
            if (!isOllama && mc.api_key && mc.api_key !== "YOUR_MIMO_API_KEY") {
                headers.Authorization = `Bearer ${mc.api_key}`;
            }
            const r = await fetch(url, {
                headers,
                signal: AbortSignal.timeout(5000),
            });
            s[key] = r.ok;
        }
        catch {
            s[key] = false;
        }
    }
    return s;
});
// Models
fastify.get("/api/models", async () => Object.entries(CFG.models).map(([id, m]) => ({ id, name: m.name || id })));
// Sessions CRUD
fastify.get("/api/sessions", async () => dbQuery("SELECT * FROM sessions ORDER BY updated_at DESC"));
fastify.post("/api/sessions", async (req) => {
    const { model } = req.body;
    const id = crypto_1.default.randomUUID();
    const now = Date.now() / 1000;
    const m = model || CFG.default_model;
    dbRun("INSERT INTO sessions (id,title,model,source,created_at,updated_at) VALUES (?,?,?,?,?,?)", [id, "新对话", m, "web", now, now]);
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
    const { id } = req.params;
    const { title, model } = req.body;
    if (title)
        dbRun("UPDATE sessions SET title = ? WHERE id = ?", [title, id]);
    if (model)
        dbRun("UPDATE sessions SET model = ? WHERE id = ?", [model, id]);
    return { ok: true };
});
fastify.delete("/api/sessions/:id", async (req) => {
    const { id } = req.params;
    dbRun("DELETE FROM messages WHERE session_id = ?", [id]);
    dbRun("DELETE FROM sessions WHERE id = ?", [id]);
    return { ok: true };
});
// Messages
fastify.get("/api/sessions/:id/messages", async (req) => {
    const { id } = req.params;
    return dbQuery("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at", [id]);
});
// Chat SSE
fastify.post("/api/chat", async (req, reply) => {
    const { session_id, message, model } = req.body;
    if (!message?.trim())
        return reply.code(400).send({ error: "empty" });
    const now = Date.now() / 1000;
    const modelId = model || CFG.default_model;
    dbRun("INSERT INTO messages (id,session_id,role,content,created_at) VALUES (?,?,?,?,?)", [crypto_1.default.randomUUID(), session_id, "user", message.trim(), now]);
    dbRun("UPDATE sessions SET updated_at = ? WHERE id = ?", [now, session_id]);
    const history = dbQuery("SELECT role,content FROM messages WHERE session_id = ? ORDER BY created_at", [session_id]);
    const messages = [
        { role: "system", content: CFG.system_prompt },
        ...history,
    ];
    reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });
    const streamFn = getStreamFn(modelId);
    let full = "";
    try {
        for await (const chunk of streamFn(messages)) {
            full += chunk;
            reply.raw.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        }
    }
    catch (e) {
        reply.raw.write(`data: ${JSON.stringify({ content: `[Error] ${e.message}` })}\n\n`);
    }
    dbRun("INSERT INTO messages (id,session_id,role,content,model,created_at) VALUES (?,?,?,?,?,?)", [
        crypto_1.default.randomUUID(),
        session_id,
        "assistant",
        full,
        modelId,
        Date.now() / 1000,
    ]);
    const countResult = dbQuery("SELECT COUNT(*) as n FROM messages WHERE session_id = ? AND role = 'user'", [session_id]);
    const n = countResult[0]?.n || 0;
    if (n === 1 && !full.startsWith("\n\n**")) {
        dbRun("UPDATE sessions SET title = ? WHERE id = ?", [
            full.slice(0, 40) + (full.length > 40 ? "…" : ""),
            session_id,
        ]);
    }
    reply.raw.write("data: [DONE]\n\n");
    reply.raw.end();
});
// iMessage Contacts
fastify.get("/api/imessage/contacts", async () => dbQuery("SELECT * FROM imessage_contacts ORDER BY created_at DESC"));
fastify.post("/api/imessage/contacts", async (req) => {
    const { handle_id, name, trigger_mode } = req.body;
    dbRun("INSERT OR REPLACE INTO imessage_contacts (handle_id,name,auto_reply,model,trigger_mode,created_at) VALUES (?,?,?,?,?,?)", [
        handle_id,
        name || "",
        1,
        "mimo",
        trigger_mode || "always",
        Date.now() / 1000,
    ]);
    return { ok: true };
});
fastify.delete("/api/imessage/contacts/:id", async (req) => {
    const { id } = req.params;
    dbRun("DELETE FROM imessage_contacts WHERE handle_id = ?", [id]);
    return { ok: true };
});
// Sleep
let caffeinate = null;
fastify.post("/api/sleep/toggle", async () => {
    const { spawn } = await Promise.resolve().then(() => __importStar(require("child_process")));
    if (caffeinate && !caffeinate.killed) {
        caffeinate.kill();
        caffeinate = null;
        return { preventing: false };
    }
    caffeinate = spawn("caffeinate", ["-i", "-s"], { stdio: "ignore" });
    return { preventing: true };
});
// ── 静态文件 ──
const RENDERER_DIR = path_1.default.join(ROOT, "dist", "renderer");
const isProd = fs_1.default.existsSync(RENDERER_DIR);
if (isProd) {
    fastify.register(static_1.default, { root: RENDERER_DIR, prefix: "/" });
    fastify.setNotFoundHandler((req, reply) => {
        if (req.url.startsWith("/api"))
            reply.code(404).send({ error: "not found" });
        else
            reply.sendFile("index.html");
    });
}
else {
    fastify.get("/", async () => ({
        status: "ok",
        message: "API server running. Open http://localhost:5173 for the UI.",
    }));
}
// ── Start ──
async function startServer() {
    await initDB();
    const port = CFG.port || 18789;
    await fastify.listen({ port, host: "127.0.0.1" });
    console.log(`[Server] API:  http://127.0.0.1:${port}`);
    if (!isProd)
        console.log(`[Server] UI:   http://localhost:5173  ← 打开这个`);
    startPoller();
}
if (require.main === module) {
    startServer().catch(console.error);
}
//# sourceMappingURL=index.js.map