/**
 * workspace.ts — 项目工作空间管理（PRD §1.3 / §4 / §51）
 * 每个项目一个文件夹：workspace/competition/{project_id}/，metadata 用 JSON 文件，不用数据库。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', 'workspace', 'competition');

export interface ProjectMeta {
  project_id: string;
  name: string;
  summary: string;
  project_type: string;
  competition_name: string;
  track: string;
  status: string;
  created_at: string;
  updated_at: string;
  /** 用户选择的成果（business_plan/ppt/demo/patent/copyright），旧项目读取时自动推断 */
  selected_outputs?: string[];
  /** onboarding 状态机：select(选成果) → q1..q5(五问) → done；答案逐项落盘 */
  onboarding?: OnboardingState;
}

export interface OnboardingState {
  step: 'select' | 'q1_market' | 'q2_outcome' | 'q3_business' | 'q4_resources' | 'q5_university' | 'summarize' | 'done';
  completed?: boolean;
  market_and_customer?: string;
  desired_outcome?: string;
  business_model?: string;
  existing_resources?: string;
  university?: string;
}

export const OUTPUT_KEYS = ['business_plan', 'ppt', 'demo', 'patent', 'copyright'] as const;
export type OutputKey = (typeof OUTPUT_KEYS)[number];

export const ONBOARDING_QUESTIONS: { step: OnboardingState['step']; field: keyof OnboardingState; text: string }[] = [
  { step: 'q1_market', field: 'market_and_customer', text: '这个项目主要面向什么市场，目标客户是谁？大概说一下就可以，不需要很正式。' },
  { step: 'q2_outcome', field: 'desired_outcome', text: '你希望这个项目最终实际做成什么样？用户使用以后具体可以完成什么，或者能获得什么效果？' },
  { step: 'q3_business', field: 'business_model', text: '这个项目准备采用什么商业模式？如果暂时没有想清楚，可以直接说不知道。' },
  { step: 'q4_resources', field: 'existing_resources', text: '目前这个项目已经有哪些资源？有什么写什么就可以，比如团队、技术、学校资源、营销渠道、合作方、客户、投资方、知识产权、比赛成果等，没有的不用填。' },
  { step: 'q5_university', field: 'university', text: '这个项目属于哪所高校？如果是跨校团队，也可以把相关学校都告诉我。' },
];

export interface Fact {
  key: string;
  label: string;
  value: string;
  type: 'user_provided' | 'verified_external' | 'generated_from_demo' | 'assumption' | 'forecast' | 'future_plan';
  source: string;
  confirmed: boolean;
}

export interface SourceItem {
  id: string;
  title: string;
  url: string;
  publisher: string;
  date: string;
  accessed_at: string;
  summary: string;
  used_for: string[];
}

export const TASK_ORDER = [
  'project_init',
  'rules',
  'research',
  'demo',
  'demo_test',
  'capture',
  'diagrams',
  'images',
  'video',
  'business_plan',
  'ppt',
  'patent',
  'copyright',
  'qa_consistency',
  'defense',
  'deliver',
] as const;

const SUB_DIRS = [
  'input',
  'demo',
  'assets/screenshots',
  'assets/diagrams',
  'assets/charts',
  'assets/generated-images',
  'assets/videos',
  'assets/team',
  'assets/certificates',
  'assets/ip',
  'research',
  'business-plan/sections',
  'business-plan/figures',
  'business-plan/prompts',
  'ppt/rendered',
  'patent/attachments',
  'software-copyright/exported',
  'qa',
] as const;

const TEXT_EXT = new Set(['.md', '.json', '.txt', '.ts', '.tsx', '.js', '.jsx', '.css', '.html', '.py', '.csv', '.xml', '.svg', '.yaml', '.yml', '.toml', '.docx', '.pptx', '.pdf', '.xlsx']);

export function projectDir(projectId: string): string {
  const dir = path.resolve(WORKSPACE_ROOT, projectId);
  if (!dir.startsWith(WORKSPACE_ROOT)) throw new Error('invalid project id');
  return dir;
}

