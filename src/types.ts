export interface Session {
  id: string;
  title: string;
  model: string;
  source: string;
  imessage_handle: string | null;
  created_at: number;
  updated_at: number;
}

export interface Message {
  id: string;
  session_id: string;
  role: "system" | "user" | "assistant";
  content: string;
  model: string | null;
  created_at: number;
}

export interface IMContact {
  handle_id: string;
  name: string;
  auto_reply: number;
  model: string;
  trigger_mode: string;
  created_at: number;
}

export interface ModelInfo {
  id: string;
  name: string;
}
