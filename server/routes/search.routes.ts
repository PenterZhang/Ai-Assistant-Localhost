import type { FastifyInstance } from "fastify";
import { CFG } from "../core/config";
import { webSearch } from "../search";

export function searchRoutes(app: FastifyInstance) {
    app.post("/api/search", async (req) => {
        const { query } = req.body as { query: string };
        if (!query?.trim()) return { error: "query required" };
        return {
            results: await webSearch(query.trim(), 5, CFG.tavily_api_key),
        };
    });
}
