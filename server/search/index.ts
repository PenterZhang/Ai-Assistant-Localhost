import { CFG } from "../core/config";
import { multiSearch, type SearchResult } from "./engines";
import { aiShouldSearch, rewriteQuery } from "./engine";

export { buildSearchPrompt } from "../llm/prompts";

export async function webSearch(
    query: string,
    maxResults = 5,
    apiKey?: string,
): Promise<SearchResult[]> {
    return multiSearch(query, maxResults, apiKey);
}

async function doSearch(query: string): Promise<string | null> {
    const rewritten = await rewriteQuery(query);
    console.log(`[Search] 搜索: "${rewritten}"`);

    const results = await multiSearch(rewritten, 10, CFG.tavily_api_key);
    console.log(`[Search] 返回 ${results.length} 条结果`);
    if (results.length === 0) return null;

    // ✅ 精简格式：编号 + 标题 + 简短描述
    const context = results
        .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}`)
        .join("\n\n");

    console.log(`[Search] 上下文长度: ${context.length} 字符`);
    return context;
}

export async function decideAndSearch(
    query: string,
    manual?: boolean,
): Promise<string | null> {
    console.log(`[Decide] query="${query.slice(0, 30)}" manual=${manual}`);

    if (query.startsWith("/s ")) {
        query = query.slice(3).trim();
        manual = true;
    } else if (query.startsWith("/ai ")) {
        query = query.slice(4).trim();
        manual = false;
    }

    if (manual === true) {
        console.log(`[Search] 手动触发`);
        return await doSearch(query);
    }
    if (manual === false) {
        return null;
    }

    const needSearch = await aiShouldSearch(query);
    console.log(`[Decide] aiShouldSearch: ${needSearch}`);
    if (!needSearch) return null;
    return await doSearch(query);
}
