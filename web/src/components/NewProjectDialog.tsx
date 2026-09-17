import { useEffect, useState, type FormEvent } from "react";
import type { CreateProjectInput } from "../api";

const PROJECT_TYPES = ["软件", "AI应用", "硬件", "服务", "文创", "其他"];

const inputCls =
  "w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none";

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: CreateProjectInput) => Promise<void>;
}

export default function NewProjectDialog({ open, onClose, onSubmit }: Props) {
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [competitionName, setCompetitionName] = useState("");
  const [track, setTrack] = useState("");
  const [projectType, setProjectType] = useState(PROJECT_TYPES[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setSummary("");
      setCompetitionName("");
      setTrack("");
      setProjectType(PROJECT_TYPES[0]);
      setError("");
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const canSubmit = name.trim().length > 0 && summary.trim().length > 0 && !submitting;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit({
        name: name.trim(),
        summary: summary.trim(),
        project_type: projectType,
        competition_name: competitionName.trim() || undefined,
        track: track.trim() || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"
      >
        <h2 className="mb-4 text-base font-semibold text-slate-900">新建项目</h2>
        <div className="space-y-3">
          <div>
            <label htmlFor="np-name" className="mb-1 block text-xs font-medium text-slate-500">
              项目名称 *
            </label>
            <input
              id="np-name"
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：AI 大学生竞赛辅助平台"
            />
          </div>
          <div>
            <label htmlFor="np-summary" className="mb-1 block text-xs font-medium text-slate-500">
              一句话项目想法 *
            </label>
            <textarea
              id="np-summary"
              rows={3}
              className={`${inputCls} resize-none`}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="用一句话描述你们要做什么"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="np-comp" className="mb-1 block text-xs font-medium text-slate-500">
                比赛名称（可空）
              </label>
              <input
                id="np-comp"
                className={inputCls}
                value={competitionName}
                onChange={(e) => setCompetitionName(e.target.value)}
                placeholder="例如：挑战杯"
              />
            </div>
            <div>
              <label htmlFor="np-track" className="mb-1 block text-xs font-medium text-slate-500">
                赛道（可空）
              </label>
              <input
                id="np-track"
                className={inputCls}
                value={track}
                onChange={(e) => setTrack(e.target.value)}
                placeholder="例如：高教主赛道"
              />
            </div>
          </div>
          <div>
            <label htmlFor="np-type" className="mb-1 block text-xs font-medium text-slate-500">
              项目类型
            </label>
            <select id="np-type" className={inputCls} value={projectType} onChange={(e) => setProjectType(e.target.value)}>
              {PROJECT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error && <p className="mt-3 rounded bg-red-50 px-2 py-1.5 text-xs text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
          >
            {submitting ? "创建中…" : "创建项目"}
          </button>
        </div>
      </form>
    </div>
  );
}
