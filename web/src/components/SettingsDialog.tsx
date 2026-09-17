import { useEffect, useState } from "react";
import { api, type SettingsShape, type SkillInfo, type PromptInfo } from "../api";

interface Props {
  onClose: () => void;
}

type Tab = "api" | "skills" | "prompts";

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs text-slate-400">{label}</div>
      <input
        type={type}
        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-blue-400"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function TestButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 transition-colors hover:border-blue-300 hover:text-blue-600"
    >
      测试连接
    </button>
  );
}

/** 设置页：模型与 API / Skills / Prompts 三个 Tab，不做复杂 Prompt 平台。 */
export default function SettingsDialog({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>("api");
  const [settings, setSettings] = useState<SettingsShape | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [prompts, setPrompts] = useState<PromptInfo[]>([]);
  const [activePrompt, setActivePrompt] = useState<string>("");
  const [promptDraft, setPromptDraft] = useState("");
  const [toast, setToast] = useState("");
  const [testing, setTesting] = useState<string>("");

  useEffect(() => {
    api.getSettings().then((r) => setSettings(r.settings)).catch(() => setSettings(null));
    api.getSkills().then((r) => setSkills(r.skills)).catch(() => setSkills([]));
    api.getPrompts().then((r) => setPrompts(r.prompts)).catch(() => setPrompts([]));
  }, []);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  };

  const save = async (patch: Partial<SettingsShape>, msg = "已保存") => {
    const r = await api.saveSettings(patch);
    setSettings(r.settings);
    flash(msg);
  };

  const test = async (kind: string, config: Record<string, string>) => {
    setTesting(kind);
    try {
      const r = await api.testSetting(kind, config);
      flash(r.ok ? `连接成功：${r.detail}` : `失败：${r.detail}`);
    } catch (e) {
      flash(`失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting("");
    }
  };

  const s = settings;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6" onClick={onClose}>
      <div className="flex h-[80%] w-[820px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div className="flex items-center gap-1">
            {([["api", "模型与 API"], ["skills", "Skills"], ["prompts", "Prompts"]] as [Tab, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${tab === key ? "bg-slate-100 font-medium text-slate-800" : "text-slate-500 hover:text-slate-700"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <button className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-100 hover:text-slate-600" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!s ? (
            <div className="text-sm text-slate-400">加载中…</div>
          ) : tab === "api" ? (
            <div className="space-y-6 text-sm">
              <section>
                <div className="mb-2 font-medium text-slate-700">文本模型（OpenAI 兼容）</div>
                <div className="grid grid-cols-3 gap-2.5">
                  <Field label="API Base" value={s.llm.base} placeholder="https://openrouter.ai/api/v1" onChange={(v) => setSettings({ ...s, llm: { ...s.llm, base: v } })} />
                  <Field label="API Key" value={s.llm.key} placeholder="sk-..." type="password" onChange={(v) => setSettings({ ...s, llm: { ...s.llm, key: v } })} />
                  <Field label="Model" value={s.llm.model} placeholder="模型名" onChange={(v) => setSettings({ ...s, llm: { ...s.llm, model: v } })} />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <TestButton onClick={() => void test("llm", s.llm)} />
                  <button className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-white hover:bg-slate-700" onClick={() => void save({ llm: s.llm })}>
                    保存
                  </button>
                  {testing === "llm" && <span className="text-xs text-slate-400">测试中…</span>}
                </div>
              </section>

              <section>
                <div className="mb-2 font-medium text-slate-700">联网搜索（留空 Provider 时自动使用免 key 浏览器模式）</div>
                <div className="grid grid-cols-3 gap-2.5">
                  <Field label="Provider" value={s.search.provider} placeholder="serper / tavily / browser" onChange={(v) => setSettings({ ...s, search: { ...s.search, provider: v } })} />
                  <Field label="API Key" value={s.search.key} placeholder="可留空（browser 模式不需要）" type="password" onChange={(v) => setSettings({ ...s, search: { ...s.search, key: v } })} />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <TestButton onClick={() => void test("search", s.search)} />
                  <button className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-white hover:bg-slate-700" onClick={() => void save({ search: s.search })}>
                    保存
                  </button>
                  {testing === "search" && <span className="text-xs text-slate-400">测试中…</span>}
                </div>
              </section>

              <section>
                <div className="mb-2 font-medium text-slate-700">图片生成</div>
                <div className="grid grid-cols-3 gap-2.5">
                  <Field label="API Base" value={s.image.base} onChange={(v) => setSettings({ ...s, image: { ...s.image, base: v } })} />
                  <Field label="API Key" value={s.image.key} type="password" onChange={(v) => setSettings({ ...s, image: { ...s.image, key: v } })} />
                  <Field label="Model" value={s.image.model} onChange={(v) => setSettings({ ...s, image: { ...s.image, model: v } })} />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <TestButton onClick={() => void test("image", s.image)} />
                  <button className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-white hover:bg-slate-700" onClick={() => void save({ image: s.image })}>
                    保存
                  </button>
                  {testing === "image" && <span className="text-xs text-slate-400">测试中…</span>}
                </div>
              </section>

              <section>
                <div className="mb-2 font-medium text-slate-700">视频生成</div>
                <div className="grid grid-cols-3 gap-2.5">
                  <Field label="API Base" value={s.video.base} onChange={(v) => setSettings({ ...s, video: { ...s.video, base: v } })} />
                  <Field label="API Key" value={s.video.key} type="password" onChange={(v) => setSettings({ ...s, video: { ...s.video, key: v } })} />
                  <Field label="Model" value={s.video.model} onChange={(v) => setSettings({ ...s, video: { ...s.video, model: v } })} />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <TestButton onClick={() => void test("video", s.video)} />
                  <button className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-white hover:bg-slate-700" onClick={() => void save({ video: s.video })}>
                    保存
                  </button>
                  {testing === "video" && <span className="text-xs text-slate-400">测试中…</span>}
                </div>
              </section>
              <div className="text-xs text-slate-300">留空的字段回落到 .env 配置；保存后立即生效，无需重启。</div>
            </div>
          ) : tab === "skills" ? (
            <div className="space-y-1.5">
              {skills.map((sk) => (
                <div key={sk.id} className="flex items-center gap-3 rounded-xl border border-slate-100 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      {sk.name}
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-400">{sk.source}</span>
                    </div>
                    <div className="truncate text-xs text-slate-400" title={sk.description}>
                      {sk.description}
                    </div>
                    <div className="truncate font-mono text-[10px] text-slate-300">{sk.file}</div>
                  </div>
                  <button
                    onClick={() => {
                      const next = sk.enabled ? [...skills.filter((x) => x.id !== sk.id).map((x) => x.id), sk.id] : skills.filter((x) => x.id !== sk.id).map((x) => x.id);
                      void save({ skills_disabled: next }, sk.enabled ? "已停用" : "已启用").then(() =>
                        api.getSkills().then((r) => setSkills(r.skills)),
                      );
                    }}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${sk.enabled ? "bg-blue-600" : "bg-slate-200"}`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${sk.enabled ? "left-[18px]" : "left-0.5"}`} />
                  </button>
                </div>
              ))}
              <div className="text-xs text-slate-300">停用的 Skill 不会出现在自动编排里（生成中任务不受影响）。</div>
            </div>
          ) : (
            <div className="flex h-full gap-4">
              <div className="w-64 shrink-0 space-y-0.5 overflow-y-auto">
                {prompts.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => {
                      setActivePrompt(p.key);
                      setPromptDraft(p.override);
                    }}
                    className={`block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                      activePrompt === p.key ? "bg-slate-100 font-medium text-slate-800" : "text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {p.name}
                    {p.override && <span className="ml-1 text-[10px] text-blue-400">已改</span>}
                  </button>
                ))}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                {(() => {
                  const p = prompts.find((x) => x.key === activePrompt);
                  if (!p) return <div className="text-sm text-slate-300">左侧选择要查看/编辑的 Prompt。</div>;
                  return (
                    <>
                      <div className="mb-1 text-xs text-slate-400">
                        {p.description}
                        <span className="ml-2 font-mono text-slate-300">{p.source}</span>
                      </div>
                      <textarea
                        className="min-h-0 flex-1 resize-none rounded-xl border border-slate-200 p-3 font-mono text-xs leading-5 outline-none focus:border-blue-400"
                        value={promptDraft}
                        placeholder="留空使用内置默认；修改后保存立即对后续任务生效。"
                        onChange={(e) => setPromptDraft(e.target.value)}
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-white hover:bg-slate-700"
                          onClick={async () => {
                            const overrides: Record<string, string> = { [p.key]: promptDraft };
                            await save({ prompts: overrides }, "Prompt 已保存，后续任务立即生效");
                            const r = await api.getPrompts();
                            setPrompts(r.prompts);
                          }}
                        >
                          保存
                        </button>
                        <button
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:border-slate-300"
                          onClick={async () => {
                            await save({ prompts: { [p.key]: "" } }, "已恢复默认");
                            const r = await api.getPrompts();
                            setPrompts(r.prompts);
                            setPromptDraft("");
                          }}
                        >
                          恢复默认
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">{toast}</div>
      )}
    </div>
  );
}