function now(): string {
  return new Date().toISOString();
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export function readJsonArr<T>(file: string): T[] {
  return readJson<T[]>(file, []);
}

export function readJsonFile<T>(file: string): T | null {
  return readJson<T | null>(file, null);
}

function nextProjectId(): string {
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
  let max = 0;
  for (const entry of fs.readdirSync(WORKSPACE_ROOT)) {
    const m = /^comp_(\d+)$/.exec(entry);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `comp_${String(max + 1).padStart(3, '0')}`;
}

export function listProjects(): ProjectMeta[] {
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
  const result: ProjectMeta[] = [];
  for (const entry of fs.readdirSync(WORKSPACE_ROOT)) {
    const meta = readJson<ProjectMeta | null>(path.join(WORKSPACE_ROOT, entry, 'project.json'), null);
    if (meta) result.push(meta);
  }
  return result.sort((a, b) => a.project_id.localeCompare(b.project_id));
}

export function createProject(input: {
  name?: string;
  summary?: string;
  project_type?: string;
  competition_name?: string;
  track?: string;
  minimal?: boolean;
  onboarding?: OnboardingState;
}): ProjectMeta {
  const id = nextProjectId();
  const dir = projectDir(id);
  for (const sub of SUB_DIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true });

  const ts = now();
  const meta: ProjectMeta = {
    project_id: id,
    name: input.name ?? '新项目',
    summary: input.summary ?? '',
    project_type: input.project_type ?? 'software',
    competition_name: input.competition_name ?? '',
    track: input.track ?? '',
    status: 'research',
    created_at: ts,
    updated_at: ts,
    selected_outputs: [],
    onboarding: input.onboarding ?? { step: 'select' },
  };
  writeJson(path.join(dir, 'project.json'), meta);
  writeJson(path.join(dir, 'facts.json'), [
    { key: 'project_name', label: '项目名称', value: input.name ?? '', type: 'user_provided', source: 'user', confirmed: true },
    { key: 'summary', label: '一句话介绍', value: input.summary ?? '', type: 'user_provided', source: 'user', confirmed: true },
  ] satisfies Fact[]);
  writeJson(path.join(dir, 'sources.json'), [] satisfies SourceItem[]);
  writeJson(path.join(dir, 'rules.json'), {
    competition_name: input.competition_name ?? '',
    track: input.track ?? '',
    ppt_page_limit: null,
    pitch_minutes: null,
    business_plan_required: true,
    demo_required: false,
    video_required: false,
    score_items: [],
    hard_requirements: [],
    deadline: '',
  });
  writeJson(path.join(dir, 'tasks.json'), TASK_ORDER.map((t, i) => ({ id: t, status: i === 0 ? 'done' : 'waiting' })));
  writeJson(path.join(dir, 'assets', 'manifest.json'), []);
  fs.writeFileSync(path.join(dir, 'context.md'), `# ${input.name}\n\n${input.summary}\n`, 'utf8');
  return meta;
}

export function getProject(projectId: string): { project: ProjectMeta; tasks: { id: string; status: string }[]; tree: { path: string; type: 'file' | 'dir' }[] } {
  const dir = projectDir(projectId);
  const project = readJson<ProjectMeta>(path.join(dir, 'project.json'), null as unknown as ProjectMeta);
  if (!project) throw new Error(`project not found: ${projectId}`);
  const tasks = readJson<{ id: string; status: string }[]>(path.join(dir, 'tasks.json'), []);
  const tree: { path: string; type: 'file' | 'dir' }[] = [];
  const walk = (rel: string) => {
    const abs = path.join(dir, rel);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        tree.push({ path: childRel, type: 'dir' });
        walk(childRel);
      } else {
        tree.push({ path: childRel, type: 'file' });
      }
    }
  };
  walk('');
  return { project, tasks, tree };
}

export function setTaskStatus(projectId: string, taskId: string, status: string): void {
  const file = path.join(projectDir(projectId), 'tasks.json');
  const tasks = readJson<{ id: string; status: string }[]>(file, []);
  const t = tasks.find((x) => x.id === taskId);
  if (t) {
    t.status = status;
    writeJson(file, tasks);
    touch(projectId);
  }
}

export function touch(projectId: string): void {
  const file = path.join(projectDir(projectId), 'project.json');
  const meta = readJson<ProjectMeta>(file, null as unknown as ProjectMeta);
  if (meta) {
    meta.updated_at = now();
    writeJson(file, meta);
  }
}

/** 读项目内文件，越权路径直接抛错 */
export function readProjectFile(projectId: string, relPath: string): { abs: string; isText: boolean } {
  const dir = projectDir(projectId);
  const abs = path.resolve(dir, relPath);
  if (!abs.startsWith(dir)) throw new Error('invalid path');
  if (!fs.existsSync(abs)) throw new Error(`file not found: ${relPath}`);
  const isText = TEXT_EXT.has(path.extname(abs).toLowerCase());
  return { abs, isText };
}

export function writeProjectFile(projectId: string, relPath: string, content: string): void {
  const dir = projectDir(projectId);
  const abs = path.resolve(dir, relPath);
  if (!abs.startsWith(dir)) throw new Error('invalid path');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  touch(projectId);
}

