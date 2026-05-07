import { useState, useEffect, useRef } from "react";

interface SetupStatus {
    ollama: boolean;
    ollama_models: { name: string; size: string }[];
    mimo_configured: boolean;
    needs_setup: boolean;
}

const RECOMMENDED_MODELS = [
    { id: "qwen2.5:7b", name: "Qwen 2.5 7B", size: "~4.7 GB", desc: "中文优秀，推荐" },
    { id: "qwen2.5:3b", name: "Qwen 2.5 3B", size: "~2.0 GB", desc: "轻量快速" },
    { id: "llama3.1:8b", name: "Llama 3.1 8B", size: "~4.7 GB", desc: "英文优秀" },
];

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
    const [status, setStatus] = useState<SetupStatus | null>(null);
    const [step, setStep] = useState<"loading" | "choose" | "cloud" | "local" | "pulling" | "done">("loading");
    const [apiKey, setApiKey] = useState("");
    const [pulling, setPulling] = useState("");
    const [pullLog, setPullLog] = useState<string[]>([]);
    const logRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        fetch("/api/setup/status")
            .then(r => r.json())
            .then((s: SetupStatus) => {
                setStatus(s);
                if (!s.needs_setup) {
                    onComplete();
                } else {
                    setStep("choose");
                }
            })
            .catch(() => setStep("choose"));
    }, [onComplete]);

    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [pullLog]);

    const handleCloudSetup = async () => {
        if (!apiKey.trim()) return;
        await fetch("/api/setup/configure-cloud", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: "mimo", api_key: apiKey.trim() }),
        });
        setStep("done");
        setTimeout(onComplete, 1500);
    };

    const handlePullModel = async (modelId: string) => {
        setPulling(modelId);
        setPullLog([]);
        setStep("pulling");

        const resp = await fetch("/api/setup/pull-model", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: modelId }),
        });

        const reader = resp.body!.getReader();
        const dec = new TextDecoder();
        let buf = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() || "";
            for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                try {
                    const p = JSON.parse(line.slice(6));
                    if (p.done) {
                        setPullLog(prev => [...prev, "✅ 下载完成！"]);
                        setStep("done");
                        setTimeout(onComplete, 1500);
                        return;
                    }
                    if (p.error) {
                        setPullLog(prev => [...prev, `❌ 错误: ${p.error}`]);
                        return;
                    }
                    if (p.status) {
                        setPullLog(prev => [...prev, p.status]);
                    }
                } catch { }
            }
        }
    };

    if (step === "loading") {
        return (
            <div className="setup-overlay">
                <div className="setup-card">
                    <div className="setup-spinner" />
                    <p>检测环境中...</p>
                </div>
            </div>
        );
    }

    if (step === "choose") {
        return (
            <div className="setup-overlay">
                <div className="setup-card">
                    <h1 className="setup-logo">甲核<span className="dot">.</span></h1>
                    <h2>欢迎使用</h2>
                    <p className="setup-desc">选择一种方式开始：</p>
                    <div className="setup-options">
                        <button className="setup-opt" onClick={() => setStep("cloud")}>
                            <span className="opt-icon">☁️</span>
                            <span className="opt-title">云端模型</span>
                            <span className="opt-desc">需要 API Key，速度快</span>
                        </button>
                        <button className="setup-opt" onClick={() => setStep("local")}>
                            <span className="opt-icon">🏠</span>
                            <span className="opt-title">本地模型</span>
                            <span className="opt-desc">免费，数据不出设备</span>
                        </button>
                    </div>
                    {status?.ollama && status.ollama_models.length > 0 && (
                        <div className="setup-detected">
                            <p>已检测到 Ollama，已有模型：</p>
                            {status.ollama_models.map(m => (
                                <span key={m.name} className="detected-tag">{m.name} ({m.size})</span>
                            ))}
                            <button className="btn-ok" onClick={onComplete} style={{ marginTop: 12 }}>
                                直接使用已有模型
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    if (step === "cloud") {
        return (
            <div className="setup-overlay">
                <div className="setup-card">
                    <h2>配置云端模型</h2>
                    <p className="setup-desc">填入你的 API Key：</p>
                    <label>API Key</label>
                    <input
                        type="password"
                        value={apiKey}
                        onChange={e => setApiKey(e.target.value)}
                        placeholder="your-api-key-here"
                        autoFocus
                    />
                    <div className="setup-btns">
                        <button className="btn-cancel" onClick={() => setStep("choose")}>返回</button>
                        <button className="btn-ok" onClick={handleCloudSetup} disabled={!apiKey.trim()}>确认</button>
                    </div>
                </div>
            </div>
        );
    }

    if (step === "local") {
        return (
            <div className="setup-overlay">
                <div className="setup-card">
                    <h2>选择本地模型</h2>
                    {!status?.ollama && (
                        <div className="setup-alert">
                            <p>未检测到 Ollama，请先安装：</p>
                            <a href="https://ollama.com/download" target="_blank" rel="noopener" className="setup-link">
                                下载 Ollama →
                            </a>
                            <p className="setup-hint">安装后运行 <code>ollama serve</code>，然后刷新此页面</p>
                        </div>
                    )}
                    {status?.ollama && (
                        <>
                            <p className="setup-desc">选择一个模型下载：</p>
                            <div className="model-list">
                                {RECOMMENDED_MODELS.map(m => (
                                    <button key={m.id} className="model-opt" onClick={() => handlePullModel(m.id)}>
                                        <span className="model-name">{m.name}</span>
                                        <span className="model-size">{m.size}</span>
                                        <span className="model-desc">{m.desc}</span>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                    <div className="setup-btns">
                        <button className="btn-cancel" onClick={() => setStep("choose")}>返回</button>
                    </div>
                </div>
            </div>
        );
    }

    if (step === "pulling") {
        return (
            <div className="setup-overlay">
                <div className="setup-card">
                    <h2>正在下载 {pulling}</h2>
                    <p className="setup-desc">首次下载可能需要几分钟，请耐心等待...</p>
                    <div className="pull-log" ref={logRef}>
                        {pullLog.map((line, i) => <div key={i}>{line}</div>)}
                    </div>
                </div>
            </div>
        );
    }

    if (step === "done") {
        return (
            <div className="setup-overlay">
                <div className="setup-card">
                    <div className="setup-success">✅</div>
                    <h2>配置完成！</h2>
                    <p className="setup-desc">正在进入甲核...</p>
                </div>
            </div>
        );
    }

    return null;
}
