import type { Project } from "../api";
import { NODE_DEFS, type NodeKey } from "../nodes";

interface Props {
  projects: Project[];
  currentId: string | null;
  activeNode: NodeKey;
  onSelectProject: (id: string) => void;
  onSelectNode: (key: NodeKey) => void;
  onNewProject: () => void;
}

export default function LeftTree({
  projects,
  currentId,
  activeNode,
  onSelectProject,
  onSelectNode,
  onNewProject,
}: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-slate-200 p-3">
        <select
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          value={currentId ?? ""}
          onChange={(e) => {
            if (e.target.value) onSelectProject(e.target.value);
          }}
        >
          {projects.length === 0 && <option value="">暂无项目</option>}
          {projects.map((p) => (
            <option key={p.project_id} value={p.project_id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          onClick={onNewProject}
          className="w-full rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          ＋ 新建项目
        </button>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {NODE_DEFS.map((n) => {
          const active = n.key === activeNode;
          return (
            <button
              key={n.key}
              onClick={() => onSelectNode(n.key)}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                active ? "bg-blue-50 font-medium text-blue-700" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-blue-600" : "bg-slate-300"}`} />
              {n.label}
            </button>
          );
        })}
      </nav>
      <div className="border-t border-slate-200 p-3 text-xs text-slate-400">METIS Competition v0.1</div>
    </div>
  );
}
