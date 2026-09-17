/**
 * businessplan.ts — 商业计划书（PRD §21–25）
 * 按章节生成（sections/NN-*.md）→ 合并 business-plan.md → DOCX（pandoc）→ PDF（chromium print）
 * 财务：LLM 给 assumptions.json（标注预测）→ 同一套数字由脚本算三表 → xlsx + summary + PNG 图表。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatCompletion, getLlmConfig } from '../llm.js';
import { addAssets, projectDir, readFacts, readJsonArr, readManifest, setTaskStatus, touch, type Asset, type SourceItem } from '../workspace.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FINANCE_SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'finance_render.py');

const STYLE_MD = [
  '# 商业计划书写作风格（全章节共享）',
  '',
  '- 平实专业、逻辑严谨、避免夸张，不写明显 AI 套话',
  '- 不创造虚假概念，不编造数据；数据尽可能有依据并标注来源',
  '- 少用机械式"首先、其次、最后"，避免大量引号、冒号、破折号',
  '- 项目尚未完成的事项一律用"计划/预计/拟/目标/概念验证/Demo 阶段"表述，不得写成已经发生',
  '- 财务与市场预测必须标注"预测/模拟测算"',
  '- 每章 400-800 字为宜；结构按给定大纲编号',
  '',
].join('\n');

interface SectionDef {
  id: string;
  file: string;
  title: string;
  imageHint?: string;
}

/** PRD §22 默认目录（用户大纲未上传时以此为标准；学生项目允许弱化公司/工商信息） */
const SECTIONS: SectionDef[] = [
  { id: '01', file: '01-摘要.md', title: '一、摘要（市场背景/项目介绍/商业模式/团队介绍/项目实施情况）' },
  { id: '02', file: '02-公司介绍.md', title: '二、公司介绍（公司介绍/团队介绍/专家顾问）' },
  { id: '03', file: '03-产品介绍.md', title: '三、产品介绍（产品介绍/核心功能1-4/目标客户/产品优势/应用案例）', imageHint: '产品界面截图（首页+核心功能页）' },
  { id: '04', file: '04-核心技术.md', title: '四、核心技术（技术架构/核心技术1-4/知识产权/创新优势）', imageHint: '系统技术架构图' },
  { id: '05', file: '05-市场分析.md', title: '五、市场分析（目标市场/市场痛点/市场规模/市场前景/政策环境/市场定位/竞品分析/竞争优势）', imageHint: '市场或财务数据图表' },
  { id: '06', file: '06-运营管理.md', title: '六、运营管理（商业模式/运营分析含SWOT/经营策略含研发规划/产学研/合规）' },
  { id: '07', file: '07-营销战略.md', title: '七、营销战略（产品定位/定价体系/营销渠道与方法/营销目标与规划）' },
  { id: '08', file: '08-财务融资.md', title: '八、财务融资（利润表/现金流量表/资产负债表/融资规划）', imageHint: '财务预测图表' },
  { id: '09', file: '09-风险分析.md', title: '九、风险分析（市场/财务/技术/政策/人才风险）' },
  { id: '10', file: '10-项目价值.md', title: '十、项目价值（引领教育/带动就业/社会公益/产业价值）' },
];

function requireLlm(): void {
  if (!getLlmConfig()) throw new Error('商业计划书生成需要 LLM（未配置）');
}

function projectBrief(projectId: string): string {
  const facts = readFacts(projectId);
  const dir = projectDir(projectId);
  const read = (rel: string, cap = 2500) => {
    const f = path.join(dir, rel);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').slice(0, cap) : '';
  };
  const sources = readJsonArr<SourceItem>(path.join(dir, 'sources.json'))
    .map((s) => `${s.id}: ${s.title} ${s.url}`)
    .join('\n');
  return [
    `项目事实：\n${facts.map((f) => `${f.label}: ${f.value}（${f.type}）`).join('\n')}`,
    `调研摘要：\n${read('research/research-summary.md')}`,
    `市场分析：\n${read('research/market.md', 1800)}`,
    `政策环境：\n${read('research/policy.md', 1200)}`,
    `竞品分析：\n${read('research/competitor.md', 1800)}`,
    `技术趋势：\n${read('research/technology.md', 1200)}`,
    `技术规格：\n${read('demo/PRODUCT_SPEC.md', 2000)}`,
    `来源清单：\n${sources || '（无）'}`,
    `财务摘要：\n${read('business-plan/financial-summary.md', 1500)}`,
  ].join('\n\n');
}

