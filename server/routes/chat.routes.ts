import type { FastifyInstance } from "fastify";
import { CFG } from "../core/config";
import { dbQuery, dbRun } from "../core/db";
import { getStreamFn } from "../llm/router";
import { uuid } from "../utils/crypto";
import { now } from "../utils/time";
import {
    detectTopicShift,
    closeTopic,
    createTopic,
    getCurrentTopic,
    extractFacts,
} from "../memory";
import {
    getHistory,
    saveUserMessage,
    saveAssistantMessage,
    updateSessionTime,
    autoTitle,
} from "../chat/session";
import { buildMessages } from "../chat/pipeline";

export function chatRoutes(app: FastifyInstance) {
    app.post("/api/chat", async (req, reply) => {
        const { session_id, message, model, search } = req.body as {
            session_id: string;
            message: string;
            model?: string;
            search?: boolean;
        };
        if (!message?.trim()) return reply.code(400).send({ error: "empty" });

        let userText = message.trim();
        let manualSearch: boolean | undefined = undefined;

        if (userText.startsWith("/s ")) {
            userText = userText.slice(3).trim();
            manualSearch = true;
        } else if (userText.startsWith("/ai ")) {
            userText = userText.slice(4).trim();
            manualSearch = false;
        } else if (search === true) {
            manualSearch = true;
        }

        const modelId = model || CFG.default_model;

        const msgId = saveUserMessage(session_id, userText);
        updateSessionTime(session_id);

        const history = getHistory(session_id);

        reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        });

        const isTopicShift = detectTopicShift(session_id, userText);
        if (isTopicShift) {
            const last = dbQuery(
                "SELECT id FROM messages WHERE session_id = ? AND role = 'user' ORDER BY created_at DESC LIMIT 2",
                [session_id],
            );
            if (last.length > 1) closeTopic(session_id, last[1].id);
            createTopic(session_id, userText.slice(0, 30), msgId);
        } else {
            if (!getCurrentTopic(session_id)) {
                createTopic(session_id, userText.slice(0, 30), msgId);
            }
        }

        const { messages, searched, rawResults } = await buildMessages(
            session_id,
            userText,
            history,
            manualSearch,
        );

        console.log(
            `[Chat] search=${searched} (manual=${manualSearch}) msgs=${messages.length}`,
        );

        // ✅ 搜索模式：先发原始结果，再流式输出 AI
        if (searched && rawResults) {
            reply.raw.write(`data: ${JSON.stringify({ searching: true })}\n\n`);

            // 把原始结果一次性发出去
            reply.raw.write(
                `data: ${JSON.stringify({ content: rawResults + "\n\n---\n\n**AI 总结：**\n\n" })}\n\n`,
            );

            console.log(`[Chat] 已发送原始结果 ${rawResults.length} 字符`);
        }

        const streamFn = getStreamFn(modelId);
        let full = "";
        try {
            for await (const chunk of streamFn(messages)) {
                full += chunk;
                reply.raw.write(
                    `data: ${JSON.stringify({ content: chunk })}\n\n`,
                );
            }
        } catch (e) {
            full = `[Error] ${(e as Error).message}`;
            reply.raw.write(`data: ${JSON.stringify({ content: full })}\n\n`);
        }

        console.log(`[Chat] AI 输出 ${full.length} 字符`);

        saveAssistantMessage(session_id, full, modelId);
        autoTitle(session_id, full);
        reply.raw.write("data: [DONE]\n\n");
        reply.raw.end();
        extractFacts(session_id).catch(() => {});
    });

    app.get("/api/sessions", async () =>
        dbQuery("SELECT * FROM sessions ORDER BY updated_at DESC"),
    );

    app.post("/api/sessions", async (req) => {
        const { model } = req.body as { model?: string };
        const id = uuid();
        const ts = now();
        const m = model || CFG.default_model;
        dbRun(
            "INSERT INTO sessions (id,title,model,source,created_at,updated_at) VALUES (?,?,?,?,?,?)",
            [id, "新对话", m, "web", ts, ts],
        );
        return {
            id,
            title: "新对话",
            model: m,
            source: "web",
            created_at: ts,
            updated_at: ts,
        };
    });

    app.put("/api/sessions/:id", async (req) => {
        const { id } = req.params as { id: string };
        const { title, model } = req.body as { title?: string; model?: string };
        if (title)
            dbRun("UPDATE sessions SET title = ? WHERE id = ?", [title, id]);
        if (model)
            dbRun("UPDATE sessions SET model = ? WHERE id = ?", [model, id]);
        return { ok: true };
    });

    app.delete("/api/sessions/:id", async (req) => {
        const { id } = req.params as { id: string };
        dbRun("DELETE FROM messages WHERE session_id = ?", [id]);
        dbRun("DELETE FROM sessions WHERE id = ?", [id]);
        return { ok: true };
    });

    app.get("/api/sessions/:id/messages", async (req) => {
        const { id } = req.params as { id: string };
        return dbQuery(
            "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at",
            [id],
        );
    });
}
