/**
 * ppt.ts — 路演 PPT 生成（PRD §26–37）
 * 核心原则（§28）：上传模板 → 分析模板页 → 选最合适的模板页 → clone → 替换文字/图片/图表，不让 AI 从零画。
 * 渲染 QA（§37）用 PowerPoint COM 出 PNG，LLM 视觉检查，最多自动修 2 轮。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatCompletion, getLlmConfig, type ContentPart } from '../llm.js';
import { addAssets, projectDir, readFacts, readManifest, setTaskStatus, touch, type Asset } from '../workspace.js';
import { PptxFile, type SlideInfo } from './ppt/pptx-io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RENDER_PS1 = path.resolve(__dirname, '..', '..', 'scripts', 'render_ppt.ps1');

const ROLES = ['cover', 'summary', 'section', 'single_statement', 'title_body', 'two_column', 'three_cards', 'four_cards', 'image_text', 'full_image', 'chart', 'comparison', 'timeline', 'process', 'architecture', 'team', 'financial', 'closing', 'generic'];

interface SlidePlanItem {
  index: number;
  role: string;
  title: string;
  message: string;
  assets?: string[];
  template_slide: number;
}

function requireLlm(): void {
  if (!getLlmConfig()) throw new Error('PPT 生成需要 LLM（未配置）');
}

function findTemplate(projectId: string): string {
  const inputDir = path.join(projectDir(projectId), 'input');
  if (!fs.existsSync(inputDir)) throw new Error('请先上传 .pptx 模板到 input/ 目录');
  const pptx = fs.readdirSync(inputDir).find((f) => f.toLowerCase().endsWith('.pptx'));
  if (!pptx) throw new Error('input/ 中没有 .pptx 模板文件');
  return path.join(inputDir, pptx);
}

function renderWithCom(pptxPath: string, pngDir: string, pdfPath?: string): { ok: boolean; output: string } {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', RENDER_PS1, pptxPath, pngDir];
  if (pdfPath) args.push(pdfPath);
  const res = spawnSync('powershell', args, { encoding: 'utf8', timeout: 300_000 });
  return { ok: res.status === 0 && (res.stdout ?? '').includes('OK'), output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

// ---------- 1. 模板分析（§30） ----------

async function analyzeTemplate(projectId: string, templatePath: string): Promise<{ slides: SlideInfo[]; templateJson: { slide: number; role: string; title: string }[] }> {
  const dir = projectDir(projectId);
  const tplRender = path.join(dir, 'ppt', 'rendered-template');
  const r = renderWithCom(templatePath, tplRender);
  if (!r.ok) throw new Error(`模板渲染失败: ${r.output.slice(-300)}`);

  const pptx = await PptxFile.load(templatePath);
  const slides = await pptx.listSlides();
  if (slides.length === 0) throw new Error('模板中没有幻灯片');

  const summary = slides
    .map((s) => `第${s.index}页：文本框[${s.texts.map((t) => `"${t.text.slice(0, 40)}"(${t.isTitle ? '标题' : '正文'})`).join(', ')}] 图片${s.pictureCount}张${s.hasChart ? ' 含图表' : ''}`)
    .join('\n');
  const resp = await chatCompletion([
    {
      role: 'system',
      content:
        '你是 PPT 模板分析器。为模板每页判断页面角色，只输出 JSON 数组：[{"slide":1,"role":"cover","title":"页面主标题"}]。角色可选：' +
        ROLES.join('/') + '。判断依据：文字内容、图片数量、是否图表。识别不了用 generic。',
    },
    { role: 'user', content: summary },
  ]);
  const m = /\[[\s\S]*\]/.exec(resp);
  if (!m) throw new Error('模板角色识别失败');
  const templateJson = JSON.parse(m[0]) as { slide: number; role: string; title: string }[];
  fs.writeFileSync(path.join(dir, 'ppt', 'template.json'), JSON.stringify(templateJson, null, 2) + '\n', 'utf8');
  return { slides, templateJson };
}

// ---------- 2. slide-plan（§27/§33） ----------

async function planSlides(projectId: string, templateJson: { slide: number; role: string; title: string }[]): Promise<SlidePlanItem[]> {
  const dir = projectDir(projectId);
  const facts = readFacts(projectId);
  const manifest = readManifest(projectId);
  const plan = fs.readFileSync(path.join(dir, 'business-plan', 'business-plan.md'), 'utf8').slice(0, 9000);
  const assetLines = manifest.map((a) => `${a.id}: ${a.title} [${a.type}] tags=${a.tags.join(',')}`).join('\n');
  const tplLines = templateJson.map((t) => `模板第${t.slide}页 → ${t.role}（${t.title}）`).join('\n');

  const resp = await chatCompletion([
    {
      role: 'system',
      content:
        '你是路演 PPT 内容策划。按竞赛结构（封面/摘要/市场/痛点/政策/产品总览/产品详细展示4页/使用流程/架构/核心技术4页/成果4页/知识产权/优势/竞品2页/商业模式/营销2页/进展与商业验证4页/创始人/团队/导师/财务4页/融资/发展规划2页/社会价值3页/结束页）规划 25-35 页母稿。' +
        '只输出 JSON 数组：[{"index":1,"role":"cover","title":"大标题(8-20字)","message":"副标题或本页要点(15-35字)","assets":["asset_id"],"template_slide":3}]。\n' +
        '规则：每页必须从模板页中选一个（template_slide=模板页码，优先同角色）；封面/结束页必须有；产品展示页用 demo 截图资产(id见下)；架构页用 diagram 资产；财务页用 chart 资产；' +
        '文字长度：大标题8-20字，卡片标题4-10字，正文每页总量不超过250中文字符；content 以 message 概述，详细文案下一步再写。',
    },
    {
      role: 'user',
      content: `项目事实：\n${facts.map((f) => `${f.label}: ${f.value}`).join('\n')}\n\n商业计划书（摘录）：\n${plan}\n\n可用资产：\n${assetLines}\n\n模板页：\n${tplLines}`,
    },
  ]);
  const m = /\[[\s\S]*\]/.exec(resp);
  if (!m) throw new Error('slide-plan 生成失败');
  const items = JSON.parse(m[0]) as SlidePlanItem[];
  if (items.length < 15) throw new Error('slide-plan 页数过少');
  fs.writeFileSync(path.join(dir, 'ppt', 'slide-plan.json'), JSON.stringify(items, null, 2) + '\n', 'utf8');
  return items;
}

// ---------- 3. 逐页生成：clone + 文字框映射替换 + 图片/图表替换 ----------

async function fillSlide(
  pptx: PptxFile,
  part: string,
  slideInfo: SlideInfo,
  item: SlidePlanItem,
  assetById: Map<string, Asset>,
  assetFiles: Map<string, string>,
): Promise<void> {
  // 文字框映射：给 LLM 现有文本框，让它逐框给新文案（§34 长度约束）
  const boxes = slideInfo.texts.map((t) => ({ id: t.shapeId, kind: t.isTitle ? '标题' : '正文/装饰', current: t.text.slice(0, 50) }));
  if (boxes.length > 0) {
    const resp = await chatCompletion([
      {
        role: 'system',
        content:
          `你是 PPT 文案。本页角色 ${item.role}，页面目标：${item.title} — ${item.message}。\n` +
          '给出每个文本框的替换文案，只输出 JSON 数组 [{"id":"...","text":"新文案"}]。规则：标题8-20字；正文每框不超过60字、全页合计不超过250中文字符；' +
          '必须与项目事实一致；不要编造成果。装饰性文字（如页脚标语）可给空字符串清空。每个框都必须给。',
      },
      { role: 'user', content: JSON.stringify(boxes) },
    ]);
    const m = /\[[\s\S]*\]/.exec(resp);
    if (m) {
      const replacements = JSON.parse(m[0]) as { id: string; text: string }[];
      for (const r of replacements) {
        if (!r.text) continue;
        try {
          await pptx.replaceText(part, r.id, r.text);
        } catch {
          // 单个框替换失败不阻塞整页
        }
      }
    }
  }

  // 资产图片
  const assetIds = item.assets ?? [];
  if (assetIds.length > 0) {
    const pics = await pptx.listPictures(part);
    let used = 0;
    for (const aid of assetIds) {
      const asset = assetById.get(aid);
      const file = asset ? assetFiles.get(asset.path) : undefined;
      if (!asset || !file || !fs.existsSync(file)) continue;
      const bytes = fs.readFileSync(file);
      if (asset.type === 'chart' && slideInfo.hasChart) {
        await pptx.replaceChartWithImage(part, bytes);
      } else if (used < pics.length) {
        await pptx.replaceImage(part, pics[used].relEmbedId, bytes, path.extname(file).slice(1) || 'png');
        used++;
      } else {
        await pptx.addPicture(part, bytes, path.extname(file).slice(1) || 'png');
      }
    }
  }
}

// ---------- 4. 视觉 QA（§37）：contact sheet + LLM 检查 + 修复 ----------

async function visualQa(projectId: string, renderedDir: string, slideCount: number): Promise<{ slide: number; problem: string }[]> {
  const { chromium } = await import('playwright');
  const cells: string[] = [];
  for (let i = 1; i <= slideCount; i++) {
    const file = path.join(renderedDir, `slide-${String(i).padStart(2, '0')}.png`);
    if (!fs.existsSync(file)) continue;
    const b64 = fs.readFileSync(file).toString('base64');
    cells.push(`<div style="break-inside:avoid"><div style="font:600 18px sans-serif;padding:4px">第${i}页</div><img src="data:image/png;base64,${b64}" style="width:100%;border:1px solid #ddd"/></div>`);
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;margin:16px}#grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}</style></head><body><div id="grid">${cells.join('')}</div></body></html>`;
  const htmlPath = path.join(os.tmpdir(), `ppt-qa-${projectId}.html`);
  fs.writeFileSync(htmlPath, html, 'utf8');
  const browser = await chromium.launch();
  let shotPath = htmlPath.replace(/\.html$/, '.png');
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
    await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`);
    await page.waitForTimeout(500);
    await page.screenshot({ path: shotPath, fullPage: true });
  } finally {
    await browser.close().catch(() => {});
  }
  const b64 = fs.readFileSync(shotPath).toString('base64');
  const resp = await chatCompletion([
    {
      role: 'system',
      content:
        '你是 PPT 视觉质检员。检查所有幻灯片缩略图（标有页码），找出有问题的页：文字溢出、元素重叠、图片拉伸、标题换行过多、页面过空/过满、明显错位、模板风格被破坏。' +
        '只输出 JSON 数组 [{"slide":页码,"problem":"问题"}]；没有问题的页不要列出；全都没问题输出 []。',
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: '逐页检查这套路演 PPT 的渲染图。' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
      ] as ContentPart[],
    },
  ]);
  const m = /\[[\s\S]*\]/.exec(resp);
  if (!m) return [];
  try {
    return JSON.parse(m[0]) as { slide: number; problem: string }[];
  } catch {
    return [];
  }
}

/** 修复：把问题页长文本缩短后重新替换 */
async function shortenAndReplace(pptx: PptxFile, part: string, slideInfo: SlideInfo, item: SlidePlanItem, problem: string): Promise<void> {
  const resp = await chatCompletion([
    {
      role: 'system',
      content: `PPT 第${item.index}页（${item.title}）视觉问题：${problem}。请把该页文案整体压缩 30%-50%（标题保持8-20字，正文更短）。只输出 JSON 数组 [{"id":"文本框id","text":"缩短后文案"}]，框 id 见用户消息。`,
    },
    { role: 'user', content: JSON.stringify(slideInfo.texts.map((t) => ({ id: t.shapeId, text: t.text.slice(0, 60) }))) },
  ]);
  const m = /\[[\s\S]*\]/.exec(resp);
  if (!m) return;
  for (const r of JSON.parse(m[0]) as { id: string; text: string }[]) {
    if (!r.text) continue;
    try {
      await pptx.replaceText(part, r.id, r.text);
    } catch {
      // ignore
    }
  }
}

