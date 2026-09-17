/**
 * index.ts — METIS Competition Server 入口
 * API（契约见 PLAN.md §2 + 交互重构新增）+ workspace 静态文件服务 + web 构建产物服务
 */
import './env.js';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  artifactStatus,
  createProject,
  deleteProject,
  ensureSelectedOutputs,
  getProject,
  listProjectDir,
  listProjects,
  projectDir,
  readFacts,
  readManifest,
  readProjectFile,
  readProjectMeta,
  setTaskStatus,
  writeProjectFile,
  updateProjectMeta,
  writeFacts,
  WORKSPACE_ROOT,
} from './workspace.js';
import { chat, initProjectChat, loadChatHistory, selectOutputs } from './agent.js';
import { getSettings, saveSettings, SKILL_REGISTRY, PROMPT_REGISTRY, type SettingsShape } from './settings.js';
import { isAutoRunning, startAutoRun } from './orchestrator.js';
import { searchBrowser } from './skills/search.js';
import { runRules } from './skills/rules.js';
import { runResearch } from './skills/research.js';
import { runDemo, runDemoTestTask } from './skills/demo.js';
import { runCapture } from './skills/capture.js';
import { runDiagrams } from './skills/diagram.js';
import { runImages } from './skills/images.js';
import { runVideo } from './skills/video.js';
import { runBusinessPlan } from './skills/businessplan.js';
import { runPpt } from './skills/ppt.js';
import { runPatent } from './skills/patent.js';
import { runCopyright } from './skills/copyright.js';
import { runQaConsistency, runDefense } from './skills/qa.js';
import { runDeliver } from './skills/deliver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const app = express();
app.use(express.json({ limit: '20mb' }));

const upload = multer({ storage: multer.memoryStorage() });

function ok(res: express.Response, data: unknown): void {
  res.json(data);
}

function fail(res: express.Response, err: unknown, status = 400): void {
  res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
}

function wrap(handler: (req: express.Request, res: express.Response) => Promise<void> | void) {
  return (req: express.Request, res: express.Response) => {
    Promise.resolve(handler(req, res)).catch((err) => fail(res, err, err instanceof Error && err.message.includes('not found') ? 404 : 400));
  };
}

// ---------- 项目 ----------

app.get('/api/projects', wrap(async (_req, res) => ok(res, { projects: listProjects() })));

// 极简新建：不再要求表单，名称/描述交给对话理解
app.post('/api/projects', wrap(async (req, res) => {
  const { name, summary, project_type, competition_name, track } = req.body ?? {};
  const { project } = { project: createProject({ name, summary, project_type, competition_name, track }) };
  initProjectChat(project.project_id);
  ok(res, { project });
}));

app.get('/api/projects/:id', wrap(async (req, res) => {
  const detail = getProject(req.params.id);
  const ensured = ensureSelectedOutputs(req.params.id, detail.project);
  ok(res, { ...detail, project: ensured });
}));

// 重命名
app.patch('/api/projects/:id', wrap(async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) throw new Error('name 不能为空');
  ok(res, { project: updateProjectMeta(req.params.id, { name }) });
}));

app.delete('/api/projects/:id', wrap(async (req, res) => {
  deleteProject(req.params.id);
  ok(res, { deleted: true });
}));

// ---------- 项目状态（前端轮询：onboarding / 成果状态 / 自动执行标记） ----------

app.get('/api/projects/:id/state', wrap(async (req, res) => {
  const { tasks } = getProject(req.params.id);
  const project = ensureSelectedOutputs(req.params.id, readProjectMeta(req.params.id));
  ok(res, {
    project,
    tasks,
    artifact_status: artifactStatus(req.params.id),
    auto_running: isAutoRunning(req.params.id),
  });
}));

// onboarding：selector 卡片「继续」
app.post('/api/projects/:id/onboarding/select', wrap(async (req, res) => {
  const outputs = Array.isArray(req.body?.outputs) ? req.body.outputs.map(String) : [];
  ok(res, selectOutputs(req.params.id, outputs));
}));