/** 依据 §24 的映射，从资产库挑图（优先真实 Demo 截图与架构图） */
function pickAssets(projectId: string, sectionId: string): Asset[] {
  const manifest = readManifest(projectId);
  const has = (...tags: string[]) => manifest.filter((a) => tags.every((t) => a.tags.includes(t)));
  switch (sectionId) {
    case '03':
      return [...has('demo', 'product').slice(0, 1), ...has('core-feature').slice(0, 2)];
    case '04':
      return has('diagram').filter((a) => a.path.includes('system-architecture')).slice(0, 1);
    case '05':
      return has('chart').slice(0, 2);
    case '06':
      return has('diagram').filter((a) => a.path.includes('dev-roadmap')).slice(0, 1);
    case '08':
      return has('chart').filter((a) => a.path.includes('growth') || a.path.includes('cash')).slice(0, 2);
    case '10':
      return has('diagram').filter((a) => a.path.includes('dev-roadmap')).slice(0, 1);
    default:
      return [];
  }
}

async function genSection(projectId: string, section: SectionDef): Promise<string> {
  const dir = projectDir(projectId);
  const target = path.join(dir, 'business-plan', 'sections', section.file);
  // 用户手工改过的章节不覆盖（PRD §54）
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8').trim().length > 100) {
    return fs.readFileSync(target, 'utf8');
  }
  const assets = pickAssets(projectId, section.id);
  const imageBlock =
    assets.length > 0
      ? '\n本章必须在合适位置插入以下真实项目资产（Markdown 图片语法，路径相对项目根目录；每张图下一行写"图：<图题>"，再下一行写"资料来源：项目团队 Demo / 外部数据来源"）：\n' +
        assets.map((a) => `- ![](${path.join('assets', a.path).split(path.sep).join('/')})（${a.title}，${a.description}）`).join('\n')
      : '\n本章无配图。';
  const md = await chatCompletion([
    {
      role: 'system',
      content:
        `你是商业计划书撰稿人。请撰写"${section.title}"。\n${STYLE_MD}\n` +
        '章节编号与标题严格按给定大纲；没有的事实不要编造；公司/工商信息没有就写"团队尚未完成工商注册，计划……"并注明待用户补充；' +
        '涉及外部数据时在句末括注来源编号（src_xxx）；预测数据注明"预测"。只输出 Markdown 正文（以章节标题开头，用 ## 或 ###）。' +
        imageBlock,
    },
    { role: 'user', content: projectBrief(projectId) },
  ]);
  fs.writeFileSync(target, md.trim() + '\n', 'utf8');
  return md;
}

// ---------- 财务三表（PRD §25：同一套数字，脚本计算，LLM 只解释） ----------

interface Assumptions {
  start_year: number;
  revenue: number;
  growth_rates: number[];
  gross_margin: number;
  sales_expense_rate: number;
  management_expense_rate: number;
  rd_expense_rate: number;
  tax_rate: number;
  initial_capital: number;
}

async function genAssumptions(projectId: string): Promise<Assumptions> {
  const dir = projectDir(projectId);
  const target = path.join(dir, 'business-plan', 'assumptions.json');
  if (fs.existsSync(target)) return JSON.parse(fs.readFileSync(target, 'utf8')) as Assumptions;
  requireLlm();
  const facts = readFacts(projectId);
  const resp = await chatCompletion([
    {
      role: 'system',
      content:
        '你是财务分析助手。为大学生竞赛项目生成财务假设 JSON：{"start_year":2026,"revenue":首年营收预测(元,整数),"growth_rates":[未来4年增长率],' +
        '"gross_margin":毛利率0-1,"sales_expense_rate":销售费用率,"management_expense_rate":管理费用率,"rd_expense_rate":研发费用率,"tax_rate":所得税率,"initial_capital":初始投入资本(元)}。' +
        '学生早期项目首年营收预测建议 50万-300万元量级，依据项目事实与商业模式，不要夸张。只输出 JSON。',
    },
    { role: 'user', content: facts.map((f) => `${f.label}: ${f.value}`).join('\n') },
  ]);
  const jsonMatch = /\{[\s\S]*\}/.exec(resp);
  if (!jsonMatch) throw new Error('财务假设生成失败');
  const a = JSON.parse(jsonMatch[0]) as Assumptions;
  fs.writeFileSync(target, JSON.stringify(a, null, 2) + '\n', 'utf8');
  return a;
}

