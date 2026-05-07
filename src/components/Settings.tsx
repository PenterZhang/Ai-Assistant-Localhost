import { useState, useEffect } from "react";

interface ModelInfo {
    id: string;
    name: string;
    base_url: string;
    model_id: string;
    has_key: boolean;
    is_ollama: boolean;
    temperature: number;
    max_tokens: number;
}

interface ConfigData {
    models: ModelInfo[];
    default_model: string;
    system_prompt: string;
    imessage: { enabled: boolean; poll_interval: number; cooldown: number };
    tavily_configured: boolean;
}

interface Props {
    onClose: () => void;
    onConfigChanged: () => void;
}

export function Settings({ onClose, onConfigChanged }: Props) {
    const [config, setConfig] = useState<ConfigData | null>(null);
    const [tab, setTab] = useState<"models" | "prompt" | "imessage" | "tavily">("models");
    const [adding, setAdding] = useState(false);
    const [newModel, setNewModel] = useState({
        id: "", name: "", base_url: "http://localhost:11434",
        api_key: "", model_id: "", temperature: 0.7, max_tokens: 4096,
    });
    const [testResult, setTestResult] = useState<Record<string, string>>({});
    const [tavilyKey, setTavilyKey] = useState("");
    const [tavilyTestResult, setTavilyTestResult] = useState("");

    useEffect(() => { loadConfig(); }, []);

    const loadConfig = async () => {
        const r = await fetch("/api/config");
        setConfig(await r.json());
    };

    const handleTest = async (id: string) => {
        setTestResult(prev => ({ ...prev, [id]: "测试中..." }));
        const r = await fetch("/api/config/test-model", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
        });
        const d = await r.json();
        setTestResult(prev => ({ ...prev, [id]: d.message }));
    };

    const handleDelete = async (id: string) => {
        if (!confirm(`确定删除模型 ${id}？`)) return;
        await fetch(`/api/config/models/${id}`, { method: "DELETE" });
        await loadConfig();
        onConfigChanged();
    };

    const handleSetDefault = async (id: string) => {
        await fetch("/api/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ default_model: id }),
        });
        await loadConfig();
        onConfigChanged();
    };

    const handleAddCustom = async () => {
        if (!newModel.id || !newModel.model_id || !newModel.base_url) return;
        await fetch("/api/config/models", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(newModel),
        });
        setAdding(false);
        setNewModel({ id: "", name: "", base_url: "http://localhost:11434", api_key: "", model_id: "", temperature: 0.7, max_tokens: 4096 });
        await loadConfig();
        onConfigChanged();
    };

    const handleSavePrompt = async () => {
        if (!config) return;
        await fetch("/api/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ system_prompt: config.system_prompt }),
        });
        onConfigChanged();
    };

    const handleSaveIMessage = async () => {
        if (!config) return;
        await fetch("/api/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imessage: config.imessage }),
        });
        onConfigChanged();
    };

    if (!config) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="settings-panel" onClick={e => e.stopPropagation()}>
                <div className="settings-header">
                    <h2>⚙️ 设置</h2>
                    <button className="xd" onClick={onClose}>×</button>
                </div>

                <div className="settings-tabs">
                    <button className={tab === "models" ? "active" : ""} onClick={() => setTab("models")}>模型管理</button>
                    <button className={tab === "prompt" ? "active" : ""} onClick={() => setTab("prompt")}>系统提示词</button>
                    <button className={tab === "imessage" ? "active" : ""} onClick={() => setTab("imessage")}>iMessage</button>
                    <button className={tab === "tavily" ? "active" : ""} onClick={() => setTab("tavily")}>搜索</button>
                </div>

                <div className="settings-body">
                    {/* ── 模型管理 ── */}
                    {tab === "models" && (
                        <div>
                            <div className="section-title">已配置模型</div>
                            {config.models.map(m => (
                                <div key={m.id} className="model-card">
                                    <div className="model-card-head">
                                        <span className="model-card-name">
                                            {m.name}
                                            {config.default_model === m.id && <span className="default-tag">默认</span>}
                                        </span>
                                        <span className="model-card-id">{m.model_id}</span>
                                    </div>
                                    <div className="model-card-info">
                                        {m.is_ollama ? "🏠 本地 (Ollama)" : "☁️ 云端"}
                                        {m.has_key ? " · Key ✓" : ""}
                                    </div>
                                    <div className="model-card-actions">
                                        <button onClick={() => handleTest(m.id)}>{testResult[m.id] || "🔍 测试"}</button>
                                        {config.default_model !== m.id && <button onClick={() => handleSetDefault(m.id)}>设为默认</button>}
                                        {config.default_model !== m.id && <button className="danger" onClick={() => handleDelete(m.id)}>删除</button>}
                                    </div>
                                </div>
                            ))}

                            {!adding ? (
                                <button className="btn-sm" style={{ marginTop: 16 }} onClick={() => setAdding(true)}>+ 手动添加模型</button>
                            ) : (
                                <div className="add-model-form">
                                    <div className="section-title" style={{ marginTop: 16 }}>添加模型</div>
                                    <div className="form-row">
                                        <label>标识 (英文)</label>
                                        <input value={newModel.id} onChange={e => setNewModel({ ...newModel, id: e.target.value })} placeholder="my-model" />
                                    </div>
                                    <div className="form-row">
                                        <label>显示名</label>
                                        <input value={newModel.name} onChange={e => setNewModel({ ...newModel, name: e.target.value })} placeholder="我的模型" />
                                    </div>
                                    <div className="form-row">
                                        <label>API 地址</label>
                                        <input value={newModel.base_url} onChange={e => setNewModel({ ...newModel, base_url: e.target.value })} placeholder="http://localhost:11434" />
                                    </div>
                                    <div className="form-row">
                                        <label>模型 ID</label>
                                        <input value={newModel.model_id} onChange={e => setNewModel({ ...newModel, model_id: e.target.value })} placeholder="qwen2.5:7b" />
                                    </div>
                                    <div className="form-row">
                                        <label>API Key（可选）</label>
                                        <input value={newModel.api_key} onChange={e => setNewModel({ ...newModel, api_key: e.target.value })} placeholder="留空表示不需要" type="password" />
                                    </div>
                                    <div className="form-row-inline">
                                        <div className="form-row">
                                            <label>Temperature</label>
                                            <input type="number" step="0.1" min="0" max="2" value={newModel.temperature} onChange={e => setNewModel({ ...newModel, temperature: parseFloat(e.target.value) })} />
                                        </div>
                                        <div className="form-row">
                                            <label>Max Tokens</label>
                                            <input type="number" step="256" min="256" value={newModel.max_tokens} onChange={e => setNewModel({ ...newModel, max_tokens: parseInt(e.target.value) })} />
                                        </div>
                                    </div>
                                    <div className="form-btns">
                                        <button className="btn-cancel" onClick={() => setAdding(false)}>取消</button>
                                        <button className="btn-ok" onClick={handleAddCustom}>添加</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── 系统提示词 ── */}
                    {tab === "prompt" && (
                        <div>
                            <div className="section-title">系统提示词</div>
                            <p className="section-desc">定义 AI 的行为方式，所有对话都会带上这段提示。</p>
                            <textarea
                                className="prompt-textarea"
                                value={config.system_prompt}
                                onChange={e => setConfig({ ...config, system_prompt: e.target.value })}
                                rows={10}
                            />
                            <div className="form-btns">
                                <button className="btn-ok" onClick={handleSavePrompt}>保存</button>
                            </div>
                        </div>
                    )}

                    {/* ── iMessage ── */}
                    {tab === "imessage" && (
                        <div>
                            <div className="section-title">iMessage 设置</div>
                            <div className="toggle-row">
                                <span>启用 iMessage</span>
                                <button
                                    className={`toggle-btn ${config.imessage.enabled ? "on" : ""}`}
                                    onClick={() => setConfig({ ...config, imessage: { ...config.imessage, enabled: !config.imessage.enabled } })}
                                >
                                    {config.imessage.enabled ? "ON" : "OFF"}
                                </button>
                            </div>
                            <div className="form-row">
                                <label>轮询间隔（秒）</label>
                                <input type="number" min="1" value={config.imessage.poll_interval}
                                    onChange={e => setConfig({ ...config, imessage: { ...config.imessage, poll_interval: parseInt(e.target.value) || 3 } })} />
                            </div>
                            <div className="form-row">
                                <label>回复冷却（秒）</label>
                                <input type="number" min="0" value={config.imessage.cooldown}
                                    onChange={e => setConfig({ ...config, imessage: { ...config.imessage, cooldown: parseInt(e.target.value) || 5 } })} />
                            </div>
                            <div className="form-btns">
                                <button className="btn-ok" onClick={handleSaveIMessage}>保存</button>
                            </div>
                        </div>
                    )}

                    {/* ── Tavily 搜索 ── */}
                    {tab === "tavily" && (
                        <div>
                            <div className="section-title">联网搜索</div>
                            <p className="section-desc">使用 Tavily API 提供联网搜索能力。去 <a href="https://tavily.com" target="_blank" rel="noopener" style={{ color: "var(--accent)" }}>tavily.com</a> 注册获取 API Key。</p>
                            {config.tavily_configured && (
                                <div className="model-card" style={{ marginBottom: 16 }}>
                                    <div className="model-card-info" style={{ color: "var(--ok)" }}>✅ Tavily API Key 已配置</div>
                                </div>
                            )}
                            <div className="form-row">
                                <label>Tavily API Key</label>
                                <input
                                    type="password"
                                    value={tavilyKey}
                                    onChange={e => setTavilyKey(e.target.value)}
                                    placeholder="tvly-xxxxxxxxxx"
                                />
                            </div>
                            <div className="form-btns">
                                <button onClick={async () => {
                                    setTavilyTestResult("测试中...");
                                    const r = await fetch("/api/config/tavily/test");
                                    const d = await r.json();
                                    setTavilyTestResult(d.message);
                                }}>
                                    {tavilyTestResult || "🔍 测试连接"}
                                </button>
                                <button className="btn-ok" onClick={async () => {
                                    await fetch("/api/config/tavily", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ api_key: tavilyKey }),
                                    });
                                    await loadConfig();
                                    setTavilyTestResult("");
                                    alert("保存成功");
                                }}>
                                    保存
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
