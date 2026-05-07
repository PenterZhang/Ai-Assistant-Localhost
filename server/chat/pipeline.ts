import type { Msg } from "../core/types";
import { CFG } from "../core/config";
import { decideAndSearch, buildSearchPrompt } from "../search";
import {
    queryMemories,
    getCurrentTopic,
    getTopicContext,
    getRecentTopicsSummary,
    summarizeConversation,
} from "../memory";

export interface BuildResult {
    messages: Msg[];
    searched: boolean;
    rawResults?: string;
}

export async function buildMessages(
    sessionId: string,
    userText: string,
    history: any[],
    search?: boolean,
): Promise<BuildResult> {
    const messages: Msg[] = [{ role: "system", content: CFG.system_prompt }];

    const memories = queryMemories(userText);
    if (memories.length > 0) {
        messages.push({
            role: "system",
            content: `关于用户的已知信息：\n${memories.map((f) => `- ${f}`).join("\n")}`,
        });
    }

    const recentTopics = getRecentTopicsSummary(sessionId);
    if (recentTopics) {
        messages.push({
            role: "system",
            content: `之前的对话话题：\n${recentTopics}`,
        });
    }

    const ctx = await decideAndSearch(userText, search);

    if (ctx) {
        const currentTopicId = getCurrentTopic(sessionId);
        let topicHistory = currentTopicId
            ? getTopicContext(sessionId, currentTopicId)
            : history;
        if (topicHistory.length === 0) topicHistory = history;
        topicHistory = topicHistory.slice(0, -1);
        topicHistory =
            topicHistory.length > 10 ? topicHistory.slice(-10) : topicHistory;
        messages.push(...(topicHistory as unknown as Msg[]));

        // ✅ 用原来的 buildSearchPrompt，不改 AI 的 prompt
        messages.push({
            role: "user",
            content: buildSearchPrompt(userText, ctx),
        });

        return { messages, searched: true, rawResults: ctx };
    }

    const currentTopicId = getCurrentTopic(sessionId);
    let topicHistory = currentTopicId
        ? getTopicContext(sessionId, currentTopicId)
        : history;
    if (topicHistory.length === 0) topicHistory = history;

    if (topicHistory.length > 30) {
        const old = topicHistory.slice(0, -30);
        const recent = topicHistory.slice(-30);
        const summary = await summarizeConversation(old as unknown as Msg[]);
        if (summary) {
            messages.push({
                role: "system",
                content: `当前话题之前的讨论摘要：${summary}`,
            });
        }
        messages.push(...(recent as unknown as Msg[]));
    } else {
        messages.push(...(topicHistory as unknown as Msg[]));
    }

    return { messages, searched: false };
}
