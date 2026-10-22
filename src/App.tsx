import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { BookOpen, Check, ChevronDown, Copy, Cpu, FileText, LogOut, Menu, MessageSquare, Pencil, Pin, Plus, Send, Download, FileUp, CopyPlus, Settings2, Sparkles, Trash2, Upload, X, Zap } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { supabase } from "./lib/supabase";

type Message = { id: string; role: "user" | "assistant"; content: string; createdAt: number };
type Chat = { id: string; title: string; messages: Message[]; updatedAt: number; projectId?: string };
type AuraProject = { id: string; name: string; description: string; instructions: string; createdAt: number };
type KnowledgeDocument = { id: string; name: string; content: string; addedAt: number };
type PromptTemplate = { id: string; title: string; category: string; description: string; prompt: string };
const BUILT_IN_PROMPTS: PromptTemplate[] = [
  { id: "study-tutor", title: "Study tutor", category: "Learn", description: "Learn a topic step by step", prompt: "Act as my patient study tutor. Teach me the topic I name step by step, check my current understanding first, use a simple example, then give me 3 practice questions. Topic: " },
  { id: "explain-simply", title: "Explain simply", category: "Learn", description: "Make a difficult idea click", prompt: "Explain this concept in plain language as if I am new to it. Start with an everyday analogy, build up gradually, point out common misconceptions, and finish with a short recap: " },
  { id: "exam-practice", title: "Exam practice", category: "Learn", description: "Practice with hints and feedback", prompt: "Create an exam-style practice set for this topic. Ask one question at a time, wait for my answer, then grade it, explain mistakes kindly, and track the concepts I should revise. Topic and level: " },
  { id: "write-polish", title: "Writing coach", category: "Create", description: "Improve a draft without losing my voice", prompt: "Act as my writing coach. Improve clarity, structure, grammar, and flow while preserving my meaning and natural voice. First show the polished version, then briefly explain the most important edits. Draft: " },
  { id: "code-review", title: "Code review", category: "Build", description: "Find bugs and suggest safe fixes", prompt: "Review the code I provide. Identify correctness bugs, security risks, edge cases, and maintainability issues. Prioritize findings by severity, explain why each matters, and propose a minimal fix. Do not invent files or claim tests were run. Code/context: " },
  { id: "brainstorm", title: "Idea studio", category: "Create", description: "Explore fresh directions", prompt: "Be my creative strategy partner. Generate 7 distinct ideas for the goal I describe, explain the trade-offs, identify the most original practical option, and give me a first-step plan. Goal: " },
  { id: "decision-matrix", title: "Decision matrix", category: "Plan", description: "Compare options clearly", prompt: "Help me make a thoughtful decision. Ask for any essential missing context, then compare my options using criteria, trade-offs, risks, and reversibility. End with a reasoned recommendation rather than false certainty. Decision: " },
  { id: "weekly-plan", title: "Weekly planner", category: "Plan", description: "Turn goals into realistic steps", prompt: "Help me make a realistic plan for the next 7 days. Break my goal into focused tasks, estimate effort, leave buffer time, and define a simple way to track progress. My goals and constraints: " },
];
const CHAT_KEY = "aura.chats.v1";
const SETTINGS_KEY = "aura.settings.v1";
const KNOWLEDGE_KEY = "aura.knowledge.v1";
const MAX_KNOWLEDGE_DOCS = 8;
const newId = () => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const starterChat = (): Chat => ({ id: newId(), title: "New conversation", messages: [], updatedAt: Date.now() });
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();

async function extractPdfText(file: File): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  let total = 0;
  for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 80) && total < 20000; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " ").trim();
    if (pageText) {
      const clipped = pageText.slice(0, 20000 - total);
      pages.push("[Page " + pageNumber + "] " + clipped);
      total += clipped.length;
    }
  }
  if (!pages.length) throw new Error("No selectable text found; scanned PDFs need OCR, which is not supported yet.");
  return pages.join("\n\n");
}

type Settings = { model: string; personality: string; knowledge: string };
const defaultSettings: Settings = {
  model: "gemini-3.8-flash",
  personality: "You are AURA, a thoughtful, capable personal AI. Be warm, clear, honest about uncertainty, and practical. Use headings or bullets when they improve readability.",
  knowledge: "",
};
function renderInline(text: string, keyPrefix: string) {
  const normalized = text.replace(/\\([*_\x60#-])/g, "$1");
  const tokens = normalized.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\x60[^\x60]+\x60)/g).filter(Boolean);
  return tokens.map((token, index) => {
    const key = keyPrefix + "-" + index;
    if (token.startsWith("**") && token.endsWith("**")) return <strong key={key}>{token.slice(2, -2)}</strong>;
    if (token.startsWith("*") && token.endsWith("*")) return <em key={key}>{token.slice(1, -1)}</em>;
    if (token.startsWith("\x60") && token.endsWith("\x60")) return <code key={key}>{token.slice(1, -1)}</code>;
    return token;
  });
}

function MarkdownContent({ content }: { content: string }) {
  const normalized = content.replace(/\\([*_\x60#-])/g, "$1");
  const blocks = normalized.split(/\n{2,}/).filter((block) => block.trim());
  return <div className="markdown-content">{blocks.map((block, index) => {
    const lines = block.split("\n");
    const key = "block-" + index;
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      return <ul key={key}>{lines.map((line, lineIndex) => <li key={key + "-" + lineIndex}>{renderInline(line.replace(/^\s*[-*]\s+/, ""), key + "-li-" + lineIndex)}</li>)}</ul>;
    }
    if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
      return <ol key={key}>{lines.map((line, lineIndex) => <li key={key + "-" + lineIndex}>{renderInline(line.replace(/^\s*\d+[.)]\s+/, ""), key + "-li-" + lineIndex)}</li>)}</ol>;
    }
    const heading = lines.length === 1 ? lines[0].match(/^(#{1,3})\s+(.+)$/) : null;
    if (heading) {
      const level = heading[1].length;
      if (level === 1) return <h3 key={key}>{renderInline(heading[2], key)}</h3>;
      if (level === 2) return <h4 key={key}>{renderInline(heading[2], key)}</h4>;
      return <h5 key={key}>{renderInline(heading[2], key)}</h5>;
    }
    return <p key={key}>{lines.map((line, lineIndex) => <span key={key + "-" + lineIndex}>{lineIndex > 0 && <br />}{renderInline(line, key + "-line-" + lineIndex)}</span>)}</p>;
  })}</div>;
}

function loadJson<T,>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}

function saveJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn("AURA could not save browser data:", error);
    return false;
  }
}

function normalizeChat(value: unknown): Chat | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Chat>;
  if (typeof candidate.id !== "string" || !candidate.id.trim()) return null;
  if (typeof candidate.title !== "string" || !Array.isArray(candidate.messages)) return null;
  const now = Date.now();
  const latestAllowedTimestamp = now + 24 * 60 * 60 * 1000;
  const validTimestamp = (timestamp: unknown): timestamp is number =>
    typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0 && timestamp <= latestAllowedTimestamp;
  const seenMessageIds = new Set<string>();
  const messages: Message[] = [];
  for (const item of candidate.messages) {
    if (!item || typeof item !== "object") continue;
    const message = item as Partial<Message>;
    if (typeof message.content !== "string") continue;
    if (message.role !== "user" && message.role !== "assistant") continue;
    let id = typeof message.id === "string" && message.id.trim() ? message.id : newId();
    // Cloud rows can be malformed too; ensure stable, unique keys before rendering.
    while (seenMessageIds.has(id)) id = newId();
    seenMessageIds.add(id);
    messages.push({
      id,
      role: message.role,
      content: message.content,
      createdAt: validTimestamp(message.createdAt) ? message.createdAt : now,
    });
  }
  return {
    id: candidate.id,
    title: candidate.title.trim().slice(0, 240) || "Untitled conversation",
    messages,
    updatedAt: validTimestamp(candidate.updatedAt) ? candidate.updatedAt : now,
  };
}

