import { useRef, useEffect } from "react";
import type { Message } from "../types";
import { MessageBubble } from "./MessageBubble";
import { InputBar } from "./InputBar";

interface Props {
    title: string;
    messages: Message[];
    streaming: boolean;
    model: string;
    onModelChange: (m: string) => void;
    onSend: (text: string) => void;
    onMenuToggle: () => void;
}

export function ChatArea({ title, messages, streaming, model, onModelChange, onSend, onMenuToggle }: Props) {
    const msgsRef = useRef<HTMLDivElement>(null);
    const autoScroll = useRef(true);

    const handleScroll = () => {
        const el = msgsRef.current;
        if (!el) return;
        autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    };

    useEffect(() => {
        if (autoScroll.current && msgsRef.current) {
            msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
        }
    }, [messages]);

    return (
        <main id="main">
            <header id="header">
                <div className="h-left">
                    <button className="icon-btn" onClick={onMenuToggle}>☰</button>
                    <h2 id="title">{title}</h2>
                </div>
                <div className="h-right">
                    <div className="switcher">
                        {(["mimo", "qwen"] as const).map(m => (
                            <button
                                key={m}
                                className={`sw${model === m ? " on" : ""}`}
                                onClick={() => onModelChange(m)}
                            >
                                {m === "mimo" ? "MiMo" : "Qwen"}
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            <div className="msgs" ref={msgsRef} onScroll={handleScroll}>
                {messages.length === 0 ? (
                    <div className="empty">
                        <div className="empty-icon">🦞</div>
                        <p>开始新的对话</p>
                        <span className="muted">选择模型，输入你的问题</span>
                    </div>
                ) : (
                    messages.map(m => (
                        <MessageBubble
                            key={m.id}
                            message={m}
                            isStreaming={streaming && m.role === "assistant" && m === messages[messages.length - 1]}
                        />
                    ))
                )}
            </div>

            <InputBar onSend={onSend} disabled={streaming} />
        </main>
    );
}
