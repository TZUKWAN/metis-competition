/**
 * settings.ts — 全局设置存储 + Prompt 注册表（前端「设置」页后端）
 * 三类数据：
 *  1. 模型与 API 配置（llm/search/image/video）— 加载时覆盖到 process.env，让现有 skill 无改动生效
 *  2. Prompt 覆盖（prompts.key → 文本）— getPrompt(key, default) 供各 skill 取用
 *  3. Skill 启用开关（skills_disabled）
 * 存储为 JSON 文件（workspace/settings.json），不引入数据库；文件已随 workspace/ 被 gitignore。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = path.resolve(__dirname, '..', '..', 'workspace', 'settings.json');

export interface SettingsShape {
  llm: { base: string; key: string; model: string };
  search: { provider: string; key: string };
  image: { base: string; key: string; model: string };
  video: { base: string; key: string; model: string };
  prompts: Record<string, string>;
  skills_disabled: string[];
}

const DEFAULTS: SettingsShape = {
  llm: { base: '', key: '', model: '' },
  search: { provider: '', key: '' },
  image: { base: '', key: '', model: '' },
  video: { base: '', key: '', model: '' },
  prompts: {},
  skills_disabled: [],
};

let cache: SettingsShape | null = null;

export function getSettings(): SettingsShape {
  if (cache) return cache;
  let stored: Partial<SettingsShape> = {};
  try {
    stored = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) as Partial<SettingsShape>;
  } catch {
    // 无设置文件时用默认值
  }
  cache = {
    llm: { ...DEFAULTS.llm, ...(stored.llm ?? {}) },
    search: { ...DEFAULTS.search, ...(stored.search ?? {}) },
    image: { ...DEFAULTS.image, ...(stored.image ?? {}) },
    video: { ...DEFAULTS.video, ...(stored.video ?? {}) },
    prompts: { ...(stored.prompts ?? {}) },
    skills_disabled: [...(stored.skills_disabled ?? [])],
  };
  return cache;
}

export function saveSettings(patch: Partial<SettingsShape>): SettingsShape {
  const cur = getSettings();
  const next: SettingsShape = {
    llm: { ...cur.llm, ...(patch.llm ?? {}) },
    search: { ...cur.search, ...(patch.search ?? {}) },
    image: { ...cur.image, ...(patch.image ?? {}) },
    video: { ...cur.video, ...(patch.video ?? {}) },
    prompts: { ...cur.prompts, ...(patch.prompts ?? {}) },
    skills_disabled: patch.skills_disabled ?? cur.skills_disabled,
  };
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  cache = next;
  applySettingsToEnv();
  return next;
}

/** 设置值非空则覆盖 env（用户显式设置优先于 .env）；清空则回落 env。现有 skill 读 env 的代码零改动。 */
export function applySettingsToEnv(): void {
  const s = getSettings();
  const map: [string, string][] = [
    ['COMP_LLM_API_BASE', s.llm.base],
    ['COMP_LLM_API_KEY', s.llm.key],
    ['COMP_LLM_MODEL', s.llm.model],
    ['SEARCH_PROVIDER', s.search.provider],
    ['SEARCH_API_KEY', s.search.key],
    ['IMAGE_API_BASE', s.image.base],
    ['IMAGE_API_KEY', s.image.key],
    ['IMAGE_MODEL', s.image.model],
    ['VIDEO_API_BASE', s.video.base],
    ['VIDEO_API_KEY', s.video.key],
    ['VIDEO_MODEL', s.video.model],
  ];
  for (const [key, value] of map) {
    if (value && value.trim()) process.env[key] = value.trim();
  }
}

/** Prompt 覆盖：设置里有非空覆盖用覆盖，否则用代码内默认（默认即当前行为） */
export function getPrompt(key: string, fallback: string): string {
  const override = getSettings().prompts[key];
  return override && override.trim() ? override : fallback;
}

