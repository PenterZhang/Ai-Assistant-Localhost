import { useState, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatArea } from "./components/ChatArea";
import { AddContactModal } from "./components/AddContactModal";
import { SetupWizard } from "./components/SetupWizard";
import { Settings } from "./components/Settings";
import { useSessions } from "./hooks/useSessions";
import { useChat } from "./hooks/useChat";
import { useIMessage } from "./hooks/useIMessage";
import { useHealth } from "./hooks/useHealth";
import { api } from "./api";
import "./App.css";

export default function App() {
    const [model, setModel] = useState("qwen");
    const [showContactModal, setShowContactModal] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [sleepActive, setSleepActive] = useState(false);
    const [setupDone, setSetupDone] = useState(false);

    const { sessions, currentId, create, select, remove, reload: reloadSessions } = useSessions();
    const { messages, streaming, send } = useChat(currentId, model);
    const { contacts, add: addContact, remove: removeContact } = useIMessage();
    const health = useHealth();

    const currentSession = sessions.find(s => s.id === currentId);
    const title = currentSession?.title || "选择或创建对话";

    const handleSend = useCallback(async (text: string, search?: boolean) => {
        let sid = currentId;
        if (!sid) {
            const newSession = await create(model);
            sid = newSession.id;
        }
        if (!sid) return;
        await send(text, sid, search);
        await reloadSessions();
    }, [currentId, model, send, create, reloadSessions]);

    const handleNew = useCallback(async () => {
        await create(model);
    }, [model, create]);

    const handleToggleSleep = useCallback(async () => {
        const r = await api.sleep.toggle();
        setSleepActive(r.preventing);
    }, []);

    if (!setupDone) {
        return <SetupWizard onComplete={() => setSetupDone(true)} />;
    }

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
                onOpenSettings={() => setShowSettings(true)}
            />
            <ChatArea
                title={title}
                messages={messages}
                streaming={streaming}
                model={model}
                onModelChange={setModel}
                onSend={handleSend}
                onMenuToggle={() => { }}
            />
            {showContactModal && (
                <AddContactModal
                    onAdd={async (data) => { await addContact(data); setShowContactModal(false); }}
                    onClose={() => setShowContactModal(false)}
                />
            )}
            {showSettings && (
                <Settings
                    onClose={() => setShowSettings(false)}
                    onConfigChanged={() => reloadSessions()}
                />
            )}
        </div>
    );
}
