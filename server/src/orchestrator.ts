/**
 * orchestrator.ts — 成果驱动自动编排（交互重构 §9/§11）
 * 用户在 onboarding 中选择需要的成果 → 这里把现有 Skill 任务按依赖顺序自动跑完；
 * 每个任务的进行/完成/失败以 kind:'tool' 消息写入聊天记录，前端渲染为紧凑状态块。
 * 不重写任何 Skill：只是顺序调用与 TASK_REGISTRY 相同的处理函数。
 */
import fs from 'node:fs';
import path from 'node:path';
import { projectDir, readJsonFile, readJsonArr, setTaskStatus, type SourceItem } from './workspace.js';
import { appendMessage, nowIso } from './chatstore.js';
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

const HANDLERS: Record<string, (id: string) => Promise<unknown>> = {
  rules: (id) => runRules(id),
  research: (id) => runResearch(id),
  demo: (id) => runDemo(id),
  demo_test: (id) => runDemoTestTask(id),
  capture: (id) => runCapture(id),
  diagrams: (id) => runDiagrams(id),
  images: (id) => runImages(id),
  video: (id) => runVideo(id),
  business_plan: (id) => runBusinessPlan(id),
  ppt: (id) => runPpt(id),
  patent: (id) => runPatent(id),
  copyright: (id) => runCopyright(id),
  qa_consistency: (id) => runQaConsistency(id),
  defense: (id) => runDefense(id),
  deliver: (id) => runDeliver(id),
};

const ORDER = [
  'rules', 'research', 'demo', 'demo_test', 'capture', 'images', 'video',
  'diagrams', 'business_plan', 'ppt', 'patent', 'copyright', 'qa_consistency', 'defense', 'deliver',
];

const TITLES: Record<string, string> = {
  rules: '解析比赛规则',
  research: '调研市场与竞品',
  demo: '制作产品 Demo',
  demo_test: '测试 Demo',
  capture: '生成截图与录屏',
  images: '生成产品图片',
  video: '生成短视频',
  diagrams: '绘制架构图',
  business_plan: '撰写商业计划书',
  ppt: '制作路演 PPT',
  patent: '撰写专利材料',
  copyright: '生成软著材料',
  qa_consistency: '一致性检查',
  defense: '准备答辩问题',
  deliver: '打包交付物',
};

/** 失败传播：依赖任务失败/被跳过 → 本任务跳过。images/video 失败不传播（锦上添花）。 */
const DEPS: Record<string, string[]> = {
  rules: [],
  research: [],
  demo: ['research'],
  demo_test: ['demo'],
  capture: ['demo_test'],
  images: ['demo'],
  video: ['capture'],
  diagrams: ['research'],
  business_plan: ['research', 'diagrams'],
  ppt: ['business_plan'],
  patent: ['research'],
  copyright: ['research'],
  qa_consistency: ['business_plan'],
  defense: ['business_plan'],
  deliver: ['research'],
};

const NO_PROPAGATE = new Set(['images', 'video']);

export function planTasks(projectId: string, selected: string[], opts: { skipDone: boolean; force?: string[] }): string[] {
  const need = new Set<string>(['rules', 'research']);
  if (selected.includes('demo')) {
    need.add('demo');
    need.add('demo_test');
    need.add('capture');
    if (process.env.IMAGE_API_BASE && process.env.IMAGE_API_KEY) need.add('images');
    if (process.env.VIDEO_API_BASE && process.env.VIDEO_API_KEY) need.add('video');
  }
  if (selected.includes('business_plan') || selected.includes('ppt')) {
    need.add('diagrams');
    need.add('business_plan');
  }
  if (selected.includes('ppt')) need.add('ppt');
  if (selected.includes('patent')) need.add('patent');
  if (selected.includes('copyright')) need.add('copyright');
  if (selected.includes('business_plan') || selected.includes('ppt')) {
    need.add('qa_consistency');
    need.add('defense');
  }
  need.add('deliver');
  for (const t of opts.force ?? []) need.add(t);

  let plan = ORDER.filter((t) => need.has(t));
  if (opts.skipDone) {
    plan = plan.filter((t) => getTaskStatus(projectId, t) !== 'done' || opts.force?.includes(t));
  }
  return plan;
}

function getTaskStatus(projectId: string, taskId: string): string {
  const tasks = readJsonFile<{ id: string; status: string }[]>(path.join(projectDir(projectId), 'tasks.json'));
  return tasks?.find((x) => x.id === taskId)?.status ?? 'waiting';
}

const running = new Set<string>();

export function isAutoRunning(projectId: string): boolean {
  return running.has(projectId);
}

function configuredImage(): boolean {
  return Boolean(process.env.IMAGE_API_BASE && process.env.IMAGE_API_KEY && process.env.IMAGE_MODEL);
}
function configuredVideo(): boolean {
  return Boolean(process.env.VIDEO_API_BASE && process.env.VIDEO_API_KEY && process.env.VIDEO_MODEL);
}

