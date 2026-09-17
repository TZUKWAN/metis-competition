import { useEffect, useState, type ReactNode } from "react";
import { api, fileUrl, fmtTime, type Project, type TreeEntry } from "../api";
import { Markdown } from "../markdown";
import { NODE_DEFS, type NodeKey } from "../nodes";

const IMG_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];
const VIDEO_EXTS = ["mp4", "webm", "mov", "mkv"];

/** 各文档节点对应的目录前缀（文件树中的相对路径） */
const MD_DIRS: Partial<Record<NodeKey, string[]>> = {
  research: ["research/", "调研/", "资料/"],
  business_plan: ["business_plan/", "business-plan/", "plan/", "商业计划书/"],
  patent: ["patent/", "专利/"],
  copyright: ["copyright/", "software_copyright/", "软著/"],
  qa: ["qa/", "defense/", "答辩/"],
};

/** 目录下找不到时，回退到项目根目录中按关键词匹配的 md 文件 */
const ROOT_KEYWORDS: Partial<Record<NodeKey, string[]>> = {
  research: ["research", "调研"],
  business_plan: ["business", "plan"],
  patent: ["patent", "专利"],
  copyright: ["copyright", "软著"],
  qa: ["qa", "consistency", "fact", "defense", "答辩", "检查"],
};

function isMd(p: string) {
  return p.toLowerCase().endsWith(".md");
}

function under(p: string, prefixes: string[]) {
  return prefixes.some((pre) => p.startsWith(pre));
}

function firstMd(tree: TreeEntry[], prefixes: string[]): string | null {
  if (prefixes.length === 0) return null;
  const files = tree
    .filter((e) => e.type === "file" && isMd(e.path) && under(e.path, prefixes))
    .map((e) => e.path)
    .sort();
  return files[0] ?? null;
}

function findMdForNode(tree: TreeEntry[], node: NodeKey): string | null {
  const hit = firstMd(tree, MD_DIRS[node] ?? []);
  if (hit) return hit;
  const kws = ROOT_KEYWORDS[node] ?? [];
  if (kws.length === 0) return null;
  const rootMds = tree
    .filter((e) => e.type === "file" && isMd(e.path) && !e.path.includes("/"))
    .map((e) => e.path)
    .sort();
  return rootMds.find((p) => kws.some((k) => p.toLowerCase().includes(k.toLowerCase()))) ?? null;
}

function filesUnder(tree: TreeEntry[], prefixes: string[], exts?: string[]): string[] {
  return tree
    .filter(
      (e) =>
        e.type === "file" &&
        under(e.path, prefixes) &&
        (!exts || exts.includes(e.path.split(".").pop()!.toLowerCase())),
    )
    .map((e) => e.path)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="rounded-lg border border-dashed border-slate-300 px-6 py-8 text-center text-sm text-slate-400">
        {text}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5 rounded-lg border border-slate-200">
      <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700">{title}</div>
      <div className="p-4">{children}</div>
    </section>
  );
}

// ---------- 项目总览 ----------

