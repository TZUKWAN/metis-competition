import { useEffect, useRef, useState } from "react";
import { api, OUTPUT_LABELS, type ChatMessage, type ProjectState } from "../api";
import { Markdown } from "../markdown";

interface Props {
  projectId: string;
  state: ProjectState | null;
  messages: ChatMessage[];
  onMessagesChanged: () => void;
}

const TOOL_ICONS: Record<string, string> = {
  research: "🔍",
  demo: "🧩",
  demo_test: "🧪",
  capture: "📸",
  diagrams: "📐",
  images: "🖼",
  video: "🎬",
  business_plan: "📄",
  ppt: "📊",
  patent: "⚖️",
  copyright: "©️",
  qa_consistency: "✅",
  defense: "🎤",
  deliver: "📦",
  rules: "📋",
};

function ToolBlock({ msg }: { msg: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const statusText =
    msg.status === "running"
      ? "进行中…"
      : msg.status === "done"
        ? `已完成${msg.detail ? ` · ${msg.detail}` : ""}`
        : msg.status === "failed"
          ? "失败"
          : msg.status === "skipped"
            ? `已跳过${msg.detail ? ` · ${msg.detail}` : ""}`
            : "";
  const dot =
    msg.status === "done"
      ? "bg-emerald-500"
      : msg.status === "running"
        ? "bg-blue-500 animate-pulse"
        : msg.status === "failed"
          ? "bg-red-500"
          : "bg-slate-300";
  return (
    <div className="my-1.5 w-full max-w-xl overflow-hidden rounded-lg border border-slate-200 bg-slate-50/70 text-sm">
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen(!open)}>
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <span>{TOOL_ICONS[msg.task ?? ""] ?? "🔧"}</span>
        <span className="flex-1 truncate text-slate-700">{msg.title ?? msg.task}</span>
        <span className={`shrink-0 text-xs ${msg.status === "failed" ? "text-red-500" : "text-slate-400"}`}>{statusText}</span>
        {msg.detail && msg.status !== "done" && msg.status !== "skipped" && (
          <span className="shrink-0 text-slate-300">{open ? "▾" : "▸"}</span>
        )}
      </button>
      {open && msg.detail && (
        <div className="border-t border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 whitespace-pre-wrap break-all">
          {msg.detail}
        </div>
      )}
    </div>
  );
}

function SelectorCard({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [checked, setChecked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const toggle = (key: string) =>
    setChecked((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  const confirm = async () => {
    setBusy(true);
    try {
      await api.selectOutputs(projectId, checked);
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="my-2 w-full max-w-xl rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2.5 text-sm font-medium text-slate-700">选择要制作的成果（可多选）</div>
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(OUTPUT_LABELS).map(([key, label]) => (
          <label
            key={key}
            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
              checked.includes(key) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 hover:bg-slate-50"
            }`}
          >
            <input type="checkbox" className="accent-blue-600" checked={checked.includes(key)} onChange={() => toggle(key)} />
            {label}
          </label>
        ))}
      </div>
      <button
        onClick={() => void confirm()}
        disabled={busy || checked.length === 0}
        className="mt-3 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
      >
        {busy ? "…" : "继续"}
      </button>
    </div>
  );
}

/** 中栏：AI 对话。聊天是唯一主要操作入口。 */
export default function ChatView({ projectId, state, messages, onMessagesChanged }: Props) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    try {
      // 当前打开的成果作为上下文（简化：根据最近预览不再追踪，仅当用户从右栏进入预览时传入）
      const context = state?.project.onboarding?.step && state.project.onboarding.step !== "done" ? undefined : currentContext();
      await api.sendChat(projectId, text, context);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
      onMessagesChanged();
    }
  };

  // 最近查看的成果作为聊天上下文（App 通过 window 变量简化传递）
  const currentContext = (): { type?: string; artifact?: string; page?: number } | undefined => {
    const w = window as unknown as { __metisContext?: { type: string; artifact?: string; page?: number } };
    return w.__metisContext;
  };

  const handleFile = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/projects/${projectId}/upload`, { method: "POST", body: form });
    if (!res.ok) {
      alert(`上传失败：HTTP ${res.status}`);
      return;
    }
    setSending(true);
    try {
      await api.sendChat(projectId, `我上传了一份材料：${file.name}`, undefined);
      if (/\.pptx$/i.test(file.name)) {
        await api.addOutputs(projectId, ["ppt"]);
      }
    } finally {
      setSending(false);
      onMessagesChanged();
    }
  };

  const showSelector = state?.project.onboarding?.step === "select";

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <div className="min-w-0 truncate text-sm font-medium text-slate-700">{state?.project.name ?? ""}</div>
        {state?.auto_running && (
          <div className="flex items-center gap-1.5 text-xs text-blue-600">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
            正在生成…
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {messages.length === 0 && !showSelector && (
          <div className="mt-20 text-center">
            <div className="text-lg font-semibold text-slate-700">METIS Competition</div>
            <div className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">
              把你的比赛项目想法告诉我，我会帮你从想法逐步做成可以提交和路演的完整成果。
            </div>
          </div>
        )}
        {messages.map((m, i) => {
          if (m.kind === "tool") return <ToolBlock key={i} msg={m} />;
          if (m.role === "user")
            return (
              <div key={i} className="my-2 flex justify-end">
                <div className="max-w-[75%] rounded-2xl rounded-br-md bg-blue-600 px-3.5 py-2 text-sm text-white whitespace-pre-wrap break-words">
                  {m.content}
                </div>
              </div>
            );
          return (
            <div key={i} className="my-2 flex justify-start">
              <div className="max-w-[85%] text-sm leading-6 text-slate-700">
                <Markdown text={m.content ?? ""} />
              </div>
            </div>
          );
        })}
        {showSelector && <SelectorCard projectId={projectId} onDone={onMessagesChanged} />}
        {sending && (
          <div className="my-2 flex items-center gap-1.5 text-xs text-slate-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
            思考中…
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="border-t border-slate-100 p-3">
        <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-white p-2 focus-within:border-blue-400">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void handleFile(f);
            }}
          />
          <button
            title="上传材料（比赛通知 / PPT 模板 / 团队资料等）"
            className="shrink-0 rounded-lg px-2 py-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            onClick={() => fileRef.current?.click()}
          >
            📎
          </button>
          <textarea
            className="max-h-32 min-h-[38px] flex-1 resize-none bg-transparent px-1.5 py-1.5 text-sm outline-none placeholder:text-slate-300"
            placeholder="描述你的想法，或告诉我要调整什么…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            onClick={() => void send()}
            disabled={sending || !input.trim()}
            className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
          >
            发送
          </button>
        </div>
        <div className="mt-1 px-1 text-[11px] text-slate-300">Enter 发送 · Shift+Enter 换行 · 生成进展会实时显示在对话中</div>
      </div>
    </div>
  );
}