export function readFacts(projectId: string): Fact[] {
  return readJson<Fact[]>(path.join(projectDir(projectId), 'facts.json'), []);
}

export function writeFacts(projectId: string, facts: Fact[]): void {
  writeJson(path.join(projectDir(projectId), 'facts.json'), facts);
  touch(projectId);
}

/** 资产 manifest（PRD §13.1） */
export interface Asset {
  id: string;
  type: string;
  path: string;
  title: string;
  description: string;
  tags: string[];
  source: string;
  recommended_for: string[];
  derived_from?: string;
}

export function readManifest(projectId: string): Asset[] {
  return readJson<Asset[]>(path.join(projectDir(projectId), 'assets', 'manifest.json'), []);
}

export function addAssets(projectId: string, assets: Asset[]): void {
  const file = path.join(projectDir(projectId), 'assets', 'manifest.json');
  const list = readJson<Asset[]>(file, []);
  writeJson(file, [...list, ...assets]);
}

export function nextAssetId(projectId: string): string {
  const list = readManifest(projectId);
  let max = 0;
  for (const a of list) {
    const m = /^asset_(\d+)$/.exec(a.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `asset_${String(max + 1).padStart(3, '0')}`;
}

// ---------- 交互重构新增（项目列表/成果/预览支撑） ----------

export function readProjectMeta(projectId: string): ProjectMeta {
  const meta = readJson<ProjectMeta>(path.join(projectDir(projectId), 'project.json'), null as unknown as ProjectMeta);
  if (!meta) throw new Error(`project not found: ${projectId}`);
  return meta;
}

export function updateProjectMeta(projectId: string, patch: Partial<ProjectMeta>): ProjectMeta {
  const meta = { ...readProjectMeta(projectId), ...patch, project_id: projectId, updated_at: now() };
  writeJson(path.join(projectDir(projectId), 'project.json'), meta);
  return meta;
}

export function deleteProject(projectId: string): void {
  const dir = projectDir(projectId);
  fs.rmSync(dir, { recursive: true, force: true });
}

function hasFile(projectId: string, rel: string): boolean {
  return fs.existsSync(path.join(projectDir(projectId), rel));
}

/** 成果状态（前端右栏）：pending / running / done / attention。由 tasks.json + 文件存在情况动态计算（PRD §35） */
export function artifactStatus(projectId: string): Record<string, string> {
  const tasks = readJson<{ id: string; status: string }[]>(path.join(projectDir(projectId), 'tasks.json'), []);
  const t = (id: string) => tasks.find((x) => x.id === id)?.status ?? 'waiting';
  const map = (taskId: string, doneFile?: string): string => {
    if (doneFile && hasFile(projectId, doneFile)) return 'done';
    if (t(taskId) === 'running') return 'running';
    if (doneFile && hasFile(projectId, doneFile)) return 'done';
    if (t(taskId) === 'done') return doneFile ? 'attention' : 'done'; // 声称完成但文件缺失 → 需要处理
    if (t(taskId) === 'failed') return 'attention';
    return 'pending';
  };
  return {
    demo: map('demo', 'demo/src/App.tsx'),
    business_plan: map('business_plan', 'business-plan/business-plan.docx'),
    ppt: map('ppt', 'ppt/final.pptx'),
    patent: map('patent', 'patent/disclosure.md'),
    copyright: map('copyright', 'software-copyright/exported/application-info.docx'),
  };
}

/** 旧项目兼容：没有 selected_outputs 时按已有成果推断并写回 */
export function ensureSelectedOutputs(projectId: string, meta: ProjectMeta): ProjectMeta {
  if (meta.selected_outputs && meta.onboarding) return meta;
  const status = artifactStatus(projectId);
  const inferred = (Object.keys(status) as (keyof typeof status)[]).filter((k) => status[k] !== 'pending');
  const patch: Partial<ProjectMeta> = {
    selected_outputs: meta.selected_outputs?.length ? meta.selected_outputs : inferred,
    onboarding: meta.onboarding ?? { step: 'done', completed: true },
  };
  return updateProjectMeta(projectId, patch);
}

export function listProjectDir(projectId: string, relPath: string): { name: string; type: 'file' | 'dir'; size?: number }[] {
  const dir = projectDir(projectId);
  const abs = path.resolve(dir, relPath);
  if (!abs.startsWith(dir) || !fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`dir not found: ${relPath}`);
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => ({
      name: e.name,
      type: e.isDirectory() ? ('dir' as const) : ('file' as const),
      ...(e.isDirectory() ? {} : { size: fs.statSync(path.join(abs, e.name)).size }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