function OverviewView({ project }: { project: Project }) {
  const [facts, setFacts] = useState<unknown[] | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getFacts(project.project_id)
      .then((f) => {
        if (alive) setFacts(f);
      })
      .catch(() => {
        if (alive) setFacts([]);
      });
    return () => {
      alive = false;
    };
  }, [project.project_id]);

  const info: [string, string][] = [
    ["项目名称", project.name],
    ["项目类型", project.project_type],
    ["当前状态", project.status],
    ["创建时间", fmtTime(project.created_at)],
    ["更新时间", fmtTime(project.updated_at)],
    ["项目想法", project.summary],
  ];

  return (
    <div className="p-6">
      <Card title="项目信息">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          {info.map(([k, v]) => (
            <div key={k} className={k === "项目想法" ? "sm:col-span-2" : ""}>
              <dt className="text-xs text-slate-400">{k}</dt>
              <dd className="mt-0.5 text-sm text-slate-800">{v || "—"}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card title="关键事实（facts.json）">
        {facts === null ? (
          <p className="text-sm text-slate-400">加载中…</p>
        ) : facts.length === 0 ? (
          <p className="text-sm text-slate-400">暂无事实，Agent 运行后会自动汇总。</p>
        ) : (
          <ul className="space-y-2">
            {facts.map((f, i) => (
              <li key={i} className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {typeof f === "string" ? (
                  f
                ) : (
                  <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(f, null, 2)}</pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------- 比赛规则 ----------

function RulesView({ projectId, tree }: { projectId: string; tree: TreeEntry[] }) {
  const [rulesJson, setRulesJson] = useState<string | null>(null);
  const [md, setMd] = useState<string | null>(null);

  const mdPath =
    tree.find((e) => e.type === "file" && /(^|\/)competition-rules\.md$/i.test(e.path))?.path ??
    tree.find((e) => e.type === "file" && isMd(e.path) && e.path.toLowerCase().includes("rule"))?.path ??
    null;

  useEffect(() => {
    let alive = true;
    api
      .getFile(projectId, "rules.json")
      .then((t) => {
        if (alive) setRulesJson(prettyJson(t));
      })
      .catch(() => {
        if (alive) setRulesJson("");
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (!mdPath) return;
    let alive = true;
    api
      .getFile(projectId, mdPath)
      .then((t) => {
        if (alive) setMd(t);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId, mdPath]);

  return (
    <div className="p-6">
      <Card title="rules.json">
        {rulesJson === null ? (
          <p className="text-sm text-slate-400">加载中…</p>
        ) : rulesJson === "" ? (
          <p className="text-sm text-slate-400">rules.json 尚未生成，请先运行规则解析任务。</p>
        ) : (
          <pre className="overflow-x-auto rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-700">
            {rulesJson}
          </pre>
        )}
      </Card>
      <Card title={mdPath ? `competition-rules.md（${mdPath}）` : "competition-rules.md"}>
        {mdPath === null ? (
          <p className="text-sm text-slate-400">比赛规则文档尚未生成，请先运行规则解析任务。</p>
        ) : md === null ? (
          <p className="text-sm text-slate-400">加载中…</p>
        ) : (
          <Markdown text={md} imageBase={fileUrl(projectId, "")} />
        )}
      </Card>
    </div>
  );
}

// ---------- 通用 md 节点（研究资料 / 商业计划书 / 专利 / 软著 / 答辩与检查） ----------

function MdNodeView({ projectId, tree, nodeKey }: { projectId: string; tree: TreeEntry[]; nodeKey: NodeKey }) {
  const mdPath = findMdForNode(tree, nodeKey);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!mdPath) return;
    let alive = true;
    setContent(null);
    setError("");
    api
      .getFile(projectId, mdPath)
      .then((t) => {
        if (alive) setContent(t);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [projectId, mdPath]);

  if (!mdPath) return <EmptyHint text="暂无内容，Agent 尚未生成对应文档" />;
  if (error) return <EmptyHint text={error} />;
  if (content === null) return <EmptyHint text="加载中…" />;
  const dir = mdPath.includes("/") ? mdPath.slice(0, mdPath.lastIndexOf("/")) : "";
  return (
    <div className="p-6">
      <p className="mb-3 text-xs text-slate-400">来源文件：{mdPath}</p>
      <Markdown text={content} imageBase={fileUrl(projectId, dir)} />
    </div>
  );
}

// ---------- 产品 Demo ----------

function DemoView({ projectId, tree }: { projectId: string; tree: TreeEntry[] }) {
  const demoPath =
    tree.find((e) => e.path === "demo/index.html")?.path ??
    tree.find((e) => e.type === "file" && e.path.startsWith("demo/") && e.path.toLowerCase().endsWith(".html"))?.path ??
    null;

  if (!demoPath) return <EmptyHint text="Demo 尚未生成，请先运行 Demo 生成任务" />;
  return (
    <div className="flex h-full min-h-0 flex-col p-3">
      <iframe
        title="产品 Demo"
        src={fileUrl(projectId, demoPath)}
        className="min-h-0 w-full flex-1 rounded-md border border-slate-200 bg-white"
      />
    </div>
  );
}

// ---------- 项目资产 ----------

interface AssetItem {
  src: string;
  name: string;
}

function parseManifest(text: string): AssetItem[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  let arr: unknown[] = [];
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const k of ["assets", "images", "items", "files", "videos"]) {
      if (Array.isArray(o[k])) {
        arr = o[k] as unknown[];
        break;
      }
    }
  }
  return arr
    .map((it): AssetItem | null => {
      if (typeof it === "string") return { src: it, name: it.split("/").pop() ?? it };
      if (!it || typeof it !== "object") return null;
      const o = it as Record<string, unknown>;
      const src = String(o.path ?? o.file ?? o.src ?? o.url ?? o.thumbnail ?? "");
      if (!src) return null;
      return { src, name: String(o.name ?? o.title ?? o.id ?? src.split("/").pop() ?? src) };
    })
    .filter((x): x is AssetItem => x !== null);
}

function AssetsView({ projectId, tree }: { projectId: string; tree: TreeEntry[] }) {
  const [items, setItems] = useState<AssetItem[] | null>(null);
  const [lightbox, setLightbox] = useState<AssetItem | null>(null);

  const manifestPath =
    tree.find((e) => e.path === "assets/manifest.json")?.path ??
    tree.find((e) => e.type === "file" && e.path.endsWith("manifest.json"))?.path ??
    null;

  useEffect(() => {
    if (!manifestPath) return;
    let alive = true;
    api
      .getFile(projectId, manifestPath)
      .then((text) => {
        if (alive) setItems(parseManifest(text));
      })
      .catch(() => {
        if (alive) setItems([]);
      });
    return () => {
      alive = false;
    };
  }, [projectId, manifestPath]);

  if (!manifestPath) return <EmptyHint text="资产清单（manifest.json）不存在，Agent 生成资产后会自动出现" />;
  if (items === null) return <EmptyHint text="加载中…" />;
  if (items.length === 0) return <EmptyHint text="资产清单为空" />;

  return (
    <div className="p-6">
      <p className="mb-3 text-xs text-slate-400">
        共 {items.length} 项资产（{manifestPath}），点击图片查看大图
      </p>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {items.map((it, i) => {
          const ext = it.src.split(".").pop()?.toLowerCase() ?? "";
          const url = fileUrl(projectId, it.src);
          if (IMG_EXTS.includes(ext)) {
            return (
              <button
                key={i}
                onClick={() => setLightbox(it)}
                className="group overflow-hidden rounded-lg border border-slate-200 text-left hover:shadow-md"
              >
                <img src={url} alt={it.name} loading="lazy" className="h-36 w-full bg-slate-50 object-cover" />
                <div className="truncate px-2 py-1.5 text-xs text-slate-500">{it.name}</div>
              </button>
            );
          }
          if (VIDEO_EXTS.includes(ext)) {
            return (
              <div key={i} className="overflow-hidden rounded-lg border border-slate-200">
                <video src={url} controls preload="metadata" className="h-36 w-full bg-black object-contain" />
                <div className="truncate px-2 py-1.5 text-xs text-slate-500">{it.name}</div>
              </div>
            );
          }
          return (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="flex flex-col justify-between rounded-lg border border-slate-200 p-3 hover:bg-slate-50"
            >
              <span className="text-xs font-medium text-slate-600">文件</span>
              <span className="mt-4 truncate text-xs text-slate-500">{it.name}</span>
            </a>
          );
        })}
      </div>
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-8"
          onClick={() => setLightbox(null)}
        >
          <img src={fileUrl(projectId, lightbox.src)} alt={lightbox.name} className="max-h-[85vh] max-w-full rounded shadow-2xl" />
          <div className="mt-3 text-sm text-slate-300">{lightbox.name}（点击任意处关闭）</div>
        </div>
      )}
    </div>
  );
}

// ---------- PPT ----------

function PptView({ projectId, tree }: { projectId: string; tree: TreeEntry[] }) {
  const rendered = filesUnder(tree, ["ppt/rendered/"], IMG_EXTS);
  const slides = rendered.length > 0 ? rendered : filesUnder(tree, ["ppt/"], IMG_EXTS);

  if (slides.length === 0) return <EmptyHint text="PPT 尚未渲染，运行 PPT 任务后会生成 slide 预览图" />;
  return (
    <div className="p-6">
      <p className="mb-4 text-xs text-slate-400">共 {slides.length} 页幻灯片</p>
      <div className="space-y-4">
        {slides.map((p, i) => (
          <figure key={p} className="overflow-hidden rounded-lg border border-slate-200">
            <img src={fileUrl(projectId, p)} alt={`slide-${i + 1}`} loading="lazy" className="w-full bg-white" />
            <figcaption className="border-t border-slate-100 px-3 py-1.5 text-xs text-slate-400">
              第 {i + 1} 页 · {p}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

// ---------- 中间栏 ----------

interface Props {
  projectId: string | null;
  project: Project | null;
  tree: TreeEntry[];
  nodeKey: NodeKey;
}

export default function CenterView({ projectId, project, tree, nodeKey }: Props) {
  const nodeLabel = NODE_DEFS.find((n) => n.key === nodeKey)?.label ?? nodeKey;

  let body: ReactNode;
  if (!projectId) {
    body = <EmptyHint text="暂无项目，请在左侧选择或新建项目" />;
  } else if (!project) {
    body = <EmptyHint text="加载中…" />;
  } else {
    switch (nodeKey) {
      case "overview":
        body = <OverviewView project={project} />;
        break;
      case "rules":
        body = <RulesView projectId={project.project_id} tree={tree} />;
        break;
      case "demo":
        body = <DemoView projectId={project.project_id} tree={tree} />;
        break;
      case "assets":
        body = <AssetsView projectId={project.project_id} tree={tree} />;
        break;
      case "ppt":
        body = <PptView projectId={project.project_id} tree={tree} />;
        break;
      default:
        body = <MdNodeView projectId={project.project_id} tree={tree} nodeKey={nodeKey} />;
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
        <h1 className="text-base font-semibold text-slate-900">{nodeLabel}</h1>
        {project && <span className="ml-4 truncate text-xs text-slate-400">{project.name}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-white">{body}</div>
    </div>
  );
}
