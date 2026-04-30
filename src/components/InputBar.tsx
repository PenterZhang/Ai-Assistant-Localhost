import { useRef, useCallback } from "react";

interface Props {
  onSend: (text: string) => void;
  disabled: boolean;
}

export function InputBar({ onSend, disabled }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const text = ref.current?.value.trim();
    if (!text || disabled) return;
    if (ref.current) { ref.current.value = ""; ref.current.style.height = "auto"; }
    onSend(text);
  }, [onSend, disabled]);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const handleInput = useCallback(() => {
    const el = ref.current;
    if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 200) + "px"; }
  }, []);

  return (
    <div className="input-bar">
      <div className="input-wrap">
        <textarea
          ref={ref}
          placeholder="输入消息… (⌘ Enter 发送)"
          rows={1}
          onKeyDown={handleKey}
          onInput={handleInput}
          disabled={disabled}
        />
        <button onClick={handleSend} disabled={disabled} title="发送">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
      </div>
      <div className="input-hint muted">Enter 换行 · ⌘ Enter 发送</div>
    </div>
  );
}
