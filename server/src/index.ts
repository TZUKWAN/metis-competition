/**
 * index.ts — METIS Competition Server 入口
 * API（契约见 PLAN.md §2）+ workspace 静态文件服务 + web 构建产物服务
 */
import './env.js';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createProject,
  getProject,
  listProjects,
  projectDir,
  readFacts,
  readProjectFile,
  setTaskStatus,
  writeFacts,
  writeProjectFile,
  WORKSPACE_ROOT,
} from './workspace.js';
import { chat, loadChatHistory } from './agent.js';
import { runRules } from './skills/rules.js';
import { runResearch } from './skills/research.js';
import { runDemo, runDemoTestTask } from './skills/demo.js';
import { runCapture } from './skills/capture.js';
import { runDiagrams } from './skills/diagram.js';
import { runBusinessPlan } from './skills/businessplan.js';
import { runPatent } from './skills/patent.js';
import { runCopyright } from './skills/copyright.js';
import { runQaConsistency, runDefense } from './skills/qa.js';
import { runImages } from './skills/images.js';
import { runVideo } from './skills/video.js';
import { runPpt } from './skills/ppt.js';
import { runDeliver } from './skills/deliver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const app = express();
app.use(express.json({ limit: '20mb' }));

// 长任务后台执行期间，浏览器/网络层的未处理 rejection 不应带走整个服务（Node 25 默认致命退出）
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err?.stack ?? err);
});

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

app.post('/api/projects', wrap(async (req, res) => {
  const { name, summary, project_type, competition_name, track } = req.body ?? {};
  if (!name || !summary) throw new Error('name 和 summary 必填');
  ok(res, { project: createProject({ name, summary, project_type, competition_name, track }) });
}));

app.get('/api/projects/:id', wrap(async (req, res) => ok(res, getProject(req.params.id))));

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
  if (!message.trim()) throw new Error('message 不能为空');
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  try {
    const reply = await chat(req.params.id, message, (delta) => {
      res.write(`data: ${JSON.stringify({ delta })}\n\n`);
    });
    res.write(`data: ${JSON.stringify({ message: reply })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : String(err) })}\n\n`);
  }
  res.end();
}));

// ---------- 流水线任务（PRD §42 固定顺序；skills 逐 Milestone 接入） ----------

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
    ok(res, { task, status: 'failed', message: `任务 ${task} 尚未接入（对应 Milestone 未实现），已在 tasks.json 中如实标记 failed` });
    return;
  }
  // 流水线任务可能耗时较长，先响应 accepted，执行结果写入 tasks.json / 文件
  ok(res, { task, status: 'running' });
  try {
    await handler(req.params.id);
  } catch (err) {
    // 状态已由 skill 内部标记为 failed；这里只记录日志，不再向已关闭的响应写错误
    console.error(`[task ${task}] failed:`, err instanceof Error ? err.message : err);
  }
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
