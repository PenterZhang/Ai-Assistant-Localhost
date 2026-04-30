import type { Session, IMContact } from "../types";

interface Props {
  sessions: Session[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  contacts: IMContact[];
  onAddContact: () => void;
  onDeleteContact: (handleId: string) => void;
  health: Record<string, boolean>;
  sleepActive: boolean;
  onToggleSleep: () => void;
}

export function Sidebar({
  sessions, currentId, onSelect, onDelete, onNew,
  contacts, onAddContact, onDeleteContact,
  health, sleepActive, onToggleSleep,
}: Props) {
  return (
    <aside id="sidebar">
      <div className="sidebar-head">
        <h1 className="logo">AI<span className="dot">.</span></h1>
        <button id="btn-new" onClick={onNew} title="新对话">+</button>
      </div>

      <div className="sidebar-section">
        <div className="section-label">对话</div>
        <div className="sessions">
          {sessions.map(s => (
            <div key={s.id} className={`si${currentId === s.id ? " on" : ""}`} onClick={() => onSelect(s.id)}>
              <span className="t">{s.title}</span>
              {s.source === "imessage" && <span className="badge-im">iMsg</span>}
              <button className="xd" onClick={e => { e.stopPropagation(); onDelete(s.id); }}>×</button>
            </div>
          ))}
        </div>
      </div>

      <div className="sidebar-section">
        <div className="section-label">iMessage 联系人</div>
        <div className="contacts">
          {contacts.map(c => (
            <div key={c.handle_id} className="ci">
              <span className="t">{c.name || c.handle_id}</span>
              <span className={`badge ${c.auto_reply ? "on" : "off"}`}>{c.auto_reply ? "自动" : "静默"}</span>
              <button className="xd" onClick={() => onDeleteContact(c.handle_id)}>×</button>
            </div>
          ))}
        </div>
        <button className="btn-sm" onClick={onAddContact}>+ 添加联系人</button>
      </div>

      <div className="sidebar-foot">
        <div className="health">
          {Object.entries(health).map(([k, v]) => (
            <span key={k}><i className={`dot-s ${v ? "ok" : "err"}`} />{k}</span>
          ))}
        </div>
        <div className="foot-row">
          <div className="model-tag" />
          <button className={`btn-sleep${sleepActive ? " active" : ""}`} onClick={onToggleSleep} title="阻止系统休眠">☕</button>
        </div>
      </div>
    </aside>
  );
}
