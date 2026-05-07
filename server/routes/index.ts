import type { FastifyInstance } from "fastify";
import { spawn } from "child_process";
import { CFG, saveConfig } from "../core/config";
import { chatRoutes } from "./chat.routes";
import { configRoutes } from "./config.routes";
import { imessageRoutes } from "./imessage.routes";
import { searchRoutes } from "./search.routes";

export function registerRoutes(app: FastifyInstance) {
    chatRoutes(app);
    configRoutes(app);
    imessageRoutes(app);
    searchRoutes(app);

    // ── Setup API ──

    app.get("/api/setup/status", async () => {
        const status: any = {
            ollama: false,
            ollama_models: [],
            mimo_configured: false,
            needs_setup: true,
        };
        try {
            const r = await fetch("http://localhost:11434/api/tags", {
                signal: AbortSignal.timeout(3000),
            });
            if (r.ok) {
                status.ollama = true;
                const data = (await r.json()) as any;
                status.ollama_models = (data.models || []).map((m: any) => ({
                    name: m.name,
                    size: (m.size / 1e9).toFixed(1) + " GB",
                }));
            }
        } catch {}
        try {
            const mc = CFG.models?.mimo;
            if (mc?.api_key && mc.api_key !== "YOUR_MIMO_API_KEY")
                status.mimo_configured = true;
        } catch {}
        status.needs_setup = !status.ollama && !status.mimo_configured;
        return status;
    });

    app.post("/api/setup/pull-model", async (req, reply) => {
        const { model } = req.body as { model: string };
        if (!model) return reply.code(400).send({ error: "model required" });
        reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        });
        try {
            const resp = await fetch("http://localhost:11434/api/pull", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: model, stream: true }),
            });
            if (!resp.ok) {
                reply.raw.write(
                    `data: ${JSON.stringify({ error: `HTTP ${resp.status}` })}\n\n`,
                );
                reply.raw.end();
                return;
            }
            const dec = new TextDecoder();
            let buf = "";
            for await (const chunk of resp.body!) {
                buf += dec.decode(chunk, { stream: true });
                const lines = buf.split("\n");
                buf = lines.pop() || "";
                for (const line of lines) {
                    if (!line) continue;
                    try {
                        reply.raw.write(
                            `data: ${JSON.stringify(JSON.parse(line))}\n\n`,
                        );
                    } catch {}
                }
            }
            CFG.models.qwen = {
                name: "Qwen (本地)",
                base_url: "http://localhost:11434",
                model_id: model,
                temperature: 0.7,
                max_tokens: 4096,
            };
            CFG.default_model = "qwen";
            saveConfig();
            reply.raw.write(
                `data: ${JSON.stringify({ done: true, model })}\n\n`,
            );
        } catch (e) {
            reply.raw.write(
                `data: ${JSON.stringify({ error: (e as Error).message })}\n\n`,
            );
        }
        reply.raw.end();
    });

    app.post("/api/setup/configure-cloud", async (req) => {
        const { provider, api_key, base_url, model_id } = req.body as {
            provider: string;
            api_key: string;
            base_url?: string;
            model_id?: string;
        };
        if (provider === "mimo") {
            CFG.models.mimo.api_key = api_key;
            if (base_url) CFG.models.mimo.base_url = base_url;
            if (model_id) CFG.models.mimo.model_id = model_id;
            CFG.default_model = "mimo";
        }
        saveConfig();
        return { ok: true };
    });

    // ── Sleep ──

    let sleepPreventing = false;
    let caffeinateProcess: ReturnType<typeof spawn> | null = null;

    app.post("/api/sleep/toggle", async () => {
        if (sleepPreventing && caffeinateProcess) {
            caffeinateProcess.kill();
            caffeinateProcess = null;
            sleepPreventing = false;
            return { preventing: false };
        }
        caffeinateProcess = spawn("caffeinate", ["-i", "-s"], {
            stdio: "ignore",
        });
        sleepPreventing = true;
        caffeinateProcess.on("error", () => {
            sleepPreventing = false;
            caffeinateProcess = null;
        });
        return { preventing: true };
    });
}
