import "../utils/logger"; // ✅ 只需导入，不需要赋值
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import path from "path";
import fs from "fs";
import { ROOT } from "./config";
import { initDB } from "./db";
import { registerRoutes } from "../routes";
import { startPoller } from "../imessage/poller";

const fastify = Fastify({ logger: true });

export { fastify };

export async function startServer() {
    try {
        await initDB();

        const { CFG } = await import("./config");
        const port = CFG.port || 18789;

        registerRoutes(fastify);

        const RENDERER_DIR = path.join(ROOT, "dist", "renderer");
        const isProd = fs.existsSync(RENDERER_DIR);

        if (isProd) {
            fastify.register(fastifyStatic, {
                root: RENDERER_DIR,
                prefix: "/",
            });
            fastify.setNotFoundHandler((req, reply) => {
                if (req.url.startsWith("/api"))
                    reply.code(404).send({ error: "not found" });
                else reply.sendFile("index.html");
            });
        } else {
            fastify.get("/", async () => ({
                status: "ok",
                message: "API server running. Open http://localhost:5173",
            }));
        }

        await fastify.listen({ port, host: "127.0.0.1" });
        console.log(`[Server] API:  http://127.0.0.1:${port}`);
        if (!isProd) console.log(`[Server] UI:   http://localhost:5173`);
        startPoller();
    } catch (err: any) {
        if (err.code === "EADDRINUSE") console.warn(`[Server] port in use`);
        else console.error("[Server] startup failed:", err);
    }
}

if (require.main === module) {
    startServer().catch(console.error);
}
