import type { FastifyInstance } from "fastify";
import { CFG } from "../core/config";
import { dbQuery, dbRun } from "../core/db";
import { uuid } from "../utils/crypto";
import { now } from "../utils/time";
import { getStreamFn } from "../llm/router";
import * as im from "../imessage/client";

export function imessageRoutes(app: FastifyInstance) {
    app.get("/api/health", async () => {
        const s: Record<string, boolean> = { imessage: im.checkAccess() };
        for (const [key, mc] of Object.entries(CFG.models || {})) {
            try {
                const isOllama = mc.base_url.includes("11434");
                const url = isOllama
                    ? `${mc.base_url}/api/tags`
                    : `${mc.base_url}/models`;
                const headers: Record<string, string> = {};
                if (
                    !isOllama &&
                    mc.api_key &&
                    mc.api_key !== "YOUR_MIMO_API_KEY"
                )
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

    app.get("/api/imessage/diagnose", async () => ({
        issues: await im.diagnose(),
    }));

    app.get("/api/imessage/debug", async () => {
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

    app.post("/api/imessage/test", async (req) => {
        const { handle } = req.body as { handle: string };
        if (!handle) return { error: "handle required" };
        const contacts = dbQuery(
            "SELECT * FROM imessage_contacts WHERE handle_id = ?",
            [handle],
        );
        const contact = contacts[0] as any;
        if (!contact) return { error: "contact not found" };
        try {
            const sid = uuid();
            const ts = now();
            dbRun(
                "INSERT INTO sessions (id,title,model,source,imessage_handle,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
                [
                    sid,
                    `iMessage: ${contact.name || handle}`,
                    contact.model,
                    "imessage",
                    handle,
                    ts,
                    ts,
                ],
            );
            dbRun(
                "INSERT INTO messages (id,session_id,role,content,created_at) VALUES (?,?,?,?,?)",
                [uuid(), sid, "user", "你好，这是一条测试消息", now()],
            );
            const history = dbQuery(
                "SELECT role,content FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 20",
                [sid],
            ).reverse();
            const messages = [
                { role: "system", content: CFG.system_prompt },
                ...history,
            ];
            const streamFn = getStreamFn(contact.model || CFG.default_model);
            let full = "";
            for await (const chunk of streamFn(messages)) full += chunk;
            if (full) {
                dbRun(
                    "INSERT INTO messages (id,session_id,role,content,model,created_at) VALUES (?,?,?,?,?,?)",
                    [uuid(), sid, "assistant", full, contact.model, now()],
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

    app.get("/api/imessage/contacts", async () =>
        dbQuery("SELECT * FROM imessage_contacts ORDER BY created_at DESC"),
    );

    app.post("/api/imessage/contacts", async (req) => {
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
                now(),
            ],
        );
        return { ok: true };
    });

    app.delete("/api/imessage/contacts/:id", async (req) => {
        const { id } = req.params as { id: string };
        dbRun("DELETE FROM imessage_contacts WHERE handle_id = ?", [id]);
        return { ok: true };
    });
}
