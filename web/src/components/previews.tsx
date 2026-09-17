import { useEffect, useMemo, useState } from "react";
import { api, fileUrl, type DirEntry } from "../api";
import { Markdown } from "../markdown";

export type PreviewKind = "business_plan" | "ppt" | "demo" | "patent" | "copyright";

interface OverlayProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  toolbar?: React.ReactNode;
}

/** 通用大预览弹窗：约占窗口 80% */
function Overlay({ title, onClose, children, toolbar }: OverlayProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-6" onClick={onClose}>
      <div
        className="flex h-[85%] w-[85%] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div className="text-sm font-semibold text-slate-800">{title}</div>
          <div className="flex items-center gap-2">
            {toolbar}
            <button className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-100 hover:text-slate-600" onClick={onClose}>
              ✕ 关闭
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 bg-slate-50">{children}</div>
      </div>
    </div>
  );
}

function DownloadBtn({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition-colors hover:border-blue-300 hover:text-blue-600"
    >
      ⬇ {label}
    </a>
  );
}

function MarkdownDoc({ projectId, path, imageBase }: { projectId: string; path: string; imageBase?: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .readFile(projectId, path)
      .then(setText)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [projectId, path]);
  if (error) return <div className="p-6 text-sm text-red-500">{error}</div>;
  if (text === null) return <div className="p-6 text-sm text-slate-400">加载中…</div>;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl bg-white px-10 py-8 text-sm leading-7 text-slate-700">
        <Markdown text={text} imageBase={imageBase} />
      </div>
    </div>
  );
}

