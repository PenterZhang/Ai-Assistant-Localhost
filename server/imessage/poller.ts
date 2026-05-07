import { CFG } from "../core/config";
import { dbQuery } from "../core/db";
import type { IMContact } from "../core/types";
import * as im from "./client";
import { generateAndSend } from "../chat/generate";

let polling = false;

export function startPoller() {
    if (!CFG.imessage?.enabled || polling) return;
    if (!im.checkAccess()) {
        console.log("[iMessage] chat.db not accessible");
        return;
    }

    polling = true;
    const state = { lastRowId: 0, ready: false };
    const cooldowns: Record<string, number> = {};
    let heartbeat = 0;

    im.getLatestRowId().then((id) => {
        state.lastRowId = id;
        state.ready = true;
        console.log(`[iMessage] polling from ROWID ${id}`);
    });

    async function poll() {
        try {
            if (!state.ready) return;
            heartbeat++;
            if (heartbeat % 10 === 0)
                console.log(
                    `[iMessage] heartbeat OK (ROWID=${state.lastRowId})`,
                );

            const msgs = await im.getNewMessages(state.lastRowId);
            if (msgs.length > 0)
                console.log(`[iMessage] ${msgs.length} new messages`);

            for (const m of msgs) {
                state.lastRowId = Math.max(state.lastRowId, m.rowid);
                if (!m.text.trim()) continue;

                // ── 自己发的消息 ──
                if (m.is_from_me) {
                    const trimmed = m.text.trim();
                    let prompt = "";
                    let searchOverride: boolean | undefined = undefined;

                    if (trimmed.startsWith("/s ")) {
                        prompt = trimmed.slice(3).trim();
                        searchOverride = true;
                    } else if (trimmed.startsWith("/ai ")) {
                        prompt = trimmed.slice(4).trim();
                        searchOverride = false;
                    } else {
                        prompt = trimmed;
                    }

                    if (!prompt) continue;

                    const targetHandle = m.sender;
                    const contacts = dbQuery(
                        "SELECT * FROM imessage_contacts WHERE handle_id = ?",
                        [targetHandle],
                    );
                    const contact = contacts[0] as unknown as
                        | IMContact
                        | undefined;
                    if (!contact) {
                        console.log(
                            `[iMessage] skip: ${targetHandle} not in contacts`,
                        );
                        continue;
                    }

                    console.log(
                        `[iMessage] → ${targetHandle}: ${prompt.slice(0, 50)} (search=${searchOverride ?? "auto"})`,
                    );
                    try {
                        await generateAndSend(
                            targetHandle,
                            prompt,
                            contact,
                            searchOverride,
                        );
                    } catch (e) {
                        console.error(
                            `[iMessage] failed:`,
                            (e as Error).message,
                        );
                    }
                    continue;
                }

                // ── 别人发的消息 ──
                const now = Date.now() / 1000;
                if (now - (cooldowns[m.sender] || 0) < CFG.imessage.cooldown)
                    continue;

                const contacts = dbQuery(
                    "SELECT * FROM imessage_contacts WHERE handle_id = ?",
                    [m.sender],
                );
                const contact = contacts[0] as unknown as IMContact | undefined;
                if (!contact?.auto_reply) continue;

                console.log(
                    `[iMessage] from ${m.sender}: ${m.text.slice(0, 50)}`,
                );

                let text = m.text;
                if (contact.trigger_mode === "prefix:/ai") {
                    if (!text.startsWith("/ai")) continue;
                    text = text.slice(3).trim();
                }

                try {
                    await generateAndSend(m.sender, text, contact);
                    cooldowns[m.sender] = Date.now() / 1000;
                } catch (e) {
                    console.error(
                        "[iMessage] auto reply failed:",
                        (e as Error).message,
                    );
                }
            }
        } catch (e) {
            console.error("[iMessage] poll error:", (e as Error).message);
        }
        setTimeout(poll, CFG.imessage.poll_interval * 1000);
    }

    setTimeout(poll, 1000);
}