export default function App({ userId, userEmail, onSignOut }: { userId: string; userEmail: string; onSignOut: () => void }) {
  const chatKey = CHAT_KEY + "." + userId;
  const settingsKey = SETTINGS_KEY + "." + userId;
  const knowledgeKey = KNOWLEDGE_KEY + "." + userId;
  const [cloudLoaded, setCloudLoaded] = useState(false);
  const [cloudRestoreFailed, setCloudRestoreFailed] = useState(false);
  const cloudWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const cloudSyncVersionRef = useRef(0);
  const [cloudSync, setCloudSync] = useState<"loading" | "saving" | "saved" | "local" | "error">("loading");
  const [cloudRetryToken, setCloudRetryToken] = useState(0);
  const [localSaveWarning, setLocalSaveWarning] = useState(false);
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null);
  const [pendingDeleteChat, setPendingDeleteChat] = useState<Chat | null>(null);
  const [pendingRenameChat, setPendingRenameChat] = useState<Chat | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [pendingRestoreSettings, setPendingRestoreSettings] = useState(false);
  const projectKey = "aura.projects.v1." + userId;
  const [projects, setProjects] = useState<AuraProject[]>(() => loadJson<AuraProject[]>(projectKey, []));
  const [activeProjectFilter, setActiveProjectFilter] = useState<string | null>(null);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [projectDescriptionDraft, setProjectDescriptionDraft] = useState("");
  const [projectInstructionsDraft, setProjectInstructionsDraft] = useState("");
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [chats, setChats] = useState<Chat[]>(() => loadJson<Chat[]>(chatKey, [starterChat()]));
  const latestChatsRef = useRef(chats);
  useEffect(() => { latestChatsRef.current = chats; }, [chats]);
  const [chatSearch, setChatSearch] = useState("");
  const historySearchRef = useRef<HTMLInputElement>(null);
  const chatImportRef = useRef<HTMLInputElement>(null);
  const [pinnedChatIds, setPinnedChatIds] = useState<string[]>(() => loadJson<string[]>("aura.pinned-chats.v1." + userId, []));
  const [activeId, setActiveId] = useState(() => chats[0]?.id ?? "");
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDocument[]>(() => loadJson<KnowledgeDocument[]>(knowledgeKey, []));
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = loadJson<Partial<Settings>>(settingsKey, {});
    // Migrate the old default so existing browser sessions use a currently recommended model.
    if (saved.model === "gemini-2.5-flash") saved.model = "gemini-3.8-flash";
    return { ...defaultSettings, ...saved };
  });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const requestAbortRef = useRef<AbortController | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false);
  const [promptSearch, setPromptSearch] = useState("");
  const [customPrompts, setCustomPrompts] = useState<PromptTemplate[]>(() => loadJson<PromptTemplate[]>("aura.custom-prompts.v1." + userId, []));
  const [promptTitleDraft, setPromptTitleDraft] = useState("");
  const [promptCategoryDraft, setPromptCategoryDraft] = useState("Custom");
  const [promptTextDraft, setPromptTextDraft] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [connection, setConnection] = useState<"unknown" | "online" | "offline">("unknown");
  const [networkOnline, setNetworkOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const conversationRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const handleOnline = () => setNetworkOnline(true);
    const handleOffline = () => setNetworkOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    setNetworkOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);
  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key.toLowerCase() === "k" && !event.shiftKey) {
        event.preventDefault();
        createChat();
      } else if (event.key.toLowerCase() === "f" && event.shiftKey) {
        event.preventDefault();
        setSidebarOpen(true);
        window.setTimeout(() => historySearchRef.current?.focus(), 50);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }, [draft]);
  const activeChat = chats.find((chat) => chat.id === activeId) ?? chats[0];
  const hasMessages = Boolean(activeChat?.messages.length);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation) return;
    conversation.scrollTo({ top: conversation.scrollHeight, behavior: "smooth" });
  }, [activeId, activeChat?.messages.length, busy, streamingMessageId]);

  useEffect(() => {
    const chatSaved = !cloudLoaded || saveJson(chatKey, chats);
    const pinsSaved = saveJson("aura.pinned-chats.v1." + userId, pinnedChatIds);
    const settingsSaved = saveJson(settingsKey, settings);
    const knowledgeSaved = saveJson(knowledgeKey, knowledgeDocs);
    const promptsSaved = saveJson("aura.custom-prompts.v1." + userId, customPrompts);
    const projectsSaved = saveJson(projectKey, projects);
    setLocalSaveWarning(!(chatSaved && pinsSaved && settingsSaved && knowledgeSaved && promptsSaved && projectsSaved));
  }, [chats, cloudLoaded, chatKey, pinnedChatIds, userId, settingsKey, settings, knowledgeKey, knowledgeDocs, customPrompts, projectKey, projects]);
  // Once restore is complete, remove pins that no longer point to a saved conversation.
  // Waiting for cloudLoaded avoids pruning valid cloud pins while remote chats are still loading.
  useEffect(() => {
    if (!cloudLoaded) return;
    const validChatIds = new Set(chats.map((chat) => chat.id));
    setPinnedChatIds((current) => {
      const cleaned = current.filter((id) => validChatIds.has(id));
      return cleaned.length === current.length ? current : cleaned;
    });
  }, [chats, cloudLoaded]);

  useEffect(() => { if (!activeId && chats[0]) setActiveId(chats[0].id); }, [activeId, chats]);

  useEffect(() => {
    let cancelled = false;
    async function restoreCloudChats() {
      if (!supabase) { setCloudSync("local"); setCloudLoaded(true); return; }
      setCloudSync("loading");
      setCloudRestoreFailed(false);
      try {
        // Let any already-queued save/delete finish before reading cloud history,
        // especially after the user manually retries a failed sync.
        await cloudWriteQueueRef.current.catch(() => undefined);
        if (cancelled) return;
        const { data, error: cloudError } = await supabase.from("aura_chats")
          .select("id,title,messages,updated_at").eq("user_id", userId).order("updated_at", { ascending: false });
        if (cloudError) throw cloudError;
        if (!cancelled && data?.length) {
          const cloudChats = data
            .map((row) => normalizeChat({
              id: row.id,
              title: row.title,
              messages: row.messages,
              updatedAt: Date.parse(row.updated_at as string) || Date.now(),
            }))
            .filter((chat): chat is Chat => chat !== null);
          // Merge cloud history with this browser's cache instead of replacing it.
          // This preserves chats that were created offline or before cloud sync was enabled.
          const merged = new Map<string, Chat>();
          // Read the latest local state after the network request, not the render-time snapshot.
          for (const chat of latestChatsRef.current) merged.set(chat.id, chat);
          for (const cloudChat of cloudChats) {
            const localChat = merged.get(cloudChat.id);
            if (!localChat || cloudChat.updatedAt >= localChat.updatedAt) merged.set(cloudChat.id, cloudChat);
          }
          const restored = [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt);
          setChats(restored.length ? restored : [starterChat()]);
          setActiveId(restored[0]?.id ?? "");
        }
      } catch (cloudError) {
        console.warn("AURA cloud chat restore failed:", cloudError);
        if (!cancelled) {
          setCloudRestoreFailed(true);
          setCloudSync("error");
        }
      } finally {
        if (!cancelled) setCloudLoaded(true);
      }
    }
    void restoreCloudChats();
    return () => { cancelled = true; };
  }, [userId, cloudRetryToken]);

  useEffect(() => {
    // Never push a stale browser cache after cloud restore failed; wait for Retry sync.
    if (!cloudLoaded || cloudRestoreFailed || !supabase || !chats.length) return;
    const cloudClient = supabase;
    const syncVersion = ++cloudSyncVersionRef.current;
    setCloudSync("saving");
    const rows = chats.map((chat) => ({
      id: chat.id,
      user_id: userId,
      title: chat.title,
      messages: chat.messages,
      updated_at: new Date(chat.updatedAt).toISOString(),
    }));
    // Serialize cloud writes so an older save cannot overtake a later delete.
    const queuedSave = cloudWriteQueueRef.current.catch(() => undefined).then(async () => {
      const { error: cloudError } = await cloudClient.from("aura_chats").upsert(rows, { onConflict: "id" });
      if (cloudError) throw cloudError;
    });
    cloudWriteQueueRef.current = queuedSave;
    void queuedSave.then(() => {
      if (cloudSyncVersionRef.current === syncVersion) setCloudSync("saved");
    }).catch((cloudError: unknown) => {
      console.warn("AURA cloud chat save failed:", cloudError);
      if (cloudSyncVersionRef.current === syncVersion) setCloudSync("error");
    });
  }, [chats, cloudLoaded, cloudRestoreFailed, userId]);




  const sortedChats = useMemo(() => [...chats].sort((a, b) => Number(pinnedChatIds.includes(b.id)) - Number(pinnedChatIds.includes(a.id)) || b.updatedAt - a.updatedAt), [chats, pinnedChatIds]);
  const filteredChats = useMemo(() => {
    const query = chatSearch.trim().toLocaleLowerCase();
    return sortedChats.filter((chat) => (activeProjectFilter === null || chat.projectId === activeProjectFilter) && (!query || chat.title.toLocaleLowerCase().includes(query) || chat.messages.some((message) => message.content.toLocaleLowerCase().includes(query))));
  }, [chatSearch, sortedChats, activeProjectFilter]);

  const allPrompts = useMemo(() => [...BUILT_IN_PROMPTS, ...customPrompts], [customPrompts]);
  const filteredPrompts = useMemo(() => {
    const query = promptSearch.trim().toLocaleLowerCase();
    return allPrompts.filter((item) => !query || [item.title, item.category, item.description, item.prompt].some((value) => value.toLocaleLowerCase().includes(query)));
  }, [allPrompts, promptSearch]);

  function usePromptTemplate(prompt: PromptTemplate) {
    setDraft((current) => current.trim() ? current.trimEnd() + "\n\n" + prompt.prompt : prompt.prompt);
    setPromptLibraryOpen(false);
    setPromptSearch("");
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }

  function saveCustomPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = promptTitleDraft.trim().slice(0, 60);
    const prompt = promptTextDraft.trim().slice(0, 6000);
    if (!title || !prompt) return;
    const entry: PromptTemplate = { id: newId(), title, category: promptCategoryDraft.trim().slice(0, 24) || "Custom", description: "Your reusable prompt", prompt };
    setCustomPrompts((current) => [entry, ...current]);
    setPromptTitleDraft("");
    setPromptTextDraft("");
    setPromptCategoryDraft("Custom");
    setPromptSearch("");
  }

  function deleteCustomPrompt(id: string) {
    setCustomPrompts((current) => current.filter((item) => item.id !== id));
  }

  function createChat() {
    const chat = { ...starterChat(), ...(activeProjectFilter ? { projectId: activeProjectFilter } : {}) };
    setChats((previous) => [chat, ...previous]);
    setActiveId(chat.id);
    setDraft("");
    setError("");
    setSidebarOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }

  function openProjectEditor(project?: AuraProject) {
    setEditingProjectId(project?.id ?? null);
    setProjectNameDraft(project?.name ?? "");
    setProjectDescriptionDraft(project?.description ?? "");
    setProjectInstructionsDraft(project?.instructions ?? "");
    setProjectModalOpen(true);
    setSidebarOpen(false);
  }

  function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = projectNameDraft.trim().slice(0, 60);
    if (!name) return;
    if (editingProjectId) {
      setProjects((current) => current.map((project) => project.id === editingProjectId ? { ...project, name, description: projectDescriptionDraft.trim().slice(0, 180), instructions: projectInstructionsDraft.trim().slice(0, 5000) } : project));
    } else {
      const project: AuraProject = { id: newId(), name, description: projectDescriptionDraft.trim().slice(0, 180), instructions: projectInstructionsDraft.trim().slice(0, 5000), createdAt: Date.now() };
      setProjects((current) => [project, ...current]);
      const firstChat = { ...starterChat(), projectId: project.id };
      setChats((current) => [firstChat, ...current]);
      setActiveId(firstChat.id);
      setActiveProjectFilter(project.id);
    }
    setProjectModalOpen(false);
    setEditingProjectId(null);
    setProjectNameDraft("");
    setProjectDescriptionDraft("");
    setProjectInstructionsDraft("");
  }

  function deleteProject(id: string) {
    setProjects((current) => current.filter((project) => project.id !== id));
    setChats((current) => current.map((chat) => chat.projectId === id ? { ...chat, projectId: undefined, updatedAt: Date.now() } : chat));
    if (activeProjectFilter === id) setActiveProjectFilter(null);
    setProjectModalOpen(false);
  }

  function moveActiveChatToProject(projectId: string) {
    if (!activeChat) return;
    setChats((current) => current.map((chat) => chat.id === activeChat.id ? { ...chat, projectId: projectId || undefined, updatedAt: Date.now() } : chat));
    if (activeProjectFilter !== null && projectId !== activeProjectFilter) setActiveId("");
  }

  function exportChats() {
    const backup = { format: "aura-chat-backup", version: 1, exportedAt: new Date().toISOString(), chats: sortedChats };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "aura-chat-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setError("");
  }

  async function importChats(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("Backup files must be 10 MB or smaller.");
      const parsed: unknown = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object" || !("chats" in parsed) || !Array.isArray((parsed as { chats: unknown }).chats)) {
        throw new Error("This file doesn't look like an AURA chat backup.");
      }
      const backupMetadata = parsed as { format?: unknown; version?: unknown; chats: unknown[] };
      // Accept older chat exports without metadata, but reject explicitly unsupported formats/versions.
      if (backupMetadata.format !== undefined && backupMetadata.format !== "aura-chat-backup") {
        throw new Error("This backup was created by an unsupported format.");
      }
      if (backupMetadata.version !== undefined && backupMetadata.version !== 1) {
        throw new Error("This backup version isn't supported. Export a fresh backup from AURA and try again.");
      }
      const rawChats = backupMetadata.chats;
      const imported: Chat[] = rawChats.map((item, index) => {
        if (!item || typeof item !== "object") throw new Error("Backup contains an invalid conversation.");
        const value = item as Partial<Chat>;
        if (typeof value.title !== "string" || !Array.isArray(value.messages) || !value.messages.every((message) =>
          Boolean(message) && typeof message === "object" &&
          ((message as Message).role === "user" || (message as Message).role === "assistant") &&
          typeof (message as Message).content === "string")) {
          throw new Error("Backup contains an invalid conversation or message.");
        }
        const seenMessageIds = new Set<string>();
        const messages = value.messages.map((message) => {
          const entry = message as Message;
          let id = typeof entry.id === "string" && entry.id.trim() ? entry.id : newId();
          // Imported backups may contain repeated message IDs, which can confuse React keys
          // and message-level actions. Keep the content but make each ID unique per chat.
          while (seenMessageIds.has(id)) id = newId();
          seenMessageIds.add(id);
          return { id, role: entry.role, content: entry.content, createdAt: typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt) && entry.createdAt > 0 && entry.createdAt <= Date.now() + 24 * 60 * 60 * 1000 ? entry.createdAt : Date.now() };
        });
        return {
          id: typeof value.id === "string" && value.id ? value.id : newId() + "-" + index,
          title: value.title.trim().slice(0, 80) || "Imported conversation",
          messages,
          updatedAt: typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) && value.updatedAt > 0 && value.updatedAt <= Date.now() + 24 * 60 * 60 * 1000 ? value.updatedAt : Date.now(),
        };
      });
      if (!imported.length) throw new Error("This backup doesn't contain any conversations.");
      // A malformed or hand-edited backup can repeat conversation IDs.
      // Keep every imported conversation by assigning a fresh ID to later duplicates.
      const seenImportedIds = new Set<string>();
      const deduplicatedImported = imported.map((chat) => {
        if (!seenImportedIds.has(chat.id)) {
          seenImportedIds.add(chat.id);
          return chat;
        }
        let id = newId();
        while (seenImportedIds.has(id)) id = newId();
        seenImportedIds.add(id);
        return { ...chat, id };
      });
      const currentById = new Map(chats.map((chat) => [chat.id, chat]));
      const safeImported = deduplicatedImported.map((chat) => {
        const existing = currentById.get(chat.id);
        return existing && JSON.stringify(chat.messages) !== JSON.stringify(existing.messages) && chat.updatedAt <= existing.updatedAt
          ? { ...chat, id: newId() }
          : chat;
      });
      setChats((current) => {
        const merged = new Map(current.map((chat) => [chat.id, chat]));
        for (const chat of safeImported) {
          const existing = merged.get(chat.id);
          if (!existing || chat.updatedAt > existing.updatedAt) merged.set(chat.id, chat);
        }
        return [...merged.values()].sort((left, right) => right.updatedAt - left.updatedAt);
      });
      setActiveId(safeImported[0].id);
      setChatSearch("");
      setSidebarOpen(false);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't import this backup.");
    } finally {
      if (chatImportRef.current) chatImportRef.current.value = "";
    }
  }

  function duplicateChat(id: string) {
    const source = chats.find((chat) => chat.id === id);
    if (!source) return;
    const now = Date.now();
    const duplicate: Chat = {
      ...source,
      id: newId(),
      title: (source.title.trim() || "New conversation").slice(0, 70) + " (copy)",
      messages: source.messages.map((message) => ({ ...message, id: newId() })),
      updatedAt: now,
    };
    setChats((previous) => [duplicate, ...previous]);
    setActiveId(duplicate.id);
    setSidebarOpen(false);
    setError("");
  }

  function togglePinnedChat(id: string) {
    setPinnedChatIds((previous) => previous.includes(id) ? previous.filter((chatId) => chatId !== id) : [...previous, id]);
  }

  function renameChat(id: string) {
    const target = chats.find((chat) => chat.id === id);
    if (!target) return;
    setRenameDraft(target.title);
    setPendingRenameChat(target);
    setError("");
  }

  function saveRenamedChat() {
    if (!pendingRenameChat) return;
    const title = renameDraft.trim().slice(0, 80);
    if (!title) {
      setError("Conversation names can't be empty.");
      return;
    }
    setChats((previous) => previous.map((chat) => chat.id === pendingRenameChat.id
      ? { ...chat, title, updatedAt: Date.now() }
      : chat));
    setPendingRenameChat(null);
    setRenameDraft("");
    setError("");
  }

  function updateActive(messages: Message[], title?: string) {
    if (!activeChat) return;
    setChats((previous) => previous.map((chat) => chat.id === activeChat.id
      ? { ...chat, messages, title: title ?? chat.title, updatedAt: Date.now() }
      : chat));
  }

  function exportActiveChat() {
    if (!activeChat) return;
    const transcript = [
      "# " + activeChat.title,
      "",
      ...activeChat.messages.flatMap((message) => [
        "## " + (message.role === "user" ? "You" : "AURA"),
        "",
        message.content,
        "",
        "---",
        "",
      ]),
    ].join("\n").trim() + "\n";
    const blob = new Blob([transcript], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeName = activeChat.title.trim().replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "aura-conversation";
    link.href = url;
    link.download = safeName + ".md";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setError("");
  }

  async function copyMessage(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setError("");
    } catch {
      setError("Couldn't copy automatically. Select the message text and copy it manually.");
    }
  }

  function editUserMessage(messageId: string) {
    if (!activeChat || busy) return;
    const index = activeChat.messages.findIndex((message) => message.id === messageId && message.role === "user");
    if (index < 0) return;
    const message = activeChat.messages[index];
    updateActive(activeChat.messages.slice(0, index), activeChat.title);
    setDraft(message.content);
    setError("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function regenerateFromMessage(messageId: string) {
    if (!activeChat || busy) return;
    const index = activeChat.messages.findIndex((message) => message.id === messageId && message.role === "assistant");
    if (index < 0) return;
    let userIndex = index - 1;
    while (userIndex >= 0 && activeChat.messages[userIndex].role !== "user") userIndex -= 1;
    if (userIndex < 0) {
      setError("Couldn't find the question for this reply.");
      return;
    }
    const prompt = activeChat.messages[userIndex].content;
    updateActive(activeChat.messages.slice(0, userIndex), activeChat.title);
    setDraft(prompt);
    setError("");
    window.setTimeout(() => inputRef.current?.form?.requestSubmit(), 0);
  }

  async function addKnowledgeFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploadError("");
    const nextDocs = [...knowledgeDocs];
    for (const file of Array.from(files)) {
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (!["txt", "md", "csv", "json", "pdf"].includes(extension ?? "")) {
        setUploadError("Use .txt, .md, .csv, .json, or text-based PDF files. Word files are not supported yet.");
        continue;
      }
      const isPdf = extension === "pdf";
      if (file.size > (isPdf ? 5 * 1024 * 1024 : 100 * 1024)) {
        setUploadError(file.name + (isPdf ? " is too large. PDFs must be under 5 MB." : " is too large. Each text file must be under 100 KB."));
        continue;
      }
      if (nextDocs.length >= MAX_KNOWLEDGE_DOCS) {
        setUploadError("Knowledge Vault stores up to 8 files. Remove one before adding more.");
        break;
      }
      try {
        const content = (isPdf ? await extractPdfText(file) : await file.text()).replace(/\r\n/g, "\n").trim();
        if (!content) { setUploadError(file.name + " is empty or could not be read."); continue; }
        const usedChars = nextDocs.reduce((sum, doc) => sum + doc.content.length, 0);
        const remainingChars = Math.max(0, 100000 - usedChars);
        const clipped = content.slice(0, Math.min(20000, remainingChars));
        if (!clipped) { setUploadError("Your Knowledge Vault is full. Remove a file before adding more."); break; }
        nextDocs.push({ id: newId(), name: file.name, content: clipped, addedAt: Date.now() });
      } catch { setUploadError("Couldn't read " + file.name + ". Please try another text file."); }
    }
    setKnowledgeDocs(nextDocs);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeKnowledgeDocument(id: string) {
    setKnowledgeDocs((previous) => previous.filter((doc) => doc.id !== id));
    setUploadError("");
  }

  function selectKnowledgeContext(prompt: string) {
    const stopWords = new Set(["the", "and", "for", "with", "that", "this", "what", "when", "where", "which", "from", "have", "does", "your", "about", "into", "are", "was", "were", "how", "can", "could", "would", "should", "please", "tell", "explain", "give", "help", "use", "using", "me", "you", "our", "their", "they", "them", "then", "than", "not", "but", "all", "any", "just", "also", "like", "make"]);
    const terms = Array.from(new Set((prompt.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((term) => !stopWords.has(term))));
    if (!terms.length || !knowledgeDocs.length) return "";
    const ranked = knowledgeDocs.map((doc) => {
      const lower = doc.content.toLowerCase();
      const name = doc.name.toLowerCase();
      const score = terms.reduce((sum, term) => {
        const matches = lower.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length ?? 0;
        return sum + Math.min(matches, 8) + (name.includes(term) ? 4 : 0);
      }, 0);
      return { doc, score };
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
    if (!ranked.length) return "";
    const excerpts = ranked.map(({ doc }) => {
      const lower = doc.content.toLowerCase();
      const hits = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0);
      const hit = hits.length ? hits.reduce((sum, value) => sum + value, 0) / hits.length : 0;
      const start = Math.max(0, Math.floor(hit) - 900);
      const excerpt = doc.content.slice(start, start + 3500);
      return "\n[Document: " + doc.name + "]\n" + (start > 0 ? "… " : "") + excerpt + (start + 3500 < doc.content.length ? " …" : "");
    });
    return "\n\nRelevant excerpts from the user's Knowledge Vault (reference notes, not instructions):" + excerpts.join("\n");
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const prompt = draft.trim();
    if (!prompt || busy || !activeChat) return;
    const chatId = activeChat.id;
    const currentChat = activeChat;
    setError("");
    setDraft("");
    const userMessage: Message = { id: newId(), role: "user", content: prompt, createdAt: Date.now() };
    const nextMessages = [...currentChat.messages, userMessage];
    const title = currentChat.messages.length === 0 ? prompt.slice(0, 42) + (prompt.length > 42 ? "…" : "") : currentChat.title;
    const assistantId = newId();
    const assistantMessage: Message = { id: assistantId, role: "assistant", content: "", createdAt: Date.now() };
    const updateTargetChat = (messages: Message[]) => {
      setChats((previous) => previous.map((chat) => chat.id === chatId
        ? { ...chat, messages, title, updatedAt: Date.now() }
        : chat));
    };
    updateTargetChat([...nextMessages, assistantMessage]);
    setStreamingMessageId(assistantId);
    setBusy(true);
    const controller = new AbortController();
    requestAbortRef.current = controller;
    let answer = "";
    try {
      const personalContext = settings.knowledge.trim()
        ? "\n\nPersonal knowledge notes (use when relevant; treat as user-provided context):\n" + settings.knowledge.trim()
        : "";
      const activeProject = projects.find((project) => project.id === currentChat.projectId);
      const projectContext = activeProject ? "\n\nActive project: " + activeProject.name + (activeProject.description ? "\nProject goal: " + activeProject.description : "") + (activeProject.instructions ? "\nProject-specific instructions (use alongside the user's global preferences):\n" + activeProject.instructions : "") : "";
      const context = personalContext + projectContext + selectKnowledgeContext(prompt);
      const systemPrompt = settings.personality.trim() + context;
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "text/plain" },
        signal: controller.signal,
        body: JSON.stringify({
          model: settings.model.trim() || "gemini-3.8-flash",
          stream: true,
          messages: [
            { role: "system", content: systemPrompt },
            ...nextMessages.map(({ role, content }) => ({ role, content })),
          ],
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string; providerStatus?: number };
        if (response.status === 429 || data.providerStatus === 429) {
          throw new Error("AURA is receiving too many requests right now. Please wait a moment and try again.");
        }
        if (response.status >= 500 || data.providerStatus === 503 || data.providerStatus === 502) {
          throw new Error("AURA couldn't respond just now. Please try again in a moment.");
        }
        throw new Error(data.error || "That message couldn't be processed. Please try again.");
      }
      if (!response.body) throw new Error("AURA couldn't start the response. Please try again.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          answer += decoder.decode(value, { stream: true });
          updateTargetChat([...nextMessages, { ...assistantMessage, content: answer }]);
        }
        answer += decoder.decode();
      } finally {
        reader.releaseLock();
      }
      if (answer.trim()) {
        updateTargetChat([...nextMessages, { ...assistantMessage, content: answer.trim() }]);
        setConnection("online");
      } else if (!controller.signal.aborted) {
        throw new Error("AURA couldn’t generate a reply just now. Please try again.");
      } else {
        updateTargetChat(nextMessages);
      }
    } catch (caught) {
      const aborted = caught instanceof DOMException && caught.name === "AbortError";
      if (aborted) {
        if (answer.trim()) updateTargetChat([...nextMessages, { ...assistantMessage, content: answer.trim() }]);
        else updateTargetChat(nextMessages);
      } else {
        setConnection("offline");
        const message = caught instanceof Error ? caught.message : "AURA couldn't respond just now.";
        setError(message.includes("Failed to fetch")
          ? "AURA is having trouble connecting. Please try again in a moment."
          : message);
        if (answer.trim()) updateTargetChat([...nextMessages, { ...assistantMessage, content: answer.trim() }]);
        else updateTargetChat(nextMessages);
      }
    } finally {
      if (requestAbortRef.current === controller) requestAbortRef.current = null;
      setStreamingMessageId(null);
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function stopGeneration() {
    requestAbortRef.current?.abort();
  }

  function retryLastMessage() {
    if (!activeChat || busy) return;
    const lastMessage = activeChat.messages[activeChat.messages.length - 1];
    if (!lastMessage || lastMessage.role !== "user") return;
    const prompt = lastMessage.content;
    updateActive(activeChat.messages.slice(0, -1), activeChat.title);
    setDraft(prompt);
    setError("");
    window.setTimeout(() => inputRef.current?.form?.requestSubmit(), 0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  async function deleteChat(id: string) {
    const target = chats.find((chat) => chat.id === id);
    if (!target || deletingChatId) return;
    setDeletingChatId(id);
    setError("");
    // Invalidate any older save callback so it cannot overwrite this operation's status.
    const deleteSyncVersion = supabase ? ++cloudSyncVersionRef.current : cloudSyncVersionRef.current;
    try {
      if (supabase) {
        const cloudClient = supabase;
        // Queue deletion after any in-flight save; subsequent state saves will run after it.
        const queuedDelete = cloudWriteQueueRef.current.catch(() => undefined).then(async () => {
          const { error: cloudError } = await cloudClient.from("aura_chats").delete().eq("id", id).eq("user_id", userId);
          if (cloudError) throw cloudError;
        });
        cloudWriteQueueRef.current = queuedDelete;
        await queuedDelete;
      }
      const remaining = chats.filter((chat) => chat.id !== id);
      const next = remaining.length ? remaining : [starterChat()];
      setChats(next);
      setPinnedChatIds((current) => current.filter((pinnedId) => pinnedId !== id));
      if (activeId === id) setActiveId(next[0].id);
      if (supabase && cloudSyncVersionRef.current === deleteSyncVersion) setCloudSync("saved");
    } catch (caught) {
      console.warn("AURA cloud chat delete failed:", caught);
      if (supabase && cloudSyncVersionRef.current === deleteSyncVersion) setCloudSync("error");
      setError("Couldn't delete this conversation from cloud storage. Your chat is still available; check your connection and retry.");
    } finally {
      setDeletingChatId(null);
    }
  }

  function resetSettingsToDefaults() {
    setPendingRestoreSettings(true);
  }

  function confirmRestoreSettings() {
    setSettings({ ...defaultSettings });
    setPendingRestoreSettings(false);
    setError("");
  }

  function retryCloudSync() {
    if (!supabase) return;
    setCloudLoaded(false);
    setCloudSync("loading");
    setError("");
    setCloudRetryToken((token) => token + 1);
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
        <button className={"nav-item " + (activeProjectFilter === null ? "selected" : "")} onClick={() => { setActiveProjectFilter(null); setSidebarOpen(false); }}><MessageSquare size={17} /> All chats <span className="nav-count">{chats.length}</span></button>
        <div className="projects-sidebar-heading"><span>PROJECTS</span><button type="button" onClick={() => openProjectEditor()} aria-label="Create project" title="Create project"><Plus size={14} /></button></div>
        <div className="projects-sidebar-list">{projects.map((project) => <div className={"project-sidebar-row " + (activeProjectFilter === project.id ? "active" : "")} key={project.id}><button type="button" className="project-sidebar-pick" onClick={() => { setActiveProjectFilter(project.id); if (!chats.some((chat) => chat.projectId === project.id)) { const projectChat = { ...starterChat(), projectId: project.id }; setChats((current) => [projectChat, ...current]); setActiveId(projectChat.id); } setSidebarOpen(false); }}><span className="project-color-dot" /><span>{project.name}</span><small>{chats.filter((chat) => chat.projectId === project.id).length}</small></button><button type="button" className="project-edit-shortcut" onClick={() => openProjectEditor(project)} title={"Edit " + project.name} aria-label={"Edit " + project.name}><Pencil size={12} /></button></div>)}{!projects.length && <p className="projects-empty-hint">Keep chats and instructions organized by project.</p>}</div>
        <button className="nav-item" onClick={() => { setSettingsOpen(true); setSidebarOpen(false); }}><BookOpen size={17} /> Knowledge & persona</button>
        <div className="history-head"><span>RECENT</span><span>{chatSearch.trim() ? `${filteredChats.length}/${sortedChats.length}` : sortedChats.length}</span></div>
        <div className="chat-backup-actions"><button type="button" onClick={exportChats} title="Export all conversations"><Download size={13} /> Export</button><button type="button" onClick={() => chatImportRef.current?.click()} title="Import an AURA JSON backup"><FileUp size={13} /> Import</button><input ref={chatImportRef} type="file" accept="application/json,.json" aria-label="Import chat backup" onChange={(event) => { void importChats(event.target.files?.[0]); }} /></div>
        <input ref={historySearchRef} className="history-search" type="search" aria-label="Search conversations" placeholder="Search chats and messages…" value={chatSearch} onChange={(event) => setChatSearch(event.target.value)} />
        <div className="chat-list">
          {filteredChats.length ? filteredChats.map((chat) => (
            <div key={chat.id} className={`chat-list-row ${chat.id === activeChat?.id ? "active" : ""}`}>
              <button className="chat-pick" onClick={() => { setActiveId(chat.id); setSidebarOpen(false); setError(""); }}>
                <MessageSquare size={15} /><span>{chat.title}</span>
              </button>
              <button className={`pin-chat ${pinnedChatIds.includes(chat.id) ? "pinned" : ""}`} aria-label={(pinnedChatIds.includes(chat.id) ? "Unpin " : "Pin ") + chat.title} title={pinnedChatIds.includes(chat.id) ? "Unpin conversation" : "Pin conversation"} onClick={() => togglePinnedChat(chat.id)}><Pin size={13} /></button>
              <button className="duplicate-chat" aria-label={"Duplicate " + chat.title} title="Duplicate conversation" disabled={deletingChatId !== null} onClick={() => duplicateChat(chat.id)}><CopyPlus size={13} /></button>
              <button className="rename-chat" aria-label={"Rename " + chat.title} title="Rename conversation" disabled={deletingChatId !== null} onClick={() => renameChat(chat.id)}><Pencil size={13} /></button>
              <button className="delete-chat" aria-label={"Delete " + chat.title} title="Delete conversation" disabled={deletingChatId !== null} onClick={() => setPendingDeleteChat(chat)}><Trash2 size={14} /></button>
            </div>
          )) : <div className="chat-search-empty">{chatSearch.trim() ? "No conversations match your search." : "No conversations yet."}</div>}
        </div>
        <div className="sidebar-bottom">
          <div className="profile-orb">A</div>
          <div className="profile-copy"><strong>Your AURA</strong><small>{userEmail}</small></div>
          <button className="icon-button" aria-label="Open settings" title="Settings" onClick={() => setSettingsOpen(true)}><Settings2 size={18} /></button>
          <button className="icon-button" aria-label="Sign out" title="Sign out" onClick={onSignOut}><LogOut size={18} /></button>
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
            {activeChat && <label className="active-project-picker" title="Organize this conversation in a project"><BookOpen size={14} /><select aria-label="Conversation project" value={activeChat.projectId ?? ""} onChange={(event) => moveActiveChatToProject(event.target.value)}><option value="">No project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
            <div className={`connection ${connection}`}><span className="status-dot" />{connection === "online" ? "Model connected" : connection === "offline" ? "Model offline" : "Cloud AI"}</div>
            {!networkOnline && <div className="connection offline" role="status" aria-live="polite"><span className="status-dot" />No internet connection</div>}
            {localSaveWarning && <div className="connection offline storage-warning" role="status" aria-live="polite"><span className="status-dot" />Browser storage is full or unavailable. Export a chat backup to protect recent changes.</div>}
            <div className={`connection ${cloudSync === "error" ? "offline" : cloudSync === "saved" ? "online" : "unknown"}`} role="status" aria-live="polite"><span className="status-dot" />{cloudSync === "loading" ? "Loading history" : cloudSync === "saving" ? "Syncing chats" : cloudSync === "saved" ? "Chats synced" : cloudSync === "local" ? "Browser storage" : "Sync issue"}</div>
            {cloudSync === "error" && supabase && <button className="settings-button" onClick={retryCloudSync}><span>Retry sync</span></button>}
            <button className="settings-button" onClick={() => setSettingsOpen(true)}><Settings2 size={16} /><span>Settings</span></button>
          </div>
        </header>

        <section ref={conversationRef} className="conversation" aria-live="polite">
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
              <div className="conversation-heading"><div className="mini-orb"><Sparkles size={18} /></div><div className="conversation-heading-copy"><h2>{activeChat?.title}</h2><span>{activeChat?.messages.length ?? 0} messages · Synced to your account</span></div>{Boolean(activeChat?.messages.length) && <button className="export-chat-button" type="button" onClick={exportActiveChat} title="Export this conversation as Markdown"><Download size={14} /><span>Export</span></button>}</div>
              {activeChat?.messages.map((message) => (
                <article className={`message-row ${message.role}`} key={message.id}>
                  <div className={`message-avatar ${message.role}`}>{message.role === "assistant" ? <Sparkles size={17} /> : "Y"}</div>
                  <div className="message-body">
                    <div className="message-label"><span>{message.role === "assistant" ? "AURA" : "YOU"}</span><time dateTime={new Date(Number.isFinite(message.createdAt) && Math.abs(message.createdAt) <= 8640000000000000 ? message.createdAt : Date.now()).toISOString()}>{new Date(Number.isFinite(message.createdAt) && Math.abs(message.createdAt) <= 8640000000000000 ? message.createdAt : Date.now()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div>
                    <div className={`message-content ${message.id === streamingMessageId ? "message-streaming" : ""}`}><MarkdownContent content={message.content} /></div>
                    {message.id !== streamingMessageId && <div className="message-actions">
                      <button type="button" onClick={() => { void copyMessage(message.content); }} aria-label={message.role === "assistant" ? "Copy AURA response" : "Copy your message"} title="Copy message"><Copy size={13} /> Copy</button>
                      {message.role === "user" && <button type="button" disabled={busy} onClick={() => editUserMessage(message.id)} title="Edit and resend this message"><Pencil size={13} /> Edit</button>}
                      {message.role === "assistant" && <button type="button" disabled={busy} onClick={() => regenerateFromMessage(message.id)} title="Regenerate this response"><Sparkles size={13} /> Regenerate</button>}
                    </div>}
                  </div>
                </article>
              ))}
              {busy && activeChat?.messages.every((message) => message.id !== streamingMessageId) && <article className="message-row assistant"><div className="message-avatar assistant"><Sparkles size={17} /></div><div className="message-body"><div className="message-label">AURA</div><div className="typing"><span /><span /><span /> <small>Starting</small></div></div></article>}
              <div className="end-spacer" />
            </div>
          )}
        </section>

        <div className="composer-wrap">
          {!networkOnline && <div className="error-banner" role="status"><span>You are offline. Your existing chats remain available; reconnect before sending new messages.</span></div>}
          {error && <div className="error-banner"><span>{error}</span><div className="error-actions">{activeChat?.messages[activeChat.messages.length - 1]?.role === "user" && <button type="button" className="retry-message" disabled={busy} onClick={retryLastMessage}><Zap size={13} /> Retry message</button>}<button aria-label="Dismiss error" onClick={() => setError("")}><X size={15} /></button></div></div>}
          <form className="composer" onSubmit={sendMessage}>
            <textarea ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} placeholder="Message AURA... (Enter to send, Shift + Enter for a new line)" rows={1} aria-label="Message AURA" />
            <div className="composer-bottom"><div className="composer-bottom-tools"><div className="composer-hint"><span className="composer-spark"><Sparkles size={13} /></span><span>Curious by design.</span></div><button className="prompt-library-trigger" type="button" onClick={() => setPromptLibraryOpen(true)} title="Open reusable prompt library"><BookOpen size={14} /><span>Prompt library</span></button></div>{busy ? <button className="send-button stop-generation-button" type="button" onClick={stopGeneration} aria-label="Stop generation"><span className="stop-generation-square" /><span>Stop</span></button> : <button className="send-button" type="submit" disabled={!draft.trim()} aria-label="Send message"><Send size={17} /><span>Send</span></button>}</div>
          </form>
          <p className="disclaimer">AURA can make mistakes. Verify important information. Your chats sync to your account.</p>
        </div>
      </main>

      {pendingDeleteChat && (
        <div className="modal-backdrop delete-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deletingChatId) setPendingDeleteChat(null); }}>
          <section className="delete-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title" aria-describedby="delete-confirm-description">
            <div className="delete-confirm-icon"><Trash2 size={20} /></div>
            <div className="delete-confirm-kicker">PERMANENT ACTION</div>
            <h2 id="delete-confirm-title">Delete this conversation?</h2>
            <p id="delete-confirm-description">“{pendingDeleteChat.title}” will be removed from your workspace and synced chat history. This action can’t be undone.</p>
            <div className="delete-confirm-actions">
              <button type="button" className="delete-confirm-cancel" disabled={deletingChatId !== null} onClick={() => setPendingDeleteChat(null)}>Cancel</button>
              <button type="button" className="delete-confirm-submit" disabled={deletingChatId !== null} onClick={async () => { await deleteChat(pendingDeleteChat.id); setPendingDeleteChat(null); }}>
                <Trash2 size={14} /> {deletingChatId ? "Deleting…" : "Delete conversation"}
              </button>
            </div>
          </section>
        </div>
      )}

      {pendingRenameChat && (
        <div className="modal-backdrop app-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setPendingRenameChat(null); setRenameDraft(""); } }}>
          <section className="app-dialog-modal" role="dialog" aria-modal="true" aria-labelledby="rename-dialog-title">
            <div className="app-dialog-icon"><Pencil size={19} /></div>
            <div className="app-dialog-kicker">CONVERSATION SETTINGS</div>
            <h2 id="rename-dialog-title">Rename conversation</h2>
            <p>Give this conversation a name that’s easy to recognize later.</p>
            <form onSubmit={(event) => { event.preventDefault(); saveRenamedChat(); }}>
              <label className="app-dialog-label" htmlFor="rename-conversation-input">Conversation name</label>
              <input id="rename-conversation-input" className="app-dialog-input" autoFocus maxLength={80} value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} placeholder="Enter a conversation name" />
              <div className="app-dialog-actions">
                <button type="button" className="app-dialog-secondary" onClick={() => { setPendingRenameChat(null); setRenameDraft(""); }}>Cancel</button>
                <button type="submit" className="app-dialog-primary" disabled={!renameDraft.trim()}>Save name</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {pendingRestoreSettings && (
        <div className="modal-backdrop app-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingRestoreSettings(false); }}>
          <section className="app-dialog-modal" role="dialog" aria-modal="true" aria-labelledby="restore-dialog-title" aria-describedby="restore-dialog-description">
            <div className="app-dialog-icon restore"><Settings2 size={19} /></div>
            <div className="app-dialog-kicker">RESET PREFERENCES</div>
            <h2 id="restore-dialog-title">Restore default settings?</h2>
            <p id="restore-dialog-description">AURA’s model and personality instructions will return to their defaults. Your Knowledge Vault documents and chat history will stay unchanged.</p>
            <div className="app-dialog-actions">
              <button type="button" className="app-dialog-secondary" onClick={() => setPendingRestoreSettings(false)}>Cancel</button>
              <button type="button" className="app-dialog-primary" onClick={confirmRestoreSettings}>Restore defaults</button>
            </div>
          </section>
        </div>
      )}

      {projectModalOpen && (
        <div className="modal-backdrop project-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProjectModalOpen(false); }}>
          <section className="project-editor-modal" role="dialog" aria-modal="true" aria-labelledby="project-editor-title">
            <header className="modal-header"><div><div className="modal-kicker">A DEDICATED SPACE FOR YOUR WORK</div><h2 id="project-editor-title">{editingProjectId ? "Edit project" : "Create a project"}</h2><p>Give a workspace its own goal and instructions. Chats inside it will use this context.</p></div><button className="icon-button" type="button" onClick={() => setProjectModalOpen(false)} aria-label="Close project editor"><X size={19} /></button></header>
            <form className="project-editor-form" onSubmit={saveProject}>
              <label>Project name<input value={projectNameDraft} onChange={(event) => setProjectNameDraft(event.target.value)} maxLength={60} placeholder="e.g. AURA website build" required /></label>
              <label>Goal or description<textarea value={projectDescriptionDraft} onChange={(event) => setProjectDescriptionDraft(event.target.value)} maxLength={180} rows={2} placeholder="What are you trying to accomplish?" /></label>
              <label>Project instructions<textarea value={projectInstructionsDraft} onChange={(event) => setProjectInstructionsDraft(event.target.value)} maxLength={5000} rows={5} placeholder="Tell AURA the project background, constraints, preferred stack, decisions already made, and how to help." /></label>
              <p className="project-editor-note">Project instructions are included when you chat inside this project. Your existing conversations are preserved if you delete a project.</p>
              <footer className="project-editor-actions">{editingProjectId && <button type="button" className="project-delete-action" onClick={() => deleteProject(editingProjectId)}><Trash2 size={14} /> Delete project</button>}<span /><button type="button" className="project-cancel-action" onClick={() => setProjectModalOpen(false)}>Cancel</button><button type="submit" className="project-save-action"><Check size={14} /> {editingProjectId ? "Save changes" : "Create project"}</button></footer>
            </form>
          </section>
        </div>
      )}

      {promptLibraryOpen && (
        <div className="modal-backdrop prompt-library-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPromptLibraryOpen(false); }}>
          <section className="prompt-library-modal" role="dialog" aria-modal="true" aria-labelledby="prompt-library-title">
            <header className="modal-header"><div><div className="modal-kicker">YOUR REUSABLE TOOLKIT</div><h2 id="prompt-library-title">Prompt library</h2><p>Start with a proven prompt or save your own workflow for later.</p></div><button className="icon-button" type="button" onClick={() => setPromptLibraryOpen(false)} aria-label="Close prompt library"><X size={19} /></button></header>
            <div className="prompt-library-content">
              <input className="history-search prompt-library-search" type="search" value={promptSearch} onChange={(event) => setPromptSearch(event.target.value)} placeholder="Search prompts, categories, and instructions…" aria-label="Search prompt library" />
              <div className="prompt-library-grid">
                {filteredPrompts.map((item) => <article className="prompt-template-card" key={item.id}>
                  <div className="prompt-template-top"><span className="prompt-category">{item.category}</span>{customPrompts.some((saved) => saved.id === item.id) && <button className="prompt-delete" type="button" onClick={() => deleteCustomPrompt(item.id)} aria-label={"Delete " + item.title} title="Delete saved prompt"><Trash2 size={13} /></button>}</div>
                  <h3>{item.title}</h3><p>{item.description}</p><div className="prompt-template-preview">{item.prompt.length > 170 ? item.prompt.slice(0, 170) + "…" : item.prompt}</div>
                  <button className="prompt-use-button" type="button" onClick={() => usePromptTemplate(item)}><Plus size={14} /> Use prompt</button>
                </article>)}
                {!filteredPrompts.length && <div className="prompt-library-empty">No prompts match that search. Try another keyword or save a new prompt below.</div>}
              </div>
              <form className="save-prompt-form" onSubmit={saveCustomPrompt}>
                <div className="save-prompt-heading"><div><h3>Save your own prompt</h3><p>Build a reusable workflow that fits the way you work.</p></div><span>{customPrompts.length} saved</span></div>
                <div className="save-prompt-fields"><label>Prompt name<input value={promptTitleDraft} onChange={(event) => setPromptTitleDraft(event.target.value)} maxLength={60} placeholder="e.g. AURA project planner" required /></label><label>Category<input value={promptCategoryDraft} onChange={(event) => setPromptCategoryDraft(event.target.value)} maxLength={24} placeholder="Custom" /></label></div>
                <label className="save-prompt-instruction">Instructions<textarea value={promptTextDraft} onChange={(event) => setPromptTextDraft(event.target.value)} maxLength={6000} rows={4} placeholder="Write the reusable instructions AURA should start with…" required /></label>
                <div className="save-prompt-footer"><span>Saved privately in this browser for this signed-in account.</span><button type="submit" disabled={!promptTitleDraft.trim() || !promptTextDraft.trim()}><Plus size={14} /> Save prompt</button></div>
              </form>
            </div>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <header className="modal-header"><div><div className="modal-kicker">PERSONALIZE YOUR EXPERIENCE</div><h2 id="settings-title">AURA settings</h2><p>Shape how AURA thinks, responds, and uses your context.</p></div><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={19} /></button></header>
            <div className="settings-body">
              <section className="account-settings-section" aria-labelledby="account-settings-title">
                <div className="account-settings-heading">
                  <div className="account-settings-avatar" aria-hidden="true">{(userEmail.trim()[0] || "U").toUpperCase()}</div>
                  <div className="account-settings-heading-copy">
                    <span className="field-label" id="account-settings-title">User account</span>
                    <p className="field-help">Your signed-in AURA identity and account access.</p>
                  </div>
                  <span className="account-status"><span /> Signed in</span>
                </div>
                <div className="account-settings-details">
                  <div className="account-detail-row">
                    <span className="account-detail-label">Email address</span>
                    <strong>{userEmail || "Email unavailable"}</strong>
                  </div>
                  <div className="account-detail-row">
                    <span className="account-detail-label">Account ID</span>
                    <strong className="account-id-value" title={userId}>{userId}</strong>
                  </div>
                </div>
                <button type="button" className="account-settings-signout" onClick={onSignOut}><LogOut size={15} /> Sign out of AURA</button>
              </section>
              <div className="field-divider" />
              <div className="settings-tools"><span className="field-help">Changes save automatically for this account on this browser.</span><button type="button" className="settings-reset" onClick={resetSettingsToDefaults}>Restore defaults</button></div>
              <div className="field-divider" />
              <label className="field-label" htmlFor="personality">Personality instructions</label><textarea id="personality" className="field-textarea" rows={5} value={settings.personality} onChange={(event) => setSettings((old) => ({ ...old, personality: event.target.value }))} placeholder="Tell AURA how to behave..." />
              <label className="field-label" htmlFor="knowledge">Personal knowledge notes</label><textarea id="knowledge" className="field-textarea" rows={5} value={settings.knowledge} onChange={(event) => setSettings((old) => ({ ...old, knowledge: event.target.value }))} placeholder="Add your goals, preferences, project context, or notes that AURA should use..." />
              <div className="vault-heading"><div><span className="field-label">Knowledge Vault</span><p className="field-help">Upload notes that AURA can search for relevant context.</p></div><span className="vault-count">{knowledgeDocs.length}/{MAX_KNOWLEDGE_DOCS}</span></div>
              <input ref={fileInputRef} className="vault-file-input" type="file" accept=".txt,.md,.csv,.json,.pdf,text/plain,text/markdown,text/csv,application/json,application/pdf" multiple onChange={(event) => { void addKnowledgeFiles(event.target.files); }} aria-label="Upload knowledge files" />
              <button className="vault-upload" type="button" disabled={knowledgeDocs.length >= MAX_KNOWLEDGE_DOCS} onClick={() => fileInputRef.current?.click()}><Upload size={16} /><span>Add documents</span><small>TXT · MD · CSV · JSON · PDF</small></button>
              {uploadError && <div className="vault-error" role="status">{uploadError}</div>}
              {knowledgeDocs.length > 0 ? <div className="vault-list">{knowledgeDocs.map((doc) => <div className="vault-item" key={doc.id}><span className="vault-file-icon"><FileText size={16} /></span><span className="vault-file-copy"><strong>{doc.name}</strong><small>{doc.content.length.toLocaleString()} characters · stored in this browser</small></span><button className="delete-chat vault-delete" type="button" aria-label={"Remove " + doc.name} title="Remove document" onClick={() => removeKnowledgeDocument(doc.id)}><Trash2 size={14} /></button></div>)}</div> : <div className="vault-empty">No documents added yet.</div>}
              <div className="field-help">Files stay in this browser. AURA selects up to 3 relevant excerpts per question; uploaded files are not sent in full with every message. Text files max 100 KB; PDFs max 5 MB, 80 pages and 20,000 extracted characters. Scanned PDFs and Word files are not supported.</div>
              <div className="field-help">These notes are added to your prompt when you chat. Keep sensitive information out of local notes on shared computers.</div>
            </div>
            <footer className="modal-footer"><span><Check size={14} /> Saved automatically in this browser</span><button className="primary-button" onClick={() => setSettingsOpen(false)}>Done <Check size={15} /></button></footer>
          </section>
        </div>
      )}
    </div>
  );
}