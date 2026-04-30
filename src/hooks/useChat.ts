import { useState, useEffect, useCallback, useRef } from "react";
import type { Message } from "../types";
import { api } from "../api";

export function useChat(sessionId: string | null, model: string) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [streaming, setStreaming] = useState(false);
    const streamingRef = useRef(false);

    useEffect(() => {
        if (!sessionId) {
            setMessages([]);
            return;
        }
        if (streamingRef.current) return; // ← 加这一行
        api.messages.list(sessionId).then(setMessages);
    }, [sessionId]);

    // ✅ send 现在接受一个可选的 targetSessionId
    const send = useCallback(
        async (text: string, targetSessionId?: string) => {
            const sid = targetSessionId || sessionId;
            if (!sid || streamingRef.current) return;

            streamingRef.current = true;
            setStreaming(true);

            const userMsg: Message = {
                id: crypto.randomUUID(),
                session_id: sid,
                role: "user",
                content: text,
                model: null,
                created_at: Date.now() / 1000,
            };
            const assistantMsg: Message = {
                id: crypto.randomUUID(),
                session_id: sid,
                role: "assistant",
                content: "",
                model,
                created_at: Date.now() / 1000,
            };
            setMessages((prev) => [...prev, userMsg, assistantMsg]);

            try {
                const resp = await api.chat(sid, text, model);
                const reader = resp.body!.getReader();
                const dec = new TextDecoder();
                let buf = "";
                let full = "";

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buf += dec.decode(value, { stream: true });
                    const lines = buf.split("\n");
                    buf = lines.pop() || "";
                    for (const line of lines) {
                        if (!line.startsWith("data: ")) continue;
                        const d = line.slice(6).trim();
                        if (d === "[DONE]") continue;
                        try {
                            const p = JSON.parse(d);
                            if (p.content) {
                                full += p.content;
                                setMessages((prev) => {
                                    const arr = [...prev];
                                    const last = arr.length - 1;
                                    if (arr[last]?.role === "assistant") {
                                        arr[last] = {
                                            ...arr[last],
                                            content: full,
                                        };
                                    }
                                    return arr;
                                });
                            }
                        } catch {}
                    }
                }
            } catch (e) {
                setMessages((prev) => {
                    const arr = [...prev];
                    const last = arr.length - 1;
                    if (arr[last]?.role === "assistant") {
                        arr[last] = {
                            ...arr[last],
                            content: `[Error] ${(e as Error).message}`,
                        };
                    }
                    return arr;
                });
            } finally {
                streamingRef.current = false;
                setStreaming(false);
            }
        },
        [sessionId, model],
    );

    return { messages, streaming, send, setMessages };
}
