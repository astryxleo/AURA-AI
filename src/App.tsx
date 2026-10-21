import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { BookOpen, Check, ChevronDown, Cpu, Menu, MessageSquare, Plus, Send, Settings2, Sparkles, Trash2, X, Zap } from "lucide-react";

type Message = { id: string; role: "user" | "assistant"; content: string; createdAt: number };
type Chat = { id: string; title: string; messages: Message[]; updatedAt: number };
const CHAT_KEY = "aura.chats.v1";
const SETTINGS_KEY = "aura.settings.v1";
const newId = () => Math.random().toString(36).slice(2, 10);
const starterChat = (): Chat => ({ id: newId(), title: "New conversation", messages: [], updatedAt: Date.now() });

type Settings = { model: string; personality: string; knowledge: string };
const defaultSettings: Settings = {
  model: "gemini-2.5-flash",
  personality: "You are AURA, a thoughtful, capable personal AI. Be warm, clear, honest about uncertainty, and practical. Use headings or bullets when they improve readability.",
  knowledge: "",
};
function loadJson<T,>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}

export default function App() {
  const [chats, setChats] = useState<Chat[]>(() => loadJson<Chat[]>(CHAT_KEY, [starterChat()]));
  const [activeId, setActiveId] = useState(() => chats[0]?.id ?? "");
  const [settings, setSettings] = useState<Settings>(() => ({ ...defaultSettings, ...loadJson<Partial<Settings>>(SETTINGS_KEY, {}) }));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [connection, setConnection] = useState<"unknown" | "online" | "offline">("unknown");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeChat = chats.find((chat) => chat.id === activeId) ?? chats[0];
  const hasMessages = Boolean(activeChat?.messages.length);

  useEffect(() => { localStorage.setItem(CHAT_KEY, JSON.stringify(chats)); }, [chats]);
  useEffect(() => { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }, [settings]);
  useEffect(() => { if (!activeId && chats[0]) setActiveId(chats[0].id); }, [activeId, chats]);

  const sortedChats = useMemo(() => [...chats].sort((a, b) => b.updatedAt - a.updatedAt), [chats]);

  function createChat() {
    const chat = starterChat();
    setChats((previous) => [chat, ...previous]);
    setActiveId(chat.id);
    setDraft("");
    setError("");
    setSidebarOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }

  function updateActive(messages: Message[], title?: string) {
    if (!activeChat) return;
    setChats((previous) => previous.map((chat) => chat.id === activeChat.id
      ? { ...chat, messages, title: title ?? chat.title, updatedAt: Date.now() }
      : chat));
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const prompt = draft.trim();
    if (!prompt || busy || !activeChat) return;
    setError("");
    setDraft("");
    const userMessage: Message = { id: newId(), role: "user", content: prompt, createdAt: Date.now() };
    const nextMessages = [...activeChat.messages, userMessage];
    const title = activeChat.messages.length === 0 ? prompt.slice(0, 42) + (prompt.length > 42 ? "…" : "") : activeChat.title;
    updateActive(nextMessages, title);
    setBusy(true);
    try {
      const context = settings.knowledge.trim()
        ? "\n\nPersonal knowledge notes (use when relevant; treat as user-provided context):\n" + settings.knowledge.trim()
        : "";
      const systemPrompt = settings.personality.trim() + context;
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: settings.model.trim() || "gemini-2.5-flash",
          stream: false,
          messages: [
            { role: "system", content: systemPrompt },
            ...nextMessages.map(({ role, content }) => ({ role, content })),
          ],
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(detail || "AI backend returned HTTP " + response.status);
      }
      const data = await response.json() as { message?: { content?: string }; error?: string };
      if (data.error) throw new Error(data.error);
      const answer = data.message?.content?.trim();
      if (!answer) throw new Error("The model returned an empty response. Check the selected model in Settings.");
      const assistantMessage: Message = { id: newId(), role: "assistant", content: answer, createdAt: Date.now() };
      updateActive([...nextMessages, assistantMessage], title);
      setConnection("online");
    } catch (caught) {
      setConnection("offline");
      const message = caught instanceof Error ? caught.message : "Unknown connection error";
      setError(message.includes("Failed to fetch")
        ? "Could not reach AURA’s cloud AI backend. Please try again in a moment."
        : message);
      updateActive(nextMessages, title);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  function deleteChat(id: string) {
    const remaining = chats.filter((chat) => chat.id !== id);
    const next = remaining.length ? remaining : [starterChat()];
    setChats(next);
    if (activeId === id) setActiveId(next[0].id);
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark"><Sparkles size={21} strokeWidth={1.8} /></div>
          <div className="brand-copy"><span>AURA</span><small>PERSONAL INTELLIGENCE</small></div>
          <button className="icon-button mobile-close" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
        </div>
        <button className="new-chat" onClick={createChat}><Plus size={17} /> <span>New conversation</span><span className="shortcut">⌘ K</span></button>
        <div className="sidebar-label">YOUR WORKSPACE</div>
        <button className="nav-item selected" onClick={() => setSidebarOpen(false)}><MessageSquare size={17} /> Chats <span className="nav-count">{chats.length}</span></button>
        <button className="nav-item" onClick={() => { setSettingsOpen(true); setSidebarOpen(false); }}><BookOpen size={17} /> Knowledge & persona</button>
        <div className="history-head"><span>RECENT</span><span>{sortedChats.length}</span></div>
        <div className="chat-list">
          {sortedChats.map((chat) => (
            <div key={chat.id} className={`chat-list-row ${chat.id === activeChat?.id ? "active" : ""}`}>
              <button className="chat-pick" onClick={() => { setActiveId(chat.id); setSidebarOpen(false); setError(""); }}>
                <MessageSquare size={15} /><span>{chat.title}</span>
              </button>
              <button className="delete-chat" aria-label={"Delete " + chat.title} title="Delete conversation" onClick={() => deleteChat(chat.id)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="profile-orb">A</div>
          <div className="profile-copy"><strong>Your AURA</strong><small>Personal workspace</small></div>
          <button className="icon-button" aria-label="Open settings" onClick={() => setSettingsOpen(true)}><Settings2 size={18} /></button>
        </div>
      </aside>

      {sidebarOpen && <button className="scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button menu-toggle" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
            <div className="breadcrumb">Workspace <span>/</span> <strong>{hasMessages ? activeChat?.title : "New conversation"}</strong></div>
          </div>
          <div className="topbar-right">
            <div className={`connection ${connection}`}><span className="status-dot" />{connection === "online" ? "Model connected" : connection === "offline" ? "Model offline" : "Cloud AI"}</div>
            <button className="settings-button" onClick={() => setSettingsOpen(true)}><Settings2 size={16} /><span>Settings</span></button>
          </div>
        </header>

        <section className="conversation" aria-live="polite">
          {!hasMessages ? (
            <div className="welcome">
              <div className="welcome-icon"><Sparkles size={28} /></div>
              <div className="eyebrow"><span /> YOUR SPACE. YOUR INTELLIGENCE.</div>
              <h1>Think beyond.<br /><em>Meet AURA.</em></h1>
              <p>A personal AI that adapts to how you think, learns from the context you give it, and helps you turn ideas into action.</p>
              <div className="suggestion-grid">
                <button className="suggestion" onClick={() => setDraft("Help me build a focused study plan for this week.")}><span className="suggestion-icon violet"><Zap size={17} /></span><strong>Plan my week</strong><small>Build a focused, realistic study plan</small><span className="suggestion-arrow">↗</span></button>
                <button className="suggestion" onClick={() => setDraft("Explain a difficult concept to me step by step, with an example.")}><span className="suggestion-icon blue"><BookOpen size={17} /></span><strong>Learn something</strong><small>Break down a complex idea clearly</small><span className="suggestion-arrow">↗</span></button>
                <button className="suggestion" onClick={() => setDraft("Help me brainstorm a creative project idea.")}><span className="suggestion-icon gold"><Sparkles size={17} /></span><strong>Explore an idea</strong><small>Go from rough thought to a clear plan</small><span className="suggestion-arrow">↗</span></button>
                <button className="suggestion" onClick={() => { setSettingsOpen(true); }}><span className="suggestion-icon green"><Settings2 size={17} /></span><strong>Make it yours</strong><small>Customize AURA's personality and memory</small><span className="suggestion-arrow">↗</span></button>
              </div>
              <div className="welcome-foot"><Cpu size={14} /> Cloud AI · No local installation needed <span>·</span> <button onClick={() => setSettingsOpen(true)}>Configure AI <ChevronDown size={13} /></button></div>
            </div>
          ) : (
            <div className="message-stack">
              <div className="conversation-heading"><div className="mini-orb"><Sparkles size={18} /></div><div><h2>{activeChat?.title}</h2><span>{activeChat?.messages.length ?? 0} messages · Stored in this browser</span></div></div>
              {activeChat?.messages.map((message) => (
                <article className={`message-row ${message.role}`} key={message.id}>
                  <div className={`message-avatar ${message.role}`}>{message.role === "assistant" ? <Sparkles size={17} /> : "Y"}</div>
                  <div className="message-body"><div className="message-label">{message.role === "assistant" ? "AURA" : "YOU"}</div><div className="message-content">{message.content}</div></div>
                </article>
              ))}
              {busy && <article className="message-row assistant"><div className="message-avatar assistant"><Sparkles size={17} /></div><div className="message-body"><div className="message-label">AURA</div><div className="typing"><span /><span /><span /> <small>Thinking</small></div></div></article>}
              <div className="end-spacer" />
            </div>
          )}
        </section>

        <div className="composer-wrap">
          {error && <div className="error-banner"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError("")}><X size={15} /></button></div>}
          <form className="composer" onSubmit={sendMessage}>
            <textarea ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} placeholder="Message AURA... (Enter to send, Shift + Enter for a new line)" rows={1} aria-label="Message AURA" />
            <div className="composer-bottom"><div className="composer-hint"><span className="composer-spark"><Sparkles size={13} /></span><span>Curious by design.</span><span className="hint-divider">/</span><span>{settings.model || "No model selected"}</span></div><button className="send-button" type="submit" disabled={!draft.trim() || busy} aria-label="Send message">{busy ? <span className="send-loader" /> : <Send size={17} />}<span>Send</span></button></div>
          </form>
          <p className="disclaimer">AURA can make mistakes. Verify important information. Your chats stay in this browser.</p>
        </div>
      </main>

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <header className="modal-header"><div><div className="modal-kicker">PERSONALIZE YOUR EXPERIENCE</div><h2 id="settings-title">AURA settings</h2><p>Shape how AURA thinks, responds, and uses your context.</p></div><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={19} /></button></header>
            <div className="settings-body">
              <label className="field-label" htmlFor="model">Cloud AI model</label><input id="model" className="field-input" value={settings.model} onChange={(event) => setSettings((old) => ({ ...old, model: event.target.value }))} placeholder="gemini-2.5-flash" />
              <div className="field-help">AURA uses a hosted model, so visitors do not need Ollama. Model availability depends on the provider and its usage limits.</div>
              <div className="field-divider" />
              <label className="field-label" htmlFor="personality">Personality instructions</label><textarea id="personality" className="field-textarea" rows={5} value={settings.personality} onChange={(event) => setSettings((old) => ({ ...old, personality: event.target.value }))} placeholder="Tell AURA how to behave..." />
              <label className="field-label" htmlFor="knowledge">Personal knowledge notes</label><textarea id="knowledge" className="field-textarea" rows={5} value={settings.knowledge} onChange={(event) => setSettings((old) => ({ ...old, knowledge: event.target.value }))} placeholder="Add your goals, preferences, project context, or notes that AURA should use..." />
              <div className="field-help">These notes are added to your prompt when you chat. Keep sensitive information out of local notes on shared computers.</div>
            </div>
            <footer className="modal-footer"><span><Check size={14} /> Saved automatically in this browser</span><button className="primary-button" onClick={() => setSettingsOpen(false)}>Done <Check size={15} /></button></footer>
          </section>
        </div>
      )}
    </div>
  );
}