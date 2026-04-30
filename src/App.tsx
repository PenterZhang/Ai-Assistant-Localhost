import { useState, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatArea } from "./components/ChatArea";
import { AddContactModal } from "./components/AddContactModal";
import { useSessions } from "./hooks/useSessions";
import { useChat } from "./hooks/useChat";
import { useIMessage } from "./hooks/useIMessage";
import { useHealth } from "./hooks/useHealth";
import { api } from "./api";
import "./App.css";

export default function App() {
    const [model, setModel] = useState("qwen");
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [showContactModal, setShowContactModal] = useState(false);
    const [sleepActive, setSleepActive] = useState(false);

    const { sessions, currentId, create, select, remove, reload: reloadSessions } = useSessions();
    const { messages, streaming, send } = useChat(currentId, model);
    const { contacts, add: addContact, remove: removeContact } = useIMessage();
    const health = useHealth();

    const currentSession = sessions.find(s => s.id === currentId);
    const title = currentSession?.title || "选择或创建对话";

    const handleSend = useCallback(async (text: string) => {
        // ✅ 先确保有 sessionId，再调 send
        let sid = currentId;
        if (!sid) {
            const newSession = await create(model);
            sid = newSession.id;
        }
        if (!sid) return;
        await send(text, sid);
        await reloadSessions();
    }, [currentId, model, send, create, reloadSessions]);


    const handleNew = useCallback(async () => {
        await create(model);
    }, [model, create]);

    const handleToggleSleep = useCallback(async () => {
        const r = await api.sleep.toggle();
        setSleepActive(r.preventing);
    }, []);

    return (
        <div id="app">
            <Sidebar
                sessions={sessions}
                currentId={currentId}
                onSelect={select}
                onDelete={remove}
                onNew={handleNew}
                contacts={contacts}
                onAddContact={() => setShowContactModal(true)}
                onDeleteContact={removeContact}
                health={health}
                sleepActive={sleepActive}
                onToggleSleep={handleToggleSleep}
            />
            <ChatArea
                title={title}
                messages={messages}
                streaming={streaming}
                model={model}
                onModelChange={setModel}
                onSend={handleSend}
                onMenuToggle={() => setSidebarOpen(o => !o)}
            />
            {showContactModal && (
                <AddContactModal
                    onAdd={async (data) => { await addContact(data); setShowContactModal(false); }}
                    onClose={() => setShowContactModal(false)}
                />
            )}
        </div>
    );
}