/** 商业计划书：Markdown 预览 + 下载 DOCX/PDF */
export function BpPreview({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  return (
    <Overlay
      title="商业计划书"
      onClose={onClose}
      toolbar={
        <>
          <DownloadBtn href={fileUrl(projectId, "business-plan/business-plan.docx")} label="DOCX" />
          <DownloadBtn href={fileUrl(projectId, "business-plan/business-plan.pdf")} label="PDF" />
        </>
      }
    >
      <MarkdownDoc projectId={projectId} path="business-plan/business-plan.md" imageBase={fileUrl(projectId, "business-plan")} />
    </Overlay>
  );
}

/** PPT：左侧缩略图 + 右侧大图（ppt/rendered/*.png） */
export function PptPreview({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [slides, setSlides] = useState<DirEntry[] | null>(null);
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    api
      .listDir(projectId, "ppt/rendered")
      .then((r) => {
        const pngs = r.entries.filter((e) => e.type === "file" && e.name.endsWith(".png"));
        setSlides(pngs);
      })
      .catch(() => setSlides([]));
  }, [projectId]);
  const slideUrl = (name: string) => fileUrl(projectId, `ppt/rendered/${name}`);
  return (
    <Overlay
      title="路演 PPT"
      onClose={onClose}
      toolbar={
        <>
          <DownloadBtn href={fileUrl(projectId, "ppt/final.pptx")} label="PPTX" />
          <DownloadBtn href={fileUrl(projectId, "ppt/final.pdf")} label="PDF" />
        </>
      }
    >
      {slides === null ? (
        <div className="p-6 text-sm text-slate-400">加载中…</div>
      ) : slides.length === 0 ? (
        <div className="p-6 text-sm text-slate-400">还没有渲染页面。</div>
      ) : (
        <div className="flex h-full">
          <div className="w-44 shrink-0 space-y-2 overflow-y-auto border-r border-slate-200 bg-white p-3">
            {slides.map((s, i) => (
              <button
                key={s.name}
                onClick={() => setCurrent(i)}
                className={`block w-full overflow-hidden rounded-lg border-2 transition-colors ${
                  i === current ? "border-blue-500" : "border-transparent hover:border-slate-300"
                }`}
              >
                <img src={slideUrl(s.name)} alt={s.name} className="w-full" />
                <div className="py-0.5 text-center text-[10px] text-slate-400">{i + 1}</div>
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1 overflow-auto bg-slate-100 p-4">
            <img src={slideUrl(slides[current].name)} alt={slides[current].name} className="mx-auto max-w-full rounded-lg shadow-md" />
          </div>
        </div>
      )}
    </Overlay>
  );
}

/** Demo：iframe 打开真实构建产物 + 源码查看 */
function DemoSource({ projectId }: { projectId: string }) {
  const [cwd, setCwd] = useState("demo/src");
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [fileText, setFileText] = useState<{ name: string; content: string } | null>(null);
  useEffect(() => {
    setEntries(null);
    setFileText(null);
    api
      .listDir(projectId, cwd)
      .then((r) => setEntries(r.entries))
      .catch(() => setEntries([]));
  }, [projectId, cwd]);
  const openFile = async (name: string) => {
    const path = `${cwd}/${name}`;
    const ext = name.split(".").pop() ?? "";
    if (["tsx", "ts", "css", "html", "json", "js", "md"].includes(ext)) {
      const content = await api.readFile(projectId, path);
      setFileText({ name, content });
    } else {
      window.open(fileUrl(projectId, path), "_blank");
    }
  };
  return (
    <div className="flex h-full">
      <div className="w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-3 text-sm">
        <button className="mb-1 text-xs text-blue-500 hover:underline" onClick={() => setCwd(cwd.split("/").slice(0, -1).join("/") || "demo/src")}>
          ← 上一级
        </button>
        <div className="mb-1 truncate text-xs text-slate-400">{cwd}</div>
        {entries === null ? (
          <div className="text-xs text-slate-300">加载中…</div>
        ) : (
          entries.map((e) => (
            <button
              key={e.name}
              className="block w-full truncate rounded px-2 py-1 text-left text-xs text-slate-600 hover:bg-slate-100"
              onClick={() => (e.type === "dir" ? setCwd(`${cwd}/${e.name}`) : void openFile(e.name))}
            >
              {e.type === "dir" ? "📁 " : "📄 "}
              {e.name}
            </button>
          ))
        )}
      </div>
      <div className="min-w-0 flex-1 overflow-auto bg-slate-900 p-4 text-xs leading-5 text-slate-100">
        {fileText ? <pre className="whitespace-pre-wrap break-words">{fileText.content}</pre> : <div className="text-slate-500">在左侧选择要查看的源码文件</div>}
      </div>
    </div>
  );
}

export function DemoPreview({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [mode, setMode] = useState<"app" | "code">("app");
  const [regenerating, setRegenerating] = useState(false);
  const src = fileUrl(projectId, "demo/dist/index.html");
  return (
    <Overlay
      title="产品 Demo"
      onClose={onClose}
      toolbar={
        <>
          <button
            className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${
              mode === "app" ? "bg-blue-600 text-white" : "border border-slate-200 text-slate-600 hover:border-blue-300"
            }`}
            onClick={() => setMode("app")}
          >
            应用
          </button>
          <button
            className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${
              mode === "code" ? "bg-blue-600 text-white" : "border border-slate-200 text-slate-600 hover:border-blue-300"
            }`}
            onClick={() => setMode("code")}
          >
            源码
          </button>
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-blue-300 hover:text-blue-600"
          >
            ↗ 新窗口
          </a>
          <button
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-amber-300 hover:text-amber-600"
            onClick={async () => {
              if (!window.confirm("重新生成 Demo 会覆盖当前页面，确定？")) return;
              setRegenerating(true);
              try {
                await api.runTask(projectId, "demo");
                onClose();
              } finally {
                setRegenerating(false);
              }
            }}
          >
            {regenerating ? "…" : "⟳ 重新生成"}
          </button>
        </>
      }
    >
      {mode === "app" ? (
        <iframe src={src} className="h-full w-full border-0 bg-white" title="demo" />
      ) : (
        <DemoSource projectId={projectId} />
      )}
    </Overlay>
  );
}

/** 专利 / 软著：文档列表 + md 预览 */
export function DocsPreview({
  projectId,
  kind,
  onClose,
}: {
  projectId: string;
  kind: "patent" | "copyright";
  onClose: () => void;
}) {
  const [items, setItems] = useState<{ name: string; path: string; isMd: boolean }[] | null>(null);
  const [current, setCurrent] = useState<{ name: string; path: string; isMd: boolean } | null>(null);
  const dir = kind === "patent" ? "patent" : "software-copyright/exported";
  const title = kind === "patent" ? "专利材料" : "软件著作权材料";
  const extras = kind === "patent" ? ["patent-points.md", "novelty-notes.md", "claim-draft.md", "disclosure.md"] : ["application-info.md", "user-manual.md", "design-description.md", "source-code.md"];

  useEffect(() => {
    const load = async () => {
      const collected: { name: string; path: string; isMd: boolean }[] = [];
      for (const name of extras) {
        try {
          await api.readFile(projectId, `${dir}/${name}`);
          collected.push({ name, path: `${dir}/${name}`, isMd: true });
        } catch {
          // 该文档不存在则跳过
        }
      }
      try {
        const r = await api.listDir(projectId, dir);
        for (const e of r.entries) {
          if (e.type === "file" && !collected.some((c) => c.name === e.name)) {
            collected.push({ name: e.name, path: `${dir}/${e.name}`, isMd: e.name.endsWith(".md") });
          }
        }
      } catch {
        // 目录不存在
      }
      setItems(collected);
      setCurrent(collected[0] ?? null);
    };
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, dir]);

  return (
    <Overlay
      title={title}
      onClose={onClose}
      toolbar={current && !current.isMd ? <DownloadBtn href={fileUrl(projectId, current.path)} label={current.name} /> : undefined}
    >
      <div className="flex h-full">
        <div className="w-56 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-3">
          {items === null ? (
            <div className="text-xs text-slate-300">加载中…</div>
          ) : items.length === 0 ? (
            <div className="text-xs text-slate-300">还没有材料文件。</div>
          ) : (
            items.map((it) => (
              <button
                key={it.path}
                onClick={() => setCurrent(it)}
                className={`mb-0.5 block w-full truncate rounded px-2 py-1.5 text-left text-xs transition-colors ${
                  current?.path === it.path ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {it.isMd ? "📄 " : "📦 "}
                {it.name}
              </button>
            ))
          )}
        </div>
        <div className="min-w-0 flex-1 overflow-hidden bg-slate-50">
          {current === null ? (
            <div className="p-6 text-sm text-slate-400">选择左侧文档预览</div>
          ) : current.isMd ? (
            <div className="h-full overflow-y-auto">
              <div className="mx-auto max-w-3xl bg-white px-10 py-8 text-sm leading-7 text-slate-700">
                <MarkdownDoc projectId={projectId} path={current.path} />
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-slate-500">
              <span>{current.name}（二进制文档）</span>
              <DownloadBtn href={fileUrl(projectId, current.path)} label={`下载 ${current.name.split(".").pop()?.toUpperCase()}`} />
            </div>
          )}
        </div>
      </div>
    </Overlay>
  );
}

/** 预览路由 */
export function ArtifactPreview({ kind, projectId, onClose }: { kind: PreviewKind; projectId: string; onClose: () => void }) {
  const body = useMemo(() => {
    if (kind === "business_plan") return <BpPreview projectId={projectId} onClose={onClose} />;
    if (kind === "ppt") return <PptPreview projectId={projectId} onClose={onClose} />;
    if (kind === "demo") return <DemoPreview projectId={projectId} onClose={onClose} />;
    return <DocsPreview projectId={projectId} kind={kind} onClose={onClose} />;
  }, [kind, projectId, onClose]);
  return body;
}
