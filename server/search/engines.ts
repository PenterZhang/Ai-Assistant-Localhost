export interface SearchResult {
    title: string;
    snippet: string;
    url: string;
}

function cleanSnippet(text: string): string {
    return text
        .replace(/!$$.*?$$$$.*?$$/g, "")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/<[^>]+>/g, "")
        .replace(/[#*_~`>|]/g, "")
        .replace(/\{[^}]*\}/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200); // ✅ 每条最多200字符，够概括就行
}

function cleanTitle(text: string): string {
    return text
        .replace(/[#*_~`]/g, "")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60);
}

// ✅ 强力去重：标题相似度 > 60% 就认为重复
function deduplicate(results: SearchResult[]): SearchResult[] {
    const unique: SearchResult[] = [];
    for (const r of results) {
        // 过滤垃圾结果
        if (r.snippet.length < 15) continue;
        if (r.title.length < 5) continue;

        // 去重：标题前30字符匹配
        const key = r.title.slice(0, 30).toLowerCase().replace(/\s+/g, "");
        const isDuplicate = unique.some((u) => {
            const existingKey = u.title
                .slice(0, 30)
                .toLowerCase()
                .replace(/\s+/g, "");
            return existingKey === key;
        });
        if (isDuplicate) continue;

        unique.push(r);
    }
    return unique;
}

// Tavily
async function searchTavily(
    query: string,
    maxResults: number,
    apiKey: string,
): Promise<SearchResult[]> {
    try {
        const resp = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                api_key: apiKey,
                query,
                max_results: maxResults,
                include_answer: false,
                include_raw_content: false,
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
        for (const r of data.results || []) {
            const content = cleanSnippet(r.content || "");
            const title = cleanTitle(r.title || "");
            if (content.length < 15) continue;
            results.push({ title, snippet: content, url: r.url || "" });
        }
        console.log(`[Search/Tavily] "${query}" → ${results.length} results`);
        return results;
    } catch (e) {
        console.error("[Search/Tavily]", (e as Error).message);
        return [];
    }
}

// DuckDuckGo
async function searchDuckDuckGo(
    query: string,
    maxResults: number,
): Promise<SearchResult[]> {
    try {
        // ✅ DDG 用简短关键词，中文用 cn 区域
        const shortQuery = query.split(/\s+/).slice(0, 3).join(" ");
        const params = new URLSearchParams({ q: shortQuery, kl: "cn-zh" });
        const resp = await fetch(
            `https://lite.duckduckgo.com/lite/?${params}`,
            {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                },
                signal: AbortSignal.timeout(10000),
            },
        );
        if (!resp.ok) {
            console.error(`[Search/DDG] HTTP ${resp.status}`);
            return [];
        }
        const html = await resp.text();
        const results: SearchResult[] = [];

        const linkRegex =
            /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
        const snippetRegex =
            /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

        const links: { url: string; title: string }[] = [];
        let match;
        while ((match = linkRegex.exec(html)) !== null) {
            links.push({ url: match[1], title: match[2].trim() });
        }
        const snippets: string[] = [];
        while ((match = snippetRegex.exec(html)) !== null) {
            snippets.push(match[1].replace(/<[^>]+>/g, "").trim());
        }

        for (let i = 0; i < Math.min(links.length, maxResults); i++) {
            const content = cleanSnippet(snippets[i] || "");
            const title = cleanTitle(links[i].title);
            if (content.length < 15) continue;
            results.push({ title, snippet: content, url: links[i].url });
        }

        console.log(`[Search/DDG] "${shortQuery}" → ${results.length} results`);
        return results;
    } catch (e) {
        console.error("[Search/DDG]", (e as Error).message);
        return [];
    }
}

// 统一入口
export async function multiSearch(
    query: string,
    maxResults: number,
    tavilyKey?: string,
): Promise<SearchResult[]> {
    const tasks: Promise<SearchResult[]>[] = [];

    if (tavilyKey) {
        tasks.push(searchTavily(query, maxResults, tavilyKey));
    }
    tasks.push(searchDuckDuckGo(query, maxResults));

    const allResults = await Promise.all(tasks);
    const merged = allResults.flat();
    const unique = deduplicate(merged);
    const final = unique.slice(0, maxResults);

    console.log(
        `[Search] 合并: ${merged.length} → 去重: ${unique.length} → 返回: ${final.length}`,
    );
    return final;
}