function taskDetail(projectId: string, task: string): string {
  const dir = projectDir(projectId);
  try {
    if (task === 'research') {
      const n = readJsonArr<SourceItem>(path.join(dir, 'sources.json')).length;
      return n ? `${n} 条来源` : '';
    }
    if (task === 'demo_test') {
      const r = readJsonFile<{ checks: { pass: boolean }[] }>(path.join(dir, 'demo', 'test-results', 'playwright-test.json'));
      if (r?.checks?.length) return `${r.checks.filter((c) => c.pass).length}/${r.checks.length} 通过`;
    }
    if (task === 'capture') {
      const shots = fs.existsSync(path.join(dir, 'assets', 'screenshots')) ? fs.readdirSync(path.join(dir, 'assets', 'screenshots')).filter((f) => f.endsWith('.png')).length : 0;
      return shots ? `${shots} 张截图` : '';
    }
    if (task === 'diagrams') {
      const n = fs.existsSync(path.join(dir, 'assets', 'diagrams')) ? fs.readdirSync(path.join(dir, 'assets', 'diagrams')).filter((f) => f.endsWith('.png')).length : 0;
      return n ? `${n} 张图` : '';
    }
    if (task === 'ppt') {
      const n = fs.existsSync(path.join(dir, 'ppt', 'rendered')) ? fs.readdirSync(path.join(dir, 'ppt', 'rendered')).filter((f) => f.endsWith('.png')).length : 0;
      return n ? `${n} 页` : '';
    }
  } catch {
    // 明细读取失败不影响主流程
  }
  return '';
}

/** 强制重做时的清理：让对应 Skill 真正重新生成而不是跳过已有文件 */
function prepareForce(projectId: string, task: string): void {
  const dir = projectDir(projectId);
  const rm = (rel: string) => fs.rmSync(path.join(dir, rel), { recursive: true, force: true });
  if (task === 'demo') {
    rm('demo/src');
    rm('demo/dist');
    rm('demo/page-plan.json');
    rm('demo/PRODUCT_SPEC.md');
  }
  if (task === 'business_plan') {
    rm('business-plan/sections');
    rm('business-plan/business-plan.md');
    rm('business-plan/business-plan.docx');
    rm('business-plan/business-plan.pdf');
  }
}

export function startAutoRun(projectId: string, opts: { skipDone?: boolean; force?: string[] } = {}): { started: boolean; plan?: string[]; reason?: string } {
  if (running.has(projectId)) return { started: false, reason: '该项目已有任务在执行中' };
  const meta = readJsonFile<{ selected_outputs?: string[] }>(path.join(projectDir(projectId), 'project.json'));
  const selected = meta?.selected_outputs ?? [];
  const plan = planTasks(projectId, selected, { skipDone: opts.skipDone ?? false, force: opts.force });
  if (!plan.length) return { started: false, reason: '没有需要执行的任务' };

  running.add(projectId);
  void (async () => {
    const failed = new Set<string>();
    const blocked = new Set<string>();
    let anyDone = false;
    try {
      for (const task of plan) {
        // 依赖检查
        const depFailed = DEPS[task]?.some((d) => failed.has(d) && !NO_PROPAGATE.has(d));
        const depBlocked = DEPS[task]?.some((d) => blocked.has(d));
        if (depFailed || depBlocked) {
          blocked.add(task);
          appendMessage(projectId, { role: 'assistant', kind: 'tool', task, title: TITLES[task] ?? task, status: 'skipped', detail: '因前序任务未完成而跳过', at: nowIso() });
          continue;
        }
        if (task === 'images' && !configuredImage()) {
          appendMessage(projectId, { role: 'assistant', kind: 'tool', task, title: TITLES[task], status: 'skipped', detail: '未配置图片生成 API，可在设置中配置后添加', at: nowIso() });
          continue;
        }
        if (task === 'video' && !configuredVideo()) {
          appendMessage(projectId, { role: 'assistant', kind: 'tool', task, title: TITLES[task], status: 'skipped', detail: '未配置视频生成 API，可在设置中配置后添加', at: nowIso() });
          continue;
        }

        appendMessage(projectId, { role: 'assistant', kind: 'tool', task, title: TITLES[task] ?? task, status: 'running', at: nowIso() });
        setTaskStatus(projectId, task, 'running');
        if (opts.force?.includes(task)) prepareForce(projectId, task);
        try {
          await HANDLERS[task](projectId);
          anyDone = true;
          appendMessage(projectId, { role: 'assistant', kind: 'tool', task, title: TITLES[task] ?? task, status: 'done', detail: taskDetail(projectId, task) || undefined, at: nowIso() });
        } catch (err) {
          failed.add(task);
          const msg = err instanceof Error ? err.message : String(err);
          appendMessage(projectId, { role: 'assistant', kind: 'tool', task, title: TITLES[task] ?? task, status: 'failed', detail: msg.slice(0, 200), at: nowIso() });
          const hint = /LLM 未配置|LLM 调用失败|LLM 返回为空/.test(msg)
            ? '请到右上角 ⚙ 设置里检查文本模型配置。'
            : /搜索|SEARCH/.test(msg)
              ? '请到设置里配置联网搜索（或使用免 key 的浏览器搜索模式）。'
              : '你可以在对话里让我重试这一步。';
          appendMessage(projectId, { role: 'assistant', content: `「${TITLES[task] ?? task}」这一步遇到了问题：${msg.slice(0, 160)}。${hint}`, at: nowIso() });
        }
      }
      if (failed.has('research')) {
        appendMessage(projectId, { role: 'assistant', content: '调研没有成功，后面的任务先停住了。解决问题后你可以对我说「继续」，我会从停住的地方接着做。', at: nowIso() });
      } else if (anyDone) {
        appendMessage(projectId, { role: 'assistant', content: '这一轮完成了，右侧可以看到生成好的成果，点击即可预览或下载。需要调整任何一部分，直接告诉我就行。', at: nowIso() });
      }
    } finally {
      running.delete(projectId);
    }
  })().catch((err) => {
    console.error('[orchestrator] fatal:', err);
    running.delete(projectId);
  });
  return { started: true, plan };
}
