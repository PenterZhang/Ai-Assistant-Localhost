import { useState, useEffect, useCallback } from "react";
import type { IMContact } from "../types";
import { api } from "../api";

export function useIMessage() {
  const [contacts, setContacts] = useState<IMContact[]>([]);

  const reload = useCallback(async () => {
    try { setContacts(await api.contacts.list()); } catch { setContacts([]); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const add = useCallback(async (data: { handle_id: string; name?: string; trigger_mode?: string }) => {
    await api.contacts.add(data);
    await reload();
  }, [reload]);

  const remove = useCallback(async (handleId: string) => {
    await api.contacts.delete(handleId);
    await reload();
  }, [reload]);

  return { contacts, add, remove, reload };
}
