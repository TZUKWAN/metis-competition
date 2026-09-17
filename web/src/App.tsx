import { useCallback, useEffect, useState } from "react";
import { api, type ChatMessage, type Project, type ProjectState } from "./api";
import ProjectList from "./components/ProjectList";
import ChatView from "./components/ChatView";
import ArtifactsPanel from "./components/ArtifactsPanel";
import SettingsDialog from "./components/SettingsDialog";
import { ArtifactPreview, type PreviewKind } from "./components/previews";

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [state, setState] = useState<ProjectState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [overlay, setOverlay] = useState<PreviewKind | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const refreshProjects = useCallback(() => {
    return api
      .listProjects()
      .then((r) => {
        setProjects(r.projects);
        // 刷新/重开后自动选中上次的项目（localStorage 记忆），没有记录则选最近一个
        setCurrentId((cur) => {
          if (cur && r.projects.some((p) => p.project_id === cur)) return cur;
          const last = localStorage.getItem("metis:lastProject");
          if (last && r.projects.some((p) => p.project_id === last)) return last;
          return r.projects[r.projects.length - 1]?.project_id ?? null;
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  // 记住当前选择的项目
  useEffect(() => {
    if (currentId) localStorage.setItem("metis:lastProject", currentId);
  }, [currentId]);

  const refreshState = useCallback(() => {
    if (!currentId) return;
    api
      .getState(currentId)
      .then(setState)
      .catch(() => {});
    api
      .getChat(currentId)
      .then((r) => setMessages(r.messages))
      .catch(() => {});
  }, [currentId]);

  // 轮询：任务/成果状态 + 聊天记录（编排器把生成进展写进聊天记录）
  useEffect(() => {
    refreshState();
    const timer = setInterval(refreshState, 2500);
    return () => clearInterval(timer);
  }, [refreshState]);

  const handleCreated = (id: string) => {
    void refreshProjects();
    setCurrentId(id);
  };

  const handleDeleted = (id: string) => {
    void refreshProjects();
    if (currentId === id) setCurrentId(null);
  };

  const handleOpenPreview = (kind: PreviewKind) => {
    setOverlay(kind);
    // 记录最近查看的成果，作为聊天上下文（§26）
    const w = window as unknown as { __metisContext?: { type: string; artifact?: string; page?: number } };
    w.__metisContext = { type: kind };
  };

  const closeOverlay = () => {
    setOverlay(null);
  };

  const currentProject = projects.find((p) => p.project_id === currentId);

  return (
    <div className="flex h-screen flex-col bg-white text-slate-800">
      {/* 顶栏 */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 px-4">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-slate-800">METIS Competition</span>
          <span className="hidden text-xs text-slate-400 sm:inline">大学生竞赛团队全链路生产平台</span>
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          ⚙ 设置
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <ProjectList
          projects={projects}
          currentId={currentId}
          onSelect={(id) => {
            setCurrentId(id);
            setOverlay(null);
          }}
          onCreated={handleCreated}
          onRenamed={refreshProjects}
          onDeleted={handleDeleted}
        />

        {currentId && currentProject ? (
          <>
            <ChatView
              projectId={currentId}
              state={state}
              messages={messages}
              onMessagesChanged={refreshState}
            />
            {!rightCollapsed && (
              <ArtifactsPanel
                projectId={currentId}
                state={state}
                onOpenPreview={handleOpenPreview}
                onOutputsChanged={refreshState}
              />
            )}
            <button
              className="w-4 shrink-0 border-l border-slate-100 bg-slate-50 text-[10px] text-slate-300 hover:bg-slate-100 hover:text-slate-500"
              title={rightCollapsed ? "展开生成物" : "折叠生成物"}
              onClick={() => setRightCollapsed(!rightCollapsed)}
            >
              {rightCollapsed ? "◀" : "▶"}
            </button>
          </>
        ) : (
          /* 空状态：第一次打开，没有项目 */
          <div className="flex min-w-0 flex-1 items-center justify-center bg-white">
            <div className="text-center">
              <div className="text-2xl font-semibold text-slate-800">METIS Competition</div>
              <div className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-400">
                把你的比赛项目想法告诉我，我会帮你从想法逐步做成可以提交和路演的完整成果。
              </div>
              <button
                onClick={async () => {
                  const { project } = await api.createProject();
                  handleCreated(project.project_id);
                }}
                className="mt-6 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                新建项目
              </button>
            </div>
          </div>
        )}
      </div>

      {overlay && currentId && <ArtifactPreview kind={overlay} projectId={currentId} onClose={closeOverlay} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
