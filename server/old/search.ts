export interface SearchResult {
    title: string;
    snippet: string;
    url: string;
}

export async function webSearch(
    query: string,
    maxResults: number = 5,
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
                include_answer: false, // ✅ 不要 Tavily 自己的答案
                include_raw_content: false, // ✅ 不要原始 HTML
                search_depth: "basic",
            }),
            signal: AbortSignal.timeout(15000),
        });

        if (!resp.ok) {
            const errText = await resp.text();
            console.error(`[Search/Tavily] HTTP ${resp.status}: ${errText}`);
            return [];
        }

        const data = (await resp.json()) as any;
        const results: SearchResult[] = [];

        if (data.results) {
            for (const r of data.results) {
                // ✅ 清理内容：去掉图片链接、HTML 标签、多余空白
                let content = (r.content || "")
                    .replace(/!$$.*?$$$$.*?$$/g, "") // 去 markdown 图片
                    .replace(/https?:\/\/\S+/g, "") // 去 URL
                    .replace(/<[^>]+>/g, "") // 去 HTML 标签
                    .replace(/\s+/g, " ") // 合并空白
                    .trim()
                    .slice(0, 300); // 限制长度

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
