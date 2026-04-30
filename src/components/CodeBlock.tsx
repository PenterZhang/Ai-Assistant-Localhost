import { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface Props {
  language: string;
  code: string;
}

export function CodeBlock({ language, code }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-block">
      <div className="code-header">
        <span>{language}</span>
        <button onClick={copy}>{copied ? "Copied!" : "Copy"}</button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{ margin: 0, borderRadius: "0 0 var(--r) var(--r)", background: "var(--bg)", fontSize: "12.5px" }}
        codeTagProps={{ style: { fontFamily: "var(--mono)", lineHeight: "1.6" } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
