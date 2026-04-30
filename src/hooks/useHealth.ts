import { useState, useEffect } from "react";
import { api } from "../api";

export function useHealth(intervalMs = 30_000) {
  const [health, setHealth] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const check = async () => {
      try { setHealth(await api.health()); }
      catch { setHealth({ mimo: false, deepseek: false, imessage: false }); }
    };
    check();
    const id = setInterval(check, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return health;
}
