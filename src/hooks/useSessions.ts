import { useState, useEffect, useCallback } from "react";
import type { Session } from "../types";
import { api } from "../api";

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const list = await api.sessions.list();
    setSessions(list);
    return list;
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const create = useCallback(async (model: string) => {
    const s = await api.sessions.create(model);
    const list = await reload();
    setCurrentId(s.id);
    return s;
  }, [reload]);

  const select = useCallback((id: string) => setCurrentId(id), []);

  const remove = useCallback(async (id: string) => {
    await api.sessions.delete(id);
    if (currentId === id) setCurrentId(null);
    await reload();
  }, [currentId, reload]);

  const update = useCallback(async (id: string, data: Partial<Session>) => {
    await api.sessions.update(id, data);
    await reload();
  }, [reload]);

  return { sessions, currentId, create, select, remove, update, reload };
}
