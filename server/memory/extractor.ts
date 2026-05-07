import type { Msg } from "../core/types";
import { dbQuery } from "../core/db";
import { getDefaultModel, isOllama } from "../llm/router";
import { MEMORY_EXTRACT_PROMPT, SUMMARIZE_PROMPT } from "../llm/prompts";
import { storeMemory } from "./store";

export async function extractFacts(sessionId: string): Promise<void> {
    const msgs = dbQuery(
        "SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 10",
        [sessionId],
    ).reverse();

    if (msgs.length < 4) return;

    const mc = getDefaultModel();
    if (!mc) return;

    const conversation = msgs
        .map((m: any) => `${m.role}: ${m.content}`)
        .join("\n");

    let reply = "";
    try {
        if (isOllama(mc)) {
            const resp = await fetch(`${mc.base_url}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: mc.model_id,
                    messages: [
                        {
                            role: "system",
                            content: MEMORY_EXTRACT_PROMPT,
                        },
                        { role: "user", content: conversation },
                    ],
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
                    messages: [
                        {
                            role: "system",
                            content: MEMORY_EXTRACT_PROMPT,
                        },
                        { role: "user", content: conversation },
                    ],
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
        storeMemory(sessionId, keywords, fact);
    }
}

export async function summarizeConversation(messages: Msg[]): Promise<string> {
    const mc = getDefaultModel();
    if (!mc) return "";

    const conversation = messages
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");

    try {
        if (isOllama(mc)) {
            const resp = await fetch(`${mc.base_url}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: mc.model_id,
                    messages: [
                        {
                            role: "system",
                            content: SUMMARIZE_PROMPT,
                        },
                        { role: "user", content: conversation },
                    ],
                    stream: false,
                    options: { temperature: 0, num_predict: 150 },
                }),
                signal: AbortSignal.timeout(15000),
            });
            if (!resp.ok) return "";
            return ((await resp.json()) as any).message?.content || "";
        } else {
            const resp = await fetch(`${mc.base_url}/chat/completions`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${mc.api_key}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: mc.model_id,
                    messages: [
                        {
                            role: "system",
                            content: SUMMARIZE_PROMPT,
                        },
                        { role: "user", content: conversation },
                    ],
                    stream: false,
                    temperature: 0,
                    max_tokens: 150,
                }),
                signal: AbortSignal.timeout(15000),
            });
            if (!resp.ok) return "";
            return (
                ((await resp.json()) as any).choices?.[0]?.message?.content ||
                ""
            );
        }
    } catch {
        return "";
    }
}

