import { useEffect, useState } from "react";
import { api, type CreateProjectInput, type Project, type ProjectDetail } from "./api";
import type { NodeKey } from "./nodes";
import LeftTree from "./components/LeftTree";
import CenterView from "./components/CenterView";
import RightChat from "./components/RightChat";
import NewProjectDialog from "./components/NewProjectDialog";

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [node, setNode] = useState<NodeKey>("overview");
  const [showNew, setShowNew] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    api
      .listProjects()
      .then(({ projects: list }) => {
        setProjects(list);
        setCurrentId((cur) => cur ?? list[0]?.project_id ?? null);
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  // 拉取项目详情（任务 + 文件树），每 5 秒轮询以刷新任务状态
  useEffect(() => {
    if (!currentId) {
      setDetail(null);
      return;
    }
    let alive = true;
    const load = () => {
      api
        .getProject(currentId)
        .then((d) => {
          if (alive) setDetail(d);
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [currentId]);

  const handleCreate = async (input: CreateProjectInput) => {
    const { project } = await api.createProject(input);
    const list = await api.listProjects();
    setProjects(list.projects);
    setCurrentId(project.project_id);
    setNode("overview");
    setShowNew(false);
  };

  return (
    <div className="flex h-screen flex-col bg-white text-slate-800">
      <header className="flex h-12 shrink-0 items-center border-b border-slate-200 bg-white px-4">
        <div className="text-sm font-bold tracking-wide text-slate-900">
          METIS <span className="text-blue-600">Competition</span>
        </div>
        <div className="ml-3 hidden text-xs text-slate-400 sm:block">大学生竞赛团队全链路生产平台</div>
        {detail && <div className="ml-auto truncate text-xs text-slate-500">当前项目：{detail.project.name}</div>}
      </header>
      {loadError && (
        <div className="shrink-0 bg-red-50 px-4 py-1.5 text-xs text-red-600">
          无法连接后端 API（{loadError}），请确认 server 已在 8787 端口启动。
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <aside className="w-[260px] shrink-0 border-r border-slate-200 bg-slate-50">
          <LeftTree
            projects={projects}
            currentId={currentId}
            activeNode={node}
            onSelectProject={setCurrentId}
            onSelectNode={setNode}
            onNewProject={() => setShowNew(true)}
          />
        </aside>
        <main className="min-w-0 flex-1 bg-white">
          <CenterView projectId={currentId} project={detail?.project ?? null} tree={detail?.tree ?? []} nodeKey={node} />
        </main>
        <aside className="flex w-[320px] shrink-0 flex-col border-l border-slate-200 bg-white">
          <RightChat projectId={currentId} tasks={detail?.tasks ?? []} />
        </aside>
      </div>
      <NewProjectDialog open={showNew} onClose={() => setShowNew(false)} onSubmit={handleCreate} />
    </div>
  );
}
