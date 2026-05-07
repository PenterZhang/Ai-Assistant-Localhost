import { CodeBlock } from "./CodeBlock";
import type { Message } from "../types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
    message: Message;
    isStreaming?: boolean;
}

export function MessageBubble({ message, isStreaming }: Props) {
    const isUser = message.role === "user";
    const isSearching = (message as any).searching;
    const isEmpty = !message.content && isStreaming;

    return (
        // ✅ msg → message，匹配 CSS
        <div className={`message ${message.role}`}>
            <div className="role">
                {isUser ? "YOU" : "AI"}
                {/* ✅ 显示模型名 */}
                {!isUser && message.model && (
                    <span className="model-badge">{message.model}</span>
                )}
            </div>
            <div className="body">
                {isUser ? (
                    <p>{message.content}</p>
                ) : isEmpty ? (
                    <div className="thinking">
                        <span className="dot-anim" />
                        <span className="dot-anim" />
                        <span className="dot-anim" />
                    </div>
                ) : isSearching ? (
                    <div className="thinking">
                        <span className="search-anim">🔍</span>
                        <span>正在搜索...</span>
                    </div>
                ) : (
                    <>
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                                code({ className, children, ...props }: any) {
                                    const match = /language-(\w+)/.exec(className || "");
                                    const codeStr = String(children).replace(/\n$/, "");
                                    if (match || codeStr.includes("\n")) {
                                        return <CodeBlock language={match?.[1] || ""} code={codeStr} />;
                                    }
                                    return <code className={className} {...props}>{children}</code>;
                                },
                            }}
                        >
                            {message.content}
                        </ReactMarkdown>
                        {isStreaming && <span className="cursor" />}
                    </>
                )}
            </div>
        </div>
    );
}
