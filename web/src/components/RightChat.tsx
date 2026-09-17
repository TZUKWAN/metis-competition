import { useEffect, useRef, useState } from "react";
import { api, fmtTime, type ChatMessage, type TaskItem } from "../api";

const STATUS_META: Record<string, { label: string; dot: string }> = {
  waiting: { label: "等待", dot: "bg-slate-300" },
  running: { label: "运行中", dot: "bg-blue-500 animate-pulse" },
  done: { label: "完成", dot: "bg-emerald-500" },
  failed: { label: "失败", dot: "bg-red-500" },
  needs_input: { label: "需输入", dot: "bg-amber-500" },
};

interface Props {
  projectId: string | null;
  tasks: TaskItem[];
}

function Bubble({ role, content, at, streaming }: { role: string; content: string; at?: string; streaming?: boolean }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[92%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm leading-6 ${
          isUser ? "bg-blue-600 text-white" : "border border-slate-200 bg-white text-slate-700"
        }`}
      >
        {content}
        {streaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-blue-400 align-middle" />}
        {at && <div className={`mt-1 text-[10px] ${isUser ? "text-blue-200" : "text-slate-300"}`}>{fmtTime(at)}</div>}
      </div>
    </div>
  );
}

export default function RightChat({ projectId, tasks }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectId) {
      setMessages([]);
      return;
    }
    let alive = true;
    api
      .getChat(projectId)
      .then(({ messages: list }) => {
        if (alive) setMessages(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId]);

  // 新消息 / 流式输出时自动滚动到底部
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const send = async () => {
    const text = input.trim();
    if (!text || !projectId || sending) return;
    setInput("");
    setSending(true);
    setMessages((ms) => [...ms, { role: "user", content: text, at: new Date().toISOString() }]);
    setStreaming("");
    try {
      const finalText = await api.sendChat(projectId, text, (partial) => setStreaming(partial));
      setStreaming(null);
      setMessages((ms) => [...ms, { role: "assistant", content: finalText, at: new Date().toISOString() }]);
    } catch (e) {
      setStreaming(null);
      setMessages((ms) => [
        ...ms,
        { role: "assistant", content: `（请求失败）${e instanceof Error ? e.message : String(e)}`, at: new Date().toISOString() },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-200 px-3 py-2">
        <div className="mb-1.5 text-xs font-medium text-slate-500">任务状态</div>
        <div className="max-h-36 space-y-1 overflow-y-auto pr-1">
          {tasks.length === 0 && <p className="text-xs text-slate-400">暂无任务</p>}
          {tasks.map((t) => {
            const meta = STATUS_META[t.status] ?? { label: t.status, dot: "bg-slate-300" };
            return (
              <div key={t.id} className="flex items-center gap-2 text-xs text-slate-600">
                <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                <span className="truncate">{t.id}</span>
                <span className="ml-auto shrink-0 text-slate-400">{meta.label}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && streaming === null && (
          <p className="mt-6 text-center text-xs leading-5 text-slate-400">
            向 Agent 描述你的需求，
            <br />
            例如：请帮我解析比赛规则
          </p>
        )}
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} content={m.content} at={m.at} />
        ))}
        {streaming !== null && <Bubble role="assistant" content={streaming} streaming />}
      </div>
      <div className="border-t border-slate-200 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={projectId ? "输入消息，Enter 发送，Shift+Enter 换行" : "请先选择项目"}
            disabled={!projectId || sending}
            className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-50"
          />
          <button
            onClick={() => void send()}
            disabled={!projectId || sending || !input.trim()}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