function computeStatements(a: Assumptions) {
  const years = Array.from({ length: a.growth_rates.length + 1 }, (_, i) => a.start_year + i);
  const revenue: number[] = [a.revenue];
  for (const g of a.growth_rates) revenue.push(Math.round(revenue[revenue.length - 1] * (1 + g)));
  const cogs = revenue.map((r) => Math.round(r * (1 - a.gross_margin)));
  const sales = revenue.map((r) => Math.round(r * a.sales_expense_rate));
  const mgmt = revenue.map((r) => Math.round(r * a.management_expense_rate));
  const rd = revenue.map((r) => Math.round(r * a.rd_expense_rate));
  const ebt = revenue.map((r, i) => r - cogs[i] - sales[i] - mgmt[i] - rd[i]);
  const tax = ebt.map((v) => (v > 0 ? Math.round(v * a.tax_rate) : 0));
  const net = ebt.map((v, i) => v - tax[i]);
  // 简化现金流：经营=净利，期末现金=初始资本+累计净利
  const cumNet: number[] = [];
  net.reduce((s, v, i) => (cumNet[i] = s + v), 0);
  const cash = cumNet.map((c) => c + a.initial_capital);
  // 简化资产负债表：资产=现金；负债=0；所有者权益=初始资本+累计留存
  const equity = cash;
  const income = {
    headers: ['年份', '营业收入', '营业成本', '毛利润', '销售费用', '管理费用', '研发费用', '利润总额', '所得税', '净利润'],
    rows: years.map((y, i) => [y, revenue[i], cogs[i], revenue[i] - cogs[i], sales[i], mgmt[i], rd[i], ebt[i], tax[i], net[i]]),
  };
  const cashflow = {
    headers: ['年份', '经营活动现金流(净利润)', '投资活动现金流', '筹资活动现金流', '现金净增加', '期末现金'],
    rows: years.map((y, i) => [y, net[i], 0, i === 0 ? a.initial_capital : 0, net[i] + (i === 0 ? a.initial_capital : 0), cash[i]]),
  };
  const balance = {
    headers: ['年份', '资产(货币资金)', '负债', '所有者权益'],
    rows: years.map((y, i) => [y, cash[i], 0, equity[i]]),
  };
  return { years, income, cashflow, balance, net, revenue, cash };
}

function fmtTable(t: { headers: string[]; rows: (number | string)[][] }): string {
  const lines = [`| ${t.headers.join(' | ')} |`, `| ${t.headers.map(() => '---').join(' | ')} |`];
  for (const row of t.rows) lines.push(`| ${row.join(' | ')} |`);
  return lines.join('\n');
}

export async function runFinancial(projectId: string): Promise<void> {
  const dir = projectDir(projectId);
  const bpDir = path.join(dir, 'business-plan');
  const a = await genAssumptions(projectId);
  const s = computeStatements(a);
  const data = { assumptions: a as unknown as Record<string, unknown>, years: s.years, income: s.income, cashflow: s.cashflow, balance: s.balance };
  const tmpJson = path.join(os.tmpdir(), `finance-${projectId}.json`);
  fs.writeFileSync(tmpJson, JSON.stringify(data), 'utf8');
  const res = spawnSync('python', [FINANCE_SCRIPT, tmpJson, bpDir], { encoding: 'utf8', timeout: 120_000 });
  if (res.status !== 0) throw new Error(`财务渲染失败: ${(res.stderr ?? '').slice(-300)}`);

  const tablesMd = ['## 财务预测三表（模拟测算，单位：元）\n', '### 利润表（预测）\n', fmtTable(s.income), '\n### 现金流量表（预测）\n', fmtTable(s.cashflow), '\n### 资产负债表（预测）\n', fmtTable(s.balance)].join('\n');
  fs.writeFileSync(path.join(bpDir, 'financial-summary.md'), `# 财务摘要\n\n> 以下全部为预测/模拟测算数据，非实际经营结果。\n\n假设：首年营收 ${a.revenue} 元，增长率 [${a.growth_rates.join(', ')}]，毛利率 ${(a.gross_margin * 100).toFixed(0)}%，所得税率 ${(a.tax_rate * 100).toFixed(0)}%。\n\n${tablesMd}\n`, 'utf8');

  // 图表进资产库（PRD §25.3）：渲染输出在 bpDir 根，先挪到 figures/ 再复制到 assets/charts
  for (const f of ['revenue-growth.png', 'profit-growth.png', 'cash-flow.png']) {
    const from = path.join(bpDir, f);
    if (fs.existsSync(from)) fs.renameSync(from, path.join(bpDir, 'figures', f));
  }
  const manifest = readManifest(projectId);
  let seq = manifest.length;
  const newAssets: Asset[] = [];
  for (const f of ['revenue-growth.png', 'profit-growth.png', 'cash-flow.png']) {
    if (!fs.existsSync(path.join(bpDir, 'figures', f))) continue;
    seq += 1;
    newAssets.push({
      id: `asset_${String(seq).padStart(3, '0')}`,
      type: 'chart',
      path: `charts/${f}`,
      title: f.replace('.png', ''),
      description: '财务预测图表（模拟测算）',
      tags: ['chart', 'financial', 'forecast'],
      source: 'generated',
      recommended_for: ['business-plan', 'ppt'],
    });
    // charts 资产目录是 assets/charts，复制过去
    fs.copyFileSync(path.join(bpDir, 'figures', f), path.join(dir, 'assets', 'charts', f));
  }
  if (newAssets.length) addAssets(projectId, newAssets);
}

