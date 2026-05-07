export interface ModelConfig {
    name: string;
    base_url: string;
    api_key?: string;
    model_id: string;
    temperature?: number;
    max_tokens?: number;
}

export interface AppConfig {
    port: number;
    default_model: string;
    system_prompt: string;
    tavily_api_key?: string;
    models: Record<string, ModelConfig>;
    imessage: { enabled: boolean; poll_interval: number; cooldown: number };
}

export interface IMContact {
    handle_id: string;
    name: string;
    auto_reply: number;
    model: string;
    trigger_mode: string;
    created_at: number;
}

export type Msg = { role: string; content: string };

export interface AppConfig {
    port: number;
    default_model: string;
    system_prompt: string;
    tavily_api_key?: string;
    bing_api_key?: string; // ✅ 新增
    models: Record<string, ModelConfig>;
    imessage: { enabled: boolean; poll_interval: number; cooldown: number };
}
