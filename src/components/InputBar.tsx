import { useState, useRef, useEffect } from "react";

interface Props {
    onSend: (text: string, search?: boolean) => void;
    streaming: boolean;
}

export function InputBar({ onSend, streaming }: Props) {
    const [text, setText] = useState("");
    const [searchMode, setSearchMode] = useState(false);
    const ref = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (!streaming && ref.current) ref.current.focus();
    }, [streaming]);

    const handleSend = () => {
        if (!text.trim() || streaming) return;
        console.log("[InputBar] sending, search =", searchMode);  // ✅ 调试日志
        onSend(text.trim(), searchMode);
        setText("");
        setSearchMode(false);
    };

    return (
        <div className="input-bar">
            <button
                className={`search-toggle${searchMode ? " on" : ""}`}
                onClick={() => setSearchMode(!searchMode)}
                title={searchMode ? "联网搜索：开（点击关闭）" : "联网搜索：关（点击开启）"}
            >
                🌐
            </button>
            <textarea
                ref={ref}
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                    }
                }}
                placeholder={searchMode ? "联网搜索中提问..." : "输入消息..."}
                disabled={streaming}
                rows={1}
            />
            <button
                className="btn-send"
                onClick={handleSend}
                disabled={streaming || !text.trim()}
            >
                {streaming ? "..." : searchMode ? "搜索" : "发送"}
            </button>
        </div>
    );
}