// ---------- 合并与导出 ----------

export function mergeSections(projectId: string): string {
  const dir = projectDir(projectId);
  const { project } = (() => {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')) as { name: string };
    return { project: meta };
  })();
  const parts: string[] = [`# ${project.name}商业计划书\n`, '> 本文档由 METIS Competition 基于项目事实、联网调研与真实 Demo 资产生成；财务数据为预测/模拟测算。人可继续手工修改。\n'];
  let figureNo = 0;
  for (const sec of SECTIONS) {
    const f = path.join(dir, 'business-plan', 'sections', sec.file);
    if (!fs.existsSync(f)) continue;
    let md = fs.readFileSync(f, 'utf8');
    // 图编号：图：→图N：
    md = md.replace(/图：/g, () => `图${++figureNo}：`);
    parts.push(md.trim(), '');
  }
  const fin = path.join(dir, 'business-plan', 'financial-summary.md');
  if (fs.existsSync(fin)) parts.push(fs.readFileSync(fin, 'utf8').trim(), '');
  const merged = parts.join('\n\n');
  fs.writeFileSync(path.join(dir, 'business-plan', 'business-plan.md'), merged + '\n', 'utf8');
  return merged;
}

export async function exportDocx(projectId: string): Promise<void> {
  const dir = projectDir(projectId);
  const bpDir = path.join(dir, 'business-plan');
  const res = spawnSync('pandoc', ['business-plan.md', '-o', 'business-plan.docx', '--resource-path', dir], { cwd: bpDir, encoding: 'utf8', timeout: 120_000 });
  if (res.status !== 0 || !fs.existsSync(path.join(bpDir, 'business-plan.docx'))) {
    throw new Error(`pandoc DOCX 导出失败: ${(res.stderr ?? '').slice(-300)}`);
  }
}

export async function exportPdf(projectId: string): Promise<void> {
  const dir = projectDir(projectId);
  const bpDir = path.join(dir, 'business-plan');
  const htmlRes = spawnSync('pandoc', ['business-plan.md', '-o', 'business-plan.html', '--standalone', '--metadata', 'title=商业计划书', '--resource-path', dir, '-c', 'bp.css'], { cwd: bpDir, encoding: 'utf8', timeout: 120_000 });
  if (htmlRes.status !== 0) throw new Error(`pandoc HTML 导出失败: ${(htmlRes.stderr ?? '').slice(-200)}`);
  fs.writeFileSync(path.join(bpDir, 'bp.css'), 'body{font-family:"Microsoft YaHei",sans-serif;max-width:780px;margin:40px auto;padding:0 20px;line-height:1.7;color:#1f2937}h1{border-bottom:2px solid #2563eb;padding-bottom:8px}h2{margin-top:32px;color:#1e40af}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #d1d5db;padding:6px 8px}img{max-width:100%}blockquote{color:#6b7280;border-left:4px solid #e5e7eb;padding-left:12px}', 'utf8');
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`file:///${path.join(bpDir, 'business-plan.html').replace(/\\/g, '/')}`, { waitUntil: 'networkidle' });
    await page.pdf({ path: path.join(bpDir, 'business-plan.pdf'), format: 'A4', margin: { top: '2cm', bottom: '2cm', left: '1.8cm', right: '1.8cm' } });
  } finally {
    await browser.close().catch(() => {});
  }
  if (!fs.existsSync(path.join(bpDir, 'business-plan.pdf'))) throw new Error('PDF 未生成');
}

export async function runBusinessPlan(projectId: string): Promise<{ sections: number }> {
  requireLlm();
  setTaskStatus(projectId, 'business_plan', 'running');
  try {
    const dir = projectDir(projectId);
    const bpDir = path.join(dir, 'business-plan');
    fs.mkdirSync(path.join(bpDir, 'sections'), { recursive: true });
    fs.mkdirSync(path.join(bpDir, 'figures'), { recursive: true });
    fs.writeFileSync(path.join(bpDir, 'style.md'), STYLE_MD + '\n', 'utf8');
    fs.writeFileSync(path.join(bpDir, 'prompts', 'sections.json'), JSON.stringify(SECTIONS, null, 2) + '\n', 'utf8');

    await runFinancial(projectId);
    let count = 0;
    for (const sec of SECTIONS) {
      await genSection(projectId, sec);
      count++;
    }
    mergeSections(projectId);
    await exportDocx(projectId);
    await exportPdf(projectId);
    touch(projectId);
    setTaskStatus(projectId, 'business_plan', 'done');
    return { sections: count };
  } catch (err) {
    setTaskStatus(projectId, 'business_plan', 'failed');
    throw err;
  }
}
