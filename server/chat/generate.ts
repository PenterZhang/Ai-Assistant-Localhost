import type { IMContact } from "../core/types";
import { getStreamFn } from "../llm/router";
import { extractFacts } from "../memory";
import {
    findOrCreateIMSession,
    getHistoryDesc,
    saveUserMessage,
    saveAssistantMessage,
} from "./session";
import { buildMessages } from "./pipeline";
import * as im from "../imessage/client";

// ✅ 去掉 markdown 格式，变成纯文本
function stripMarkdown(text: string): string {
    return (
        text
            // 标题：### xxx → xxx
            .replace(/^#{1,6}\s+/gm, "")
            // 粗体：**xxx** → xxx
            .replace(/\*\*(.*?)\*\*/g, "$1")
            // 斜体：*xxx* → xxx
            .replace(/\*(.*?)\*/g, "$1")
            // 行内代码：`xxx` → xxx
            .replace(/`([^`]+)`/g, "$1")
            // 代码块：```xxx``` → xxx
            .replace(/```[\w]*\n?([\s\S]*?)```/g, "$1")
            // 链接：[text](url) → text
            .replace(/$$([^$$]+)\]$$[^)]+$$/g, "$1")
            // 图片：![alt](url) → (图片)
            .replace(/!$$([^$$]*)\]$$[^)]+$$/g, "（图片）")
            // 引用：> xxx → xxx
            .replace(/^>\s+/gm, "")
            // 分隔线
            .replace(/^[-*_]{3,}\s*$/gm, "")
            // 无序列表：- xxx → • xxx
            .replace(/^[-*+]\s+/gm, "• ")
            // 有序列表保留
            .replace(/^(\d+)\.\s+/gm, "$1. ")
            // 多余空行
            .replace(/\n{3,}/g, "\n\n")
            .trim()
    );
}

export async function generateAndSend(
    targetHandle: string,
    userText: string,
    contact: IMContact,
    search?: boolean,
): Promise<boolean> {
    const sid = findOrCreateIMSession(
        targetHandle,
        contact.name,
        contact.model,
    );

    saveUserMessage(sid, userText);

    const history = getHistoryDesc(sid, 20);
    const { messages } = await buildMessages(sid, userText, history, search);

    const streamFn = getStreamFn(contact.model);
    let full = "";
    for await (const chunk of streamFn(messages)) full += chunk;

    if (!full || full.startsWith("\n\n**")) {
        console.error(`[iMessage] AI error: ${full.slice(0, 100)}`);
        return false;
    }

    saveAssistantMessage(sid, full, contact.model);

    // ✅ iMessage 发送前去掉 markdown
    const plainText = stripMarkdown(full);
    const sent = im.sendMessage(targetHandle, plainText);
    if (sent) console.log(`[iMessage] replied: ${plainText.slice(0, 50)}`);

    extractFacts(sid).catch(() => {});
    return sent;
}