// 右栏「+ 添加成果」：合并 selected_outputs 并只补跑缺失任务
app.post('/api/projects/:id/outputs/add', wrap(async (req, res) => {
  const outputs = Array.isArray(req.body?.outputs) ? req.body.outputs.map(String) : [];
  const meta = ensureSelectedOutputs(req.params.id, readProjectMeta(req.params.id));
  const merged = Array.from(new Set([...(meta.selected_outputs ?? []), ...outputs]));
  updateProjectMeta(req.params.id, { selected_outputs: merged });
  const r = startAutoRun(req.params.id, { skipDone: true });
  ok(res, { selected_outputs: merged, ...r });
}));

// ---------- 文件 ----------

app.get('/api/projects/:id/file', wrap(async (req, res) => {
  const rel = String(req.query.path ?? '');
  const { abs, isText } = readProjectFile(req.params.id, rel);
  if (!isText) {
    res.sendFile(abs);
    return;
  }
  ok(res, { content: fs.readFileSync(abs, 'utf8') });
}));

app.put('/api/projects/:id/file', wrap(async (req, res) => {
  const rel = String(req.query.path ?? '');
  writeProjectFile(req.params.id, rel, String(req.body?.content ?? ''));
  ok(res, { saved: rel });
}));

// 目录列表（预览用：ppt/rendered、patent、software-copyright/exported、demo/src 等）
app.get('/api/projects/:id/dir', wrap(async (req, res) => {
  const rel = String(req.query.path ?? '');
  ok(res, { path: rel, entries: listProjectDir(req.params.id, rel) });
}));

app.get('/api/projects/:id/assets', wrap(async (req, res) => {
  ok(res, { assets: readManifest(req.params.id) });
}));

app.post('/api/projects/:id/upload', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw new Error('缺少文件');
  const dir = path.join(projectDir(req.params.id), 'input');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, req.file.originalname);
  fs.writeFileSync(target, req.file.buffer);
  ok(res, { saved: `input/${req.file.originalname}` });
}));

// ---------- 事实库 ----------

app.get('/api/projects/:id/facts', wrap(async (req, res) => ok(res, { facts: readFacts(req.params.id) })));

app.put('/api/projects/:id/facts', wrap(async (req, res) => {
  writeFacts(req.params.id, req.body?.facts ?? []);
  ok(res, { saved: true });
}));

// ---------- Agent 对话（SSE） ----------

app.get('/api/projects/:id/chat', wrap(async (req, res) => ok(res, { messages: loadChatHistory(req.params.id) })));

app.post('/api/projects/:id/chat', wrap(async (req, res) => {
  const message = String(req.body?.message ?? '');
  const context = (req.body?.context ?? undefined) as { type?: string; artifact?: string; page?: number } | undefined;
  if (!message.trim()) throw new Error('message 不能为空');
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  try {
    const reply = await chat(req.params.id, message, (delta) => {
      res.write(`data: ${JSON.stringify({ delta })}\n\n`);
    }, context);
    res.write(`data: ${JSON.stringify({ message: reply })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : String(err) })}\n\n`);
  }
  res.end();
}));

// ---------- 设置（模型与 API / Skills / Prompts） ----------

app.get('/api/settings', wrap(async (_req, res) => ok(res, { settings: getSettings() })));

app.put('/api/settings', wrap(async (req, res) => {
  const patch = (req.body ?? {}) as Partial<SettingsShape>;
  ok(res, { settings: saveSettings(patch) });
}));

app.get('/api/skills', wrap(async (_req, res) => {
  const disabled = getSettings().skills_disabled;
  ok(res, { skills: SKILL_REGISTRY.map((s) => ({ ...s, enabled: !disabled.includes(s.id) })) });
}));

app.get('/api/prompts', wrap(async (_req, res) => {
  const { prompts } = getSettings();
  ok(res, { prompts: PROMPT_REGISTRY.map((p) => ({ ...p, override: prompts[p.key] ?? '' })) });
}));

