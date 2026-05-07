import type { Msg } from "../core/types";
import { CFG } from "../core/config";

export async function* streamMimo(messages: Msg[]): AsyncGenerator<string> {
    const mc = CFG.models?.mimo;
    if (!mc?.api_key || mc.api_key === "YOUR_MIMO_API_KEY") {
        yield "\n\n**MiMo API Key not configured**";
        return;
    }

    console.log("[MiMo] 发送消息数:", messages.length);

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
        const errBody = await resp.text().catch(() => "");
        console.error(
            `[MiMo] API Error ${resp.status}: ${errBody.slice(0, 200)}`,
        );

        if (
            resp.status === 400 ||
            errBody.includes("high risk") ||
            errBody.includes("sensitive")
        ) {
            // ✅ 从最后一条消息（搜索 prompt）里提取搜索结果，直接展示
            const lastMsg = messages[messages.length - 1]?.content || "";
            const searchMatch = lastMsg.match(
                /搜索结果：\n([\s\S]*?)\n\n用户问题/,
            );
            if (searchMatch) {
                yield "> ⚠️ MiMo 拒绝生成摘要（内容安全），以下是原始搜索结果：\n\n";
                yield searchMatch[1].trim();
            } else {
                yield "\n\n**MiMo 内容安全拦截，无法生成回答。**\n\n";
                yield "可以尝试：\n- 使用 `/ai` 跳过搜索\n- 换个话题提问";
            }
            return;
        }

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

export async function* streamOllama(messages: Msg[]): AsyncGenerator<string> {
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