/** Prompt 注册表：设置页展示用（key、名称、说明、来源文件、是否有覆盖） */
export const PROMPT_REGISTRY: { key: string; name: string; description: string; source: string }[] = [
  { key: 'prompt.agent_system', name: '项目需求理解（Agent 系统提示）', description: '对话 Agent 的人设与边界，知道当前项目与成果状态', source: 'server/src/agent.ts' },
  { key: 'prompt.research_summary', name: '市场调研', description: '调研摘要/分主题报告的写作要求与来源标注', source: 'server/src/skills/research.ts' },
  { key: 'prompt.demo_spec', name: 'Demo 规划（PRODUCT_SPEC）', description: '从项目事实生成产品规格：目标用户/核心功能/页面列表', source: 'server/src/skills/demo.ts' },
  { key: 'prompt.demo_page', name: 'Demo 页面生成', description: '逐页生成 React 页面组件的硬性要求', source: 'server/src/skills/demo.ts' },
  { key: 'prompt.business_plan', name: '商业计划书', description: '按章节生成计划书内容的写作要求', source: 'server/src/skills/businessplan.ts' },
  { key: 'prompt.ppt_plan', name: 'PPT 内容规划', description: '根据计划书与素材生成 slide-plan', source: 'server/src/skills/ppt.ts' },
  { key: 'prompt.ppt_template', name: 'PPT 模板理解', description: '识别模板页角色（cover/three_cards 等）', source: 'server/src/skills/ppt.ts' },
  { key: 'prompt.image', name: '真实产品生图', description: '生成贴近项目真实的图片的提示词要求', source: 'server/src/skills/images.ts' },
  { key: 'prompt.video', name: '视频生成', description: '首帧图片生成视频的动作描述要求', source: 'server/src/skills/video.ts' },
  { key: 'prompt.patent', name: '专利', description: '专利点挖掘/交底书撰写要求', source: 'server/src/skills/patent.ts' },
  { key: 'prompt.copyright', name: '软著', description: '软著申请信息/手册/设计说明撰写要求', source: 'server/src/skills/copyright.ts' },
  { key: 'prompt.qa_consistency', name: '一致性检查', description: '跨交付物一致性检查的报告要求', source: 'server/src/skills/qa.ts' },
];

/** Skill 注册表：设置页 Skills 页签展示 */
export const SKILL_REGISTRY: { id: string; name: string; description: string; source: string; file: string }[] = [
  { id: 'research', name: '联网调研', description: '搜索市场/政策/竞品/技术，来源落盘', source: '内置', file: 'server/src/skills/research.ts' },
  { id: 'demo', name: 'Demo 生成', description: '生成 React+Vite+TS 可运行产品 Demo', source: '内置', file: 'server/src/skills/demo.ts' },
  { id: 'capture', name: '自动截图/录屏', description: 'Playwright 截图与双录屏，含测试与修复', source: '内置', file: 'server/src/skills/capture.ts' },
  { id: 'diagrams', name: '架构图', description: 'sci-box 模板生成架构/功能/流程/路线图', source: 'third_party/sci-box', file: 'server/src/skills/diagram.ts' },
  { id: 'business_plan', name: '商业计划书', description: '按章节生成 + 财务三表 + DOCX/PDF', source: '内置', file: 'server/src/skills/businessplan.ts' },
  { id: 'ppt', name: '路演 PPT', description: '模板解析 + 克隆替换 + 渲染 QA', source: '内置', file: 'server/src/skills/ppt.ts' },
  { id: 'patent', name: '专利', description: '专利点挖掘/查新/交底书/权要建议', source: 'third_party/patent-disclosure-skill（方法论）', file: 'server/src/skills/patent.ts' },
  { id: 'copyright', name: '软件著作权', description: '申请表/手册/源码文档（读真实 Demo 代码）', source: 'third_party/SoftwareCopyright-Skill（流程）', file: 'server/src/skills/copyright.ts' },
  { id: 'images', name: '真实产品生图', description: 'image-brief + 生图 + 视觉 QA（需图片 API）', source: '内置', file: 'server/src/skills/images.ts' },
  { id: 'video', name: '视频生成', description: '首帧图片生成短视频（需视频 API）', source: '内置', file: 'server/src/skills/video.ts' },
  { id: 'qa_consistency', name: '一致性检查', description: '跨交付物一致性/事实核查报告', source: '内置', file: 'server/src/skills/qa.ts' },
];