app.post('/api/settings/test', wrap(async (req, res) => {
  const { kind, config } = (req.body ?? {}) as { kind: string; config: Record<string, string> };
  if (kind === 'llm') {
    const base = (config.base || '').replace(/\/$/, '');
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` },
      body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: '回复：OK' }], max_tokens: 200 }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
    const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
    ok(res, { ok: true, detail: data.choices?.[0]?.message?.content?.slice(0, 60) ?? '连接成功' });
    return;
  }
  if (kind === 'search') {
    const prevProvider = process.env.SEARCH_PROVIDER;
    const prevKey = process.env.SEARCH_API_KEY;
    process.env.SEARCH_PROVIDER = config.provider || 'browser';
    if (config.key) process.env.SEARCH_API_KEY = config.key;
    else delete process.env.SEARCH_API_KEY;
    try {
      const results = await searchBrowser('大学生创新创业大赛');
      ok(res, { ok: results.length > 0, detail: `返回 ${results.length} 条结果` });
    } finally {
      if (prevProvider === undefined) delete process.env.SEARCH_PROVIDER;
      else process.env.SEARCH_PROVIDER = prevProvider;
      if (prevKey === undefined) delete process.env.SEARCH_API_KEY;
      else process.env.SEARCH_API_KEY = prevKey;
    }
    return;
  }
  if (kind === 'image' || kind === 'video') {
    const base = (config.base || '').replace(/\/$/, '');
    const resp = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${config.key}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
    ok(res, { ok: true, detail: `${base} 可达` });
    return;
  }
  throw new Error(`未知测试类型: ${kind}`);
}));

// ---------- 流水线任务（保留：预览「重新生成」等按钮直接触发） ----------

const TASK_REGISTRY: Record<string, (projectId: string) => Promise<unknown>> = {
  rules: (id) => runRules(id),
  research: (id) => runResearch(id),
  demo: (id) => runDemo(id),
  demo_test: (id) => runDemoTestTask(id),
  capture: (id) => runCapture(id),
  diagrams: (id) => runDiagrams(id),
  business_plan: (id) => runBusinessPlan(id),
  patent: (id) => runPatent(id),
  copyright: (id) => runCopyright(id),
  qa_consistency: (id) => runQaConsistency(id),
  defense: (id) => runDefense(id),
  images: (id) => runImages(id),
  video: (id) => runVideo(id),
  ppt: (id) => runPpt(id),
  deliver: (id) => runDeliver(id),
};

app.post('/api/projects/:id/run/:task', wrap(async (req, res) => {
  const task = req.params.task;
  const handler = TASK_REGISTRY[task];
  if (!handler) {
    setTaskStatus(req.params.id, task, 'failed');
    ok(res, { task, status: 'failed', message: `任务 ${task} 尚未接入，已在 tasks.json 中如实标记 failed` });
    return;
  }
  ok(res, { task, status: 'running' });
  try {
    await handler(req.params.id);
  } catch (err) {
    console.error(`[task ${task}] failed:`, err instanceof Error ? err.message : err);
  }
}));

// 让 Agent 立即按 selected_outputs 继续跑（用户说「继续」等场景的兜底入口）
app.post('/api/projects/:id/run', wrap(async (req, res) => {
  ok(res, startAutoRun(req.params.id, { skipDone: true }));
}));

// ---------- 静态服务 ----------

// workspace 文件预览：/files/:projectId/{path}
app.get('/files/:id/*', wrap(async (req, res) => {
  const rel = String(req.params[0] ?? '');
  const { abs } = readProjectFile(req.params.id, rel);
  res.sendFile(abs);
}));

// web 构建产物（生产模式）
const webDist = path.resolve(__dirname, '..', '..', 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api|files).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.listen(PORT, () => {
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
  console.log(`[metis-competition] server listening on http://localhost:${PORT}`);
  console.log(`[metis-competition] workspace: ${WORKSPACE_ROOT}`);
});
