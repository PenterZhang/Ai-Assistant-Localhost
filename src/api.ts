import type { Session, Message, IMContact, ModelInfo } from "./types";

const json = { "Content-Type": "application/json" };

export const api = {
  health: () => fetch("/api/health").then<Record<string, boolean>>(r => r.json()),
  models: () => fetch("/api/models").then<ModelInfo[]>(r => r.json()),

  sessions: {
    list: () => fetch("/api/sessions").then<Session[]>(r => r.json()),
    create: (model: string) =>
      fetch("/api/sessions", { method: "POST", headers: json, body: JSON.stringify({ model }) }).then<Session>(r => r.json()),
    update: (id: string, data: Partial<Session>) =>
      fetch(`/api/sessions/${id}`, { method: "PUT", headers: json, body: JSON.stringify(data) }),
    delete: (id: string) => fetch(`/api/sessions/${id}`, { method: "DELETE" }),
  },

  messages: {
    list: (sessionId: string) =>
      fetch(`/api/sessions/${sessionId}/messages`).then<Message[]>(r => r.json()),
  },

  chat: (sessionId: string, message: string, model: string) =>
    fetch("/api/chat", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ session_id: sessionId, message, model }),
    }),

  contacts: {
    list: () => fetch("/api/imessage/contacts").then<IMContact[]>(r => r.json()),
    add: (data: { handle_id: string; name?: string; trigger_mode?: string }) =>
      fetch("/api/imessage/contacts", { method: "POST", headers: json, body: JSON.stringify(data) }),
    delete: (handleId: string) =>
      fetch(`/api/imessage/contacts/${encodeURIComponent(handleId)}`, { method: "DELETE" }),
  },

  sleep: {
    toggle: () => fetch("/api/sleep/toggle", { method: "POST" }).then<{ preventing: boolean }>(r => r.json()),
  },
};
