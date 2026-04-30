import React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../types";
import { CodeBlock } from "./CodeBlock";

interface Props {
  message: Message;
  isStreaming?: boolean;
}

export function MessageBubble({ message, isStreaming }: Props) {
  const isUser = message.role === "user";
  const isEmpty = !message.content;

  return (
    <div className={`message ${message.role}`}>
      <div className="role">
        {isUser ? "You" : "Assistant"}
        {message.model && <span className="model-badge">{message.model}</span>}
      </div>
      <div className="body">
        {isUser ? (
          message.content
        ) : isEmpty && isStreaming ? (
          <div className="typing"><span /><span /><span /></div>
        ) : (
          <Markdown remarkPlugins={[remarkGfm]} components={{
            pre({ children }: any) {
              const child = React.Children.toArray(children).find(
                (c: any) => React.isValidElement(c) && c.type === "code"
              ) as any;
              if (child?.props?.className?.includes("language-")) {
                const lang = child.props.className.replace("language-", "");
                const code = String(child.props.children).replace(/\n$/, "");
                return <CodeBlock language={lang} code={code} />;
              }
              return <pre>{children}</pre>;
            },
            code({ className, children, ...props }: any) {
              if (!className) return <code {...props}>{children}</code>;
              return <code className={className}>{children}</code>;
            },
          }}>
            {message.content}
          </Markdown>
        )}
      </div>
    </div>
  );
}
