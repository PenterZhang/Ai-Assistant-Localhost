import type { Msg, ModelConfig } from "../core/types";
import { CFG } from "../core/config";
import { streamMimo, streamOllama } from "./models";

export function getStreamFn(
    modelId: string,
): (m: Msg[]) => AsyncGenerator<string> {
    const mc = CFG.models?.[modelId];
    if (!mc) return streamMimo;
    if (mc.base_url.includes("11434")) return streamOllama;
    return streamMimo;
}

// ✅ 直接用配置的默认模型，不再优先找 Ollama
export function getDefaultModel(): ModelConfig | undefined {
    return CFG.models[CFG.default_model];
}

export function isOllama(mc: { base_url: string }): boolean {
    return mc.base_url.includes("11434");
}
