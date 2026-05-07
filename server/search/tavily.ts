export interface SearchResult {
    title: string;
    snippet: string;
    url: string;
}

export async function webSearch(
    query: string,
    maxResults = 10,
    apiKey?: string,
): Promise<SearchResult[]> {
    const key = apiKey || process.env.TAVILY_API_KEY || "";
    if (!key) {
        console.error("[Search] Tavily API Key not configured");
        return [];
    }
    try {
        const resp = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                api_key: key,
                query,
                max_results: maxResults,
                include_answer: false,
                include_raw_content: false,
                // ✅ 改成 advanced 获取更详细的内容
                search_depth: "advanced",
            }),
            signal: AbortSignal.timeout(15000),
        });
        if (!resp.ok) {
            console.error(`[Search/Tavily] HTTP ${resp.status}`);
            return [];
        }
        const data = (await resp.json()) as any;
        const results: SearchResult[] = [];
        if (data.results) {
            for (const r of data.results) {
                let content = (r.content || "")
                    .replace(/!$$.*?$$$$.*?$$/g, "")
                    .replace(/https?:\/\/\S+/g, "")
                    .replace(/<[^>]+>/g, "")
                    .replace(/\s+/g, " ")
                    .trim()
                    // ✅ 300 → 500 字符
                    .slice(0, 500);
                results.push({
                    title: (r.title || "").slice(0, 100),
                    snippet: content,
                    url: r.url || "",
                });
            }
        }
        console.log(`[Search/Tavily] "${query}" → ${results.length} results`);
        return results;
    } catch (e) {
        console.error("[Search/Tavily]", (e as Error).message);
        return [];
    }
}
