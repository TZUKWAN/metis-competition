import { useEffect, useState } from "react";
import {
  api,
  ARTIFACT_STATUS_LABELS,
  OUTPUT_LABELS,
  fileUrl,
  type ArtifactStatus,
  type AssetItem,
  type ProjectState,
} from "../api";

interface Props {
  projectId: string;
  state: ProjectState | null;
  onOpenPreview: (kind: "business_plan" | "ppt" | "demo" | "patent" | "copyright") => void;
  onOutputsChanged: () => void;
}

const STATUS_STYLE: Record<ArtifactStatus, string> = {
  pending: "bg-slate-100 text-slate-400",
  running: "bg-blue-50 text-blue-600",
  done: "bg-emerald-50 text-emerald-600",
  attention: "bg-amber-50 text-amber-600",
};

const OUTPUT_ORDER = ["business_plan", "ppt", "demo", "patent", "copyright"];

function AssetGroup({ projectId, assets }: { projectId: string; assets: AssetItem[] }) {
  const groups: Record<string, AssetItem[]> = {};
  for (const a of assets) {
    const type = a.type === "screenshot" ? "截图" : a.type === "diagram" ? "图" : a.type === "video" ? "视频" : "其他";
    (groups[type] ??= []).push(a);
  }
  return (
    <div className="space-y-2 text-sm">
      {Object.entries(groups).map(([type, items]) => (
        <div key={type}>
          <div className="mb-1 text-xs font-medium text-slate-400">{type} · {items.length}</div>
          <div className="space-y-0.5">
            {items.map((a) => (
              <a
                key={a.id}
                href={fileUrl(projectId, a.path)}
                target="_blank"
                rel="noreferrer"
                className="block truncate rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                title={a.title}
              >
                {a.type === "video" ? "▶ " : ""}
                {a.title}
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 右栏：只显示用户选择的成果 + 折叠的项目素材入口。 */
export default function ArtifactsPanel({ projectId, state, onOpenPreview, onOutputsChanged }: Props) {
  const [adding, setAdding] = useState(false);
  const [showAssets, setShowAssets] = useState(false);
  const [assets, setAssets] = useState<AssetItem[] | null>(null);

  useEffect(() => {
    if (showAssets && assets === null) {
      api.getAssets(projectId).then((r) => setAssets(r.assets)).catch(() => setAssets([]));
    }
  }, [showAssets, assets, projectId]);

  const selected = OUTPUT_ORDER.filter((k) => state?.project.selected_outputs?.includes(k));
  const remaining = OUTPUT_ORDER.filter((k) => !selected.includes(k));
  const statusOf = (k: string): ArtifactStatus => state?.artifact_status?.[k] ?? "pending";

  const handleAdd = async (keys: string[]) => {
    setAdding(false);
    if (!keys.length) return;
    await api.addOutputs(projectId, keys);
    onOutputsChanged();
  };

  return (
    <div className="flex h-full w-[280px] shrink-0 flex-col border-l border-slate-200 bg-slate-50">
      <div className="px-4 pb-1 pt-3.5 text-xs font-medium text-slate-400">生成物</div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {selected.map((key) => {
          const st = statusOf(key);
          return (
            <button
              key={key}
              onClick={() => st !== "pending" && onOpenPreview(key as never)}
              className={`mb-1.5 w-full rounded-xl border bg-white px-3.5 py-3 text-left transition-shadow ${
                st === "pending"
                  ? "border-slate-200"
                  : "border-slate-200 hover:border-blue-300 hover:shadow-sm"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">{OUTPUT_LABELS[key]}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_STYLE[st]}`}>
                  {st === "running" && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500 align-middle" />}
                  {ARTIFACT_STATUS_LABELS[st]}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-slate-400">
                {st === "pending" ? "尚未开始" : st === "running" ? "正在生成，完成后自动更新" : "点击查看预览与下载"}
              </div>
            </button>
          );
        })}

        {adding ? (
          <div className="mb-1.5 rounded-xl border border-blue-200 bg-blue-50/50 px-3.5 py-3">
            <div className="mb-2 text-xs text-slate-500">选择要新增的成果：</div>
            <div className="space-y-1.5">
              {remaining.map((key) => (
                <button
                  key={key}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-sm text-slate-600 hover:border-blue-400"
                  onClick={() => void handleAdd([key])}
                >
                  + {OUTPUT_LABELS[key]}
                </button>
              ))}
            </div>
            <button className="mt-2 text-xs text-slate-400 hover:text-slate-600" onClick={() => setAdding(false)}>
              取消
            </button>
          </div>
        ) : (
          remaining.length > 0 && (
            <button
              className="mb-1.5 w-full rounded-xl border border-dashed border-slate-200 px-3.5 py-2.5 text-left text-sm text-slate-400 transition-colors hover:border-blue-300 hover:text-blue-500"
              onClick={() => setAdding(true)}
            >
              + 添加成果
            </button>
          )
        )}
      </div>

      <div className="border-t border-slate-200 px-3 py-2.5">
        <button
          className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
          onClick={() => setShowAssets(!showAssets)}
        >
          <span>项目素材{assets ? ` ${assets.length}` : ""}</span>
          <span className="text-xs text-slate-400">{showAssets ? "▾" : "▸"}</span>
        </button>
        {showAssets && (
          <div className="mt-1 max-h-64 overflow-y-auto rounded-lg bg-white p-2">
            {assets === null ? (
              <div className="px-2 py-1 text-xs text-slate-300">加载中…</div>
            ) : assets.length === 0 ? (
              <div className="px-2 py-1 text-xs text-slate-300">还没有素材。生成 Demo / 架构图后自动进入这里。</div>
            ) : (
              <AssetGroup projectId={projectId} assets={assets} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
