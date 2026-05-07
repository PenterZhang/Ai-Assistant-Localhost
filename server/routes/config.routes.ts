import type { FastifyInstance } from "fastify";
import { CFG, saveConfig } from "../core/config";
import { webSearch } from "../search";

export function configRoutes(app: FastifyInstance) {
    app.get("/api/config", async () => ({
        models: Object.entries(CFG.models || {}).map(([id, mc]) => ({
            id,
            name: mc.name,
            base_url: mc.base_url,
            model_id: mc.model_id,
            has_key: !!mc.api_key && mc.api_key !== "YOUR_MIMO_API_KEY",
            is_ollama: mc.base_url.includes("11434"),
            temperature: mc.temperature,
            max_tokens: mc.max_tokens,
        })),
        default_model: CFG.default_model,
        system_prompt: CFG.system_prompt,
        imessage: CFG.imessage,
        tavily_configured: !!CFG.tavily_api_key?.trim(),
    }));

    app.post("/api/config", async (req) => {
        const updates = req.body as any;
        if (updates.default_model !== undefined)
            CFG.default_model = updates.default_model;
        if (updates.system_prompt !== undefined)
            CFG.system_prompt = updates.system_prompt;
        if (updates.imessage !== undefined)
            Object.assign(CFG.imessage, updates.imessage);
        saveConfig();
        return { ok: true };
    });

    app.post("/api/config/models", async (req) => {
        const {
            id,
            name,
            base_url,
            api_key,
            model_id,
            temperature,
            max_tokens,
        } = req.body as any;
        if (!id || !model_id || !base_url)
            return { error: "id, model_id, base_url required" };
        CFG.models[id] = {
            name: name || id,
            base_url,
            api_key: api_key || undefined,
            model_id,
            temperature: temperature ?? 0.7,
            max_tokens: max_tokens ?? 4096,
        };
        saveConfig();
        return { ok: true };
    });

    app.delete("/api/config/models/:id", async (req) => {
        const { id } = req.params as { id: string };
        if (Object.keys(CFG.models).length <= 1)
            return { error: "至少保留一个模型" };
        delete CFG.models[id];
        if (CFG.default_model === id)
            CFG.default_model = Object.keys(CFG.models)[0];
        saveConfig();
        return { ok: true };
    });

    app.post("/api/config/test-model", async (req) => {
        const { id } = req.body as { id: string };
        const mc = CFG.models?.[id];
        if (!mc) return { error: "模型不存在" };
        try {
            const isOllama = mc.base_url.includes("11434");
            const url = isOllama
                ? `${mc.base_url}/api/tags`
                : `${mc.base_url}/models`;
            const headers: Record<string, string> = {};
            if (!isOllama && mc.api_key && mc.api_key !== "YOUR_MIMO_API_KEY")
                headers.Authorization = `Bearer ${mc.api_key}`;
            const r = await fetch(url, {
                headers,
                signal: AbortSignal.timeout(5000),
            });
            if (r.ok) return { ok: true, message: "连接成功 ✓" };
            return { ok: false, message: `HTTP ${r.status}` };
        } catch (e) {
            return { ok: false, message: (e as Error).message };
        }
    });

    app.get("/api/config/ollama-models", async () => {
        try {
            const r = await fetch("http://localhost:11434/api/tags", {
                signal: AbortSignal.timeout(3000),
            });
            if (!r.ok) return { models: [] };
            const data = (await r.json()) as any;
            return {
                models: (data.models || []).map((m: any) => ({
                    name: m.name,
                    size: (m.size / 1e9).toFixed(1) + " GB",
                })),
            };
        } catch {
            return { models: [] };
        }
    });

    app.post("/api/config/tavily", async (req) => {
        const { api_key } = req.body as { api_key: string };
        if (!api_key) return { error: "api_key required" };
        CFG.tavily_api_key = api_key;
        saveConfig();
        return { ok: true };
    });

    app.get("/api/config/tavily/test", async () => {
        if (!CFG.tavily_api_key)
            return { ok: false, message: "API Key 未配置" };
        try {
            const results = await webSearch("test", 1, CFG.tavily_api_key);
            if (results.length > 0) return { ok: true, message: "连接成功 ✓" };
            return { ok: false, message: "返回空结果" };
        } catch (e) {
            return { ok: false, message: (e as Error).message };
        }
    });

    app.get("/api/models", async () =>
        Object.entries(CFG.models || {}).map(([id, m]) => ({
            id,
            name: m.name || id,
        })),
    );
}