// ---------- 主流程 ----------

export async function runPpt(projectId: string): Promise<{ slides: number; pdf: boolean }> {
  requireLlm();
  setTaskStatus(projectId, 'ppt', 'running');
  const dir = projectDir(projectId);
  try {
    const pptDir = path.join(dir, 'ppt');
    const renderedDir = path.join(pptDir, 'rendered');
    fs.mkdirSync(renderedDir, { recursive: true });

    // 1+2. 模板分析与内容规划
    const templatePath = findTemplate(projectId);
    const { slides: tplSlides, templateJson } = await analyzeTemplate(projectId, templatePath);
    const plan = await planSlides(projectId, templateJson);

    // 3. 构建
    const pptx = await PptxFile.load(templatePath);
    const manifest = readManifest(projectId);
    const assetById = new Map(manifest.map((a) => [a.id, a]));
    const assetFiles = new Map(manifest.map((a) => [a.path, path.join(dir, 'assets', a.path)]));

    const kept = new Set<string>();
    const builtParts: { part: string; info: SlideInfo; item: SlidePlanItem }[] = [];
    for (const item of plan) {
      const tpl = tplSlides[Math.min(item.template_slide, tplSlides.length) - 1] ?? tplSlides[0];
      const part = await pptx.cloneSlide(tpl.part);
      const info = await pptx.describeSlide(part, item.index);
      await fillSlide(pptx, part, info, item, assetById, assetFiles);
      kept.add(part);
      builtParts.push({ part, info, item });
    }
    await pptx.keepSlidesOnly(kept);

    const finalPptx = path.join(pptDir, 'final.pptx');
    await pptx.save(finalPptx);

    // 4. 渲染 + QA + 最多 2 轮修复
    let render = renderWithCom(finalPptx, renderedDir, path.join(pptDir, 'final.pdf'));
    if (!render.ok) throw new Error(`PPT 渲染失败: ${render.output.slice(-300)}`);
    let issues = await visualQa(projectId, renderedDir, plan.length);
    for (let round = 0; issues.length > 0 && round < 2; round++) {
      for (const issue of issues.slice(0, 6)) {
        const built = builtParts[issue.slide - 1];
        if (built) await shortenAndReplace(pptx, built.part, built.info, built.item, issue.problem);
      }
      await pptx.save(finalPptx);
      render = renderWithCom(finalPptx, renderedDir, path.join(pptDir, 'final.pdf'));
      if (!render.ok) break;
      issues = await visualQa(projectId, renderedDir, plan.length);
    }
    fs.writeFileSync(path.join(pptDir, 'qa-issues.json'), JSON.stringify({ remaining: issues }, null, 2), 'utf8');

    // 5. PPT 封面图进资产库
    const coverPng = path.join(renderedDir, 'slide-01.png');
    if (fs.existsSync(coverPng)) {
      const seq = manifest.length;
      addAssets(projectId, [
        {
          id: `asset_${String(seq + 1).padStart(3, '0')}`,
          type: 'screenshot',
          path: 'ppt-cover.png',
          title: '路演 PPT 封面渲染图',
          description: 'final.pptx 第 1 页渲染',
          tags: ['ppt', 'cover'],
          source: 'generated',
          recommended_for: ['business-plan'],
        },
      ]);
      fs.copyFileSync(coverPng, path.join(dir, 'assets', 'ppt-cover.png'));
    }

    touch(projectId);
    setTaskStatus(projectId, 'ppt', 'done');
    return { slides: plan.length, pdf: fs.existsSync(path.join(pptDir, 'final.pdf')) };
  } catch (err) {
    setTaskStatus(projectId, 'ppt', 'failed');
    throw err;
  }
}
