export interface Project {
  project_id: string;
  name: string;
  summary: string;
  project_type: string;
  status: string;
  created_at: string;
  updated_at: string;
  selected_outputs?: string[];
  onboarding?: OnboardingState;
}

export type OnboardingStep = "select" | "q1_market" | "q2_outcome" | "q3_business" | "q4_resources" | "q5_university" | "summarize" | "done";

export interface OnboardingState {
  step: OnboardingStep;
  completed?: boolean;
  market_and_customer?: string;
  desired_outcome?: string;
  business_model?: string;
  existing_resources?: string;
  university?: string;
}

export type ArtifactStatus = "pending" | "running" | "done" | "attention";

export interface TaskItem {
  id: string;
  status: string;
}

export interface ProjectState {
  project: Project;
  tasks: TaskItem[];
  artifact_status: Record<string, ArtifactStatus>;
  auto_running: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content?: string;
  at?: string;
  kind?: "tool" | "selector";
  task?: string;
  status?: "running" | "done" | "failed" | "skipped";
  title?: string;
  detail?: string;
}

export interface DirEntry {
  name: string;
  type: "file" | "dir";
  size?: number;
}

export interface AssetItem {
  id: string;
  type: string;
  path: string;
  title: string;
  description: string;
  tags: string[];
}

export interface SettingsShape {
  llm: { base: string; key: string; model: string };
  search: { provider: string; key: string };
  image: { base: string; key: string; model: string };
  video: { base: string; key: string; model: string };
  prompts: Record<string, string>;
  skills_disabled: string[];
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  source: string;
  file: string;
  enabled: boolean;
}

export interface PromptInfo {
  key: string;
  name: string;
  description: string;
  source: string;
  override: string;
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

export function fileUrl(projectId: string, path: string): string {
  return `/files/${projectId}/${path}`;
}

export const OUTPUT_LABELS: Record<string, string> = {
  business_plan: "商业计划书",
  ppt: "路演 PPT",
  demo: "产品 Demo",
  patent: "专利材料",
  copyright: "软件著作权",
};

export const ARTIFACT_STATUS_LABELS: Record<ArtifactStatus, string> = {
  pending: "未开始",
  running: "生成中",
  done: "已生成",
  attention: "需要处理",
};

export const api = {
  listProjects: () => request<{ projects: Project[] }>("/api/projects"),

  createProject: () =>
    request<{ project: Project }>("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),

  renameProject: (id: string, name: string) =>
    request<{ project: Project }>(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),

  deleteProject: (id: string) => request<{ deleted: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),

  getState: (id: string): Promise<ProjectState> => request<ProjectState>(`/api/projects/${id}/state`),

  selectOutputs: (id: string, outputs: string[]) =>
    request<{ selected: string[] }>(`/api/projects/${id}/onboarding/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outputs }),
    }),

  addOutputs: (id: string, outputs: string[]) =>
    request<{ ok?: boolean }>(`/api/projects/${id}/outputs/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outputs }),
    }),

  getChat: (id: string) => request<{ messages: ChatMessage[] }>(`/api/projects/${id}/chat`),

  sendChat: async (id: string, message: string, context: { type?: string; artifact?: string; page?: number } | undefined): Promise<string> => {
    const res = await fetch(`/api/projects/${id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ message, context }),
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}：对话请求失败`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let acc = "";
    let finalMessage: string | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let idx = buffer.indexOf("\n\n");
      while (idx >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of chunk.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const json = JSON.parse(data) as { delta?: string; message?: string };
            if (typeof json.delta === "string") acc += json.delta;
            if (typeof json.message === "string") finalMessage = json.message;
          } catch {
            // 忽略非 JSON 行
          }
        }
        if (typeof finalMessage === "string") acc = finalMessage;
      }
    }
    return finalMessage ?? acc;
  },

  readFile: async (id: string, path: string): Promise<string> => {
    const res = await fetch(`/api/projects/${id}/file?path=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}：无法读取 ${path}`);
    return (await res.json()).content as string;
  },

  listDir: (id: string, path: string): Promise<{ path: string; entries: DirEntry[] }> =>
    request<{ path: string; entries: DirEntry[] }>(
      `/api/projects/${id}/dir?path=${encodeURIComponent(path)}`,
    ),

  getAssets: (id: string): Promise<{ assets: AssetItem[] }> => request(`/api/projects/${id}/assets`),

  runTask: (id: string, task: string) => request<{ task: string }>(`/api/projects/${id}/run/${task}`, { method: "POST" }),

  getSettings: () => request<{ settings: SettingsShape }>("/api/settings"),

  saveSettings: (patch: Partial<SettingsShape>) =>
    request<{ settings: SettingsShape }>("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),

  testSetting: (kind: string, config: Record<string, string>) =>
    request<{ ok: boolean; detail: string }>("/api/settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, config }),
    }),

  getSkills: () => request<{ skills: SkillInfo[] }>("/api/skills"),

  getPrompts: () => request<{ prompts: PromptInfo[] }>("/api/prompts"),
};
