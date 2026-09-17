export interface Project {
  project_id: string;
  name: string;
  summary: string;
  project_type: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface TreeEntry {
  path: string;
  type: "file" | "dir";
}

export interface TaskItem {
  id: string;
  status: string;
}

export interface ProjectDetail {
  project: Project;
  tasks: TaskItem[];
  tree: TreeEntry[];
}

export interface ChatMessage {
  role: string;
  content: string;
  at?: string;
}

export interface CreateProjectInput {
  name: string;
  summary: string;
  project_type: string;
  competition_name?: string;
  track?: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      // ignore
    }
    throw new Error(`HTTP ${res.status}${detail ? `：${detail}` : ""}`);
  }
  return (await res.json()) as T;
}

export const api = {
  listProjects: () => request<{ projects: Project[] }>("/api/projects"),

  createProject: (body: CreateProjectInput) =>
    request<{ project: Project }>("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  getProject: (id: string) => request<ProjectDetail>(`/api/projects/${id}`),

  // 服务端返回 { facts: [...] }（GET /api/projects/:id/facts），此处解包
  getFacts: async (id: string): Promise<unknown[]> => {
    const res = await request<{ facts: unknown[] }>(`/api/projects/${id}/facts`);
    return Array.isArray(res) ? res : (res.facts ?? []);
  },

  getChat: (id: string) => request<{ messages: ChatMessage[] }>(`/api/projects/${id}/chat`),

  getFile: async (id: string, path: string): Promise<string> => {
    const res = await fetch(`/api/projects/${id}/file?path=${encodeURIComponent(path)}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}：无法读取 ${path}`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = (await res.json()) as { content?: unknown };
      return typeof data.content === "string" ? data.content : JSON.stringify(data.content ?? null, null, 2);
    }
    return res.text();
  },

  sendChat,
};

export function fileUrl(projectId: string, path: string): string {
  const clean = path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `/files/${encodeURIComponent(projectId)}${clean ? `/${clean}` : ""}`;
}

/**
 * POST /api/projects/:id/chat 返回 SSE 流（data: {...}\n\n）。
 * 兼容两种字段：优先累加 delta 逐字显示，流结束时若有 message 则作为完整回复。
 */
export async function sendChat(
  projectId: string,
  message: string,
  onPartial: (text: string) => void,
): Promise<string> {
  const res = await fetch(`/api/projects/${projectId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}：对话请求失败`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let acc = "";
  let finalMessage: string | null = null;

  const handleChunk = (raw: string) => {
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const json = JSON.parse(data) as { delta?: unknown; message?: unknown };
        if (typeof json.delta === "string") {
          acc += json.delta;
          onPartial(acc);
        }
        if (typeof json.message === "string") {
          finalMessage = json.message;
        }
      } catch {
        // 非 JSON 数据，忽略
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let idx = buffer.indexOf("\n\n");
    while (idx >= 0) {
      handleChunk(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
      idx = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) handleChunk(buffer);

  const finalText = finalMessage ?? acc;
  onPartial(finalText);
  return finalText;
}

export function fmtTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}
