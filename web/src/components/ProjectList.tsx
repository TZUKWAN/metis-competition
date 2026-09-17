import { useState } from "react";
import { api, type Project } from "../api";

interface Props {
  projects: Project[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreated: (id: string) => void;
  onRenamed: () => void;
  onDeleted: (id: string) => void;
}

/** 左栏：项目列表（ChatGPT 风格）。一个项目 = 一个长期会话 + 独立工作空间。 */
export default function ProjectList({ projects, currentId, onSelect, onCreated, onRenamed, onDeleted }: Props) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [hover, setHover] = useState<string | null>(null);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const { project } = await api.createProject();
      onCreated(project.project_id);
    } finally {
      setCreating(false);
    }
  };

  const commitRename = async (id: string) => {
    const name = renameValue.trim();
    setRenaming(null);
    if (!name) return;
    await api.renameProject(id, name);
    onRenamed();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`确定删除「${name}」？该项目的全部成果会一并删除，不可恢复。`)) return;
    await api.deleteProject(id);
    onDeleted(id);
  };

  return (
    <div className="flex h-full w-[220px] shrink-0 flex-col border-r border-slate-200 bg-slate-50">
      <div className="p-2.5">
        <button
          onClick={handleCreate}
          disabled={creating}
          className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-60"
        >
          {creating ? "创建中…" : "+ 新建项目"}
        </button>
      </div>
      <div className="px-3 pb-1 pt-2 text-xs font-medium text-slate-400">最近项目</div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {projects.map((p) => {
          const active = p.project_id === currentId;
          return (
            <div
              key={p.project_id}
              className={`group mb-0.5 flex cursor-pointer items-center rounded-lg px-2.5 py-2 text-sm transition-colors ${
                active ? "bg-slate-200/80 text-slate-900" : "text-slate-600 hover:bg-slate-100"
              }`}
              onClick={() => renaming !== p.project_id && onSelect(p.project_id)}
              onMouseEnter={() => setHover(p.project_id)}
              onMouseLeave={() => setHover(null)}
            >
              {renaming === p.project_id ? (
                <input
                  autoFocus
                  className="w-full rounded border border-blue-400 bg-white px-1.5 py-0.5 text-sm outline-none"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitRename(p.project_id);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  onBlur={() => void commitRename(p.project_id)}
                />
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate" title={p.name}>
                    {p.name}
                  </span>
                  <span
                    className={`ml-1 flex shrink-0 gap-1 text-slate-400 ${hover === p.project_id ? "" : "hidden"}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      title="重命名"
                      className="rounded p-0.5 hover:bg-slate-200 hover:text-slate-700"
                      onClick={() => {
                        setRenaming(p.project_id);
                        setRenameValue(p.name);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      title="删除项目"
                      className="rounded p-0.5 hover:bg-red-100 hover:text-red-600"
                      onClick={() => void handleDelete(p.project_id, p.name)}
                    >
                      🗑
                    </button>
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
