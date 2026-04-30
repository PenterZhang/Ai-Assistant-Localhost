import { useState, useCallback } from "react";

interface Props {
  onAdd: (data: { handle_id: string; name?: string; trigger_mode: string }) => void;
  onClose: () => void;
}

export function AddContactModal({ onAdd, onClose }: Props) {
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("always");

  const submit = useCallback(() => {
    if (!handle.trim()) return;
    onAdd({ handle_id: handle.trim(), name: name.trim() || undefined, trigger_mode: trigger });
  }, [handle, name, trigger, onAdd]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>添加 iMessage 联系人</h3>
        <label>手机号或邮箱</label>
        <input value={handle} onChange={e => setHandle(e.target.value)} placeholder="+8613800138000 或 user@icloud.com" autoFocus />
        <label>备注名</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="张三" />
        <label>触发方式</label>
        <select value={trigger} onChange={e => setTrigger(e.target.value)}>
          <option value="always">所有消息自动回复</option>
          <option value="prefix:/ai">以 /ai 开头才回复</option>
        </select>
        <div className="modal-btns">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-ok" onClick={submit}>添加</button>
        </div>
      </div>
    </div>
  );
}
