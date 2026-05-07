import type { Msg } from "../core/types";
import { getDefaultModel, isOllama } from "../llm/router";
import { SEARCH_JUDGE_PROMPT } from "../llm/prompts";

async function callLLM(
    systemPrompt: string,
    userText: string,
    maxTokens: number,
): Promise<string> {
    const mc = getDefaultModel();
    if (!mc) return "";

    const messages: Msg[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
    ];

    try {
        if (isOllama(mc)) {
            const resp = await fetch(`${mc.base_url}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: mc.model_id,
                    messages,
                    stream: false,
                    options: { temperature: 0, num_predict: maxTokens },
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
                    messages,
                    stream: false,
                    temperature: 0,
                    max_tokens: maxTokens + 1000,
                }),
                signal: AbortSignal.timeout(15000),
            });
            if (!resp.ok) return "";
            const data = (await resp.json()) as any;
            const msg = data.choices?.[0]?.message;
            const content = msg?.content || "";
            const reasoning = msg?.reasoning_content || "";

            if (content) return content;
            if (reasoning) {
                const lines = reasoning
                    .split("\n")
                    .filter((l: string) => l.trim());
                const lastLine = lines[lines.length - 1] || "";
                const cleaned = lastLine
                    .replace(/.*[：:]/, "")
                    .replace(/^["'"']|["'"']$/g, "")
                    .trim();
                if (cleaned && cleaned.length < 50) return cleaned;
            }
            return "";
        }
    } catch (e) {
        console.error("[LLM Call] error:", (e as Error).message);
        return "";
    }
}

export async function aiShouldSearch(query: string): Promise<boolean> {
    const raw = await callLLM(SEARCH_JUDGE_PROMPT, query, 20);
    const reply = raw.trim().toUpperCase();
    const needSearch =
        reply.includes("YES") || reply.includes("是") || reply.includes("需要");
    console.log(
        `[AI Judge] "${query.slice(0, 40)}" → "${reply}" → ${needSearch ? "搜索" : "不搜索"}`,
    );
    return needSearch;
}

// ✅ 搜索词改写：用规则而不是 LLM（省 5 秒）
export function rewriteQuery(query: string): string {
    // 去掉口语化前缀
    let q = query
        .replace(/^(帮我|请|能不能|给我|查一下|搜一下|看看|找找)\s*/g, "")
        .replace(/[？?！!。.，,~～]+$/g, "")
        .trim();

    // 限制长度
    if (q.length > 20) {
        // 提取核心名词
        const words = q.split(/[\s，,、]+/).filter((w) => w.length > 1);
        q = words.slice(0, 4).join(" ");
    }

    console.log(`[Query Rewrite] "${query}" → "${q}"`);
    return q || query;
}
