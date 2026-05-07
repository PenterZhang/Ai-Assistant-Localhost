import { useState, useCallback, useEffect } from "react";
import type { Message } from "../types";
import { api } from "../api";

export function useChat(sessionId: string | null, model: string) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [streaming, setStreaming] = useState(false);

    useEffect(() => {
        if (!sessionId) {
            setMessages([]);
            return;
        }
        api.messages
            .list(sessionId)
            .then(setMessages)
            .catch(() => setMessages([]));
    }, [sessionId]);

    const send = useCallback(
        async (text: string, sid?: string, search?: boolean) => {
            const id = sid || sessionId;
            if (!id || !text.trim()) return;

            // ✅ 1. 立即显示用户消息
            const userMsg: Message = {
                id: `user-${Date.now()}`,
                session_id: id,
                role: "user",
                content: text.trim(),
                created_at: Date.now() / 1000,
            };
            setMessages((prev) => [...prev, userMsg]);

            // ✅ 2. 立即显示 AI 思考中状态
            const thinkingMsg: Message = {
                id: `thinking-${Date.now()}`,
                session_id: id,
                role: "assistant",
                content: "",
                created_at: Date.now() / 1000,
                streaming: true,
                searching: !!search,
            } as any;
            setMessages((prev) => [...prev, thinkingMsg]);

            setStreaming(true);

            try {
                const resp = await fetch("/api/chat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        session_id: id,
                        message: text.trim(),
                        model,
                        search: !!search,
                    }),
                });

                const reader = resp.body!.getReader();
                const dec = new TextDecoder();
                let full = "";
                let buf = "";

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buf += dec.decode(value, { stream: true });
                    const lines = buf.split("\n");
                    buf = lines.pop() || "";
                    for (const line of lines) {
                        if (!line.startsWith("data: ")) continue;
                        const d = line.slice(6).trim();
                        if (d === "[DONE]") break;
                        try {
                            const p = JSON.parse(d);

                            // ✅ 3. 收到搜索标记，更新状态
                            if (p.searching) {
                                setMessages((prev) =>
                                    prev.map((m) =>
                                        (m as any).searching
                                            ? { ...m, content: "正在搜索..." }
                                            : m,
                                    ),
                                );
                                continue;
                            }

                            if (p.content) {
                                full += p.content;
                                setMessages((prev) => {
                                    // 找到最后一个 assistant 消息（思考中或正在流式输出的）
                                    const lastIdx = prev.length - 1;
                                    const last = prev[lastIdx];
                                    if (
                                        last?.role === "assistant" &&
                                        (last as any).streaming
                                    ) {
                                        const updated = {
                                            ...last,
                                            content: full,
                                            searching: false,
                                        } as any;
                                        delete updated.searching;
                                        return [...prev.slice(0, -1), updated];
                                    }
                                    return [
                                        ...prev,
                                        {
                                            id: `stream-${Date.now()}`,
                                            role: "assistant",
                                            content: full,
                                            created_at: Date.now() / 1000,
                                            streaming: true,
                                        } as any,
                                    ];
                                });
                            }
                        } catch {}
                    }
                }

                // ✅ 4. 流结束，移除 streaming 标记
                setMessages((prev) =>
                    prev.map((m) => {
                        if ((m as any).streaming) {
                            const updated = { ...m, streaming: false } as any;
                            delete updated.searching;
                            return updated;
                        }
                        return m;
                    }),
                );

                // ✅ 5. 从服务器加载最终消息（持久化数据）
                const final = await api.messages.list(id);
                setMessages(final);
            } catch (e) {
                console.error("[Chat]", e);
                // 错误时移除 thinking 消息
                setMessages((prev) =>
                    prev.filter(
                        (m) => !(m as any).streaming && !(m as any).searching,
                    ),
                );
            } finally {
                setStreaming(false);
            }
        },
        [sessionId, model],
    );

    return { messages, streaming, send };
}
