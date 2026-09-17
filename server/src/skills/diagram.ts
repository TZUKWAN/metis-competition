/**
 * diagram.ts — 架构图/流程图（PRD §15）
 * 流程：读取项目事实 → 每图生成 diagram-spec + content JSON → 调用 sci-box 模板脚本生成 .drawio
 *       → check_layout 校验 → drawio CLI 导出 PNG → 写入 assets/diagrams + manifest。
 * 系统技术架构图（分层）用内置的 sci-box 风格分层生成器产出 .drawio（同样过 check_layout + drawio 渲染）。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatCompletion, getLlmConfig } from '../llm.js';
import { addAssets, projectDir, readFacts, readManifest, setTaskStatus, touch, type Asset } from '../workspace.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCI_BOX = path.resolve(__dirname, '..', '..', '..', 'third_party', 'sci-box', 'skills', 'scibox-diagram');
const BIN_DIR = path.resolve(__dirname, '..', '..', '..', 'bin');

function runPy(args: string[], cwd: string): { ok: boolean; output: string } {
  const res = spawnSync('python', args, { cwd, encoding: 'utf8', timeout: 120_000 });
  return { ok: res.status === 0, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

function exportPng(drawioPath: string): void {
  const env = { ...process.env, PATH: `${BIN_DIR};${process.env.PATH}` };
  const res = spawnSync('python', [path.join(SCI_BOX, 'scripts', 'export_figure.py'), drawioPath, '--png-only'], {
    encoding: 'utf8',
    timeout: 180_000,
    env,
  });
  if (res.status !== 0) throw new Error(`drawio 导出 PNG 失败: ${(res.stderr ?? '').slice(-300)}`);
}

function projectBrief(projectId: string): string {
  const facts = readFacts(projectId);
  const dir = projectDir(projectId);
  const bits = facts.map((f) => `${f.label}: ${f.value}`).join('\n');
  const specFile = path.join(dir, 'demo', 'PRODUCT_SPEC.md');
  const spec = fs.existsSync(specFile) ? fs.readFileSync(specFile, 'utf8').slice(0, 2500) : '';
  const pkgFile = path.join(dir, 'demo', 'package.json');
  const stack = fs.existsSync(pkgFile) ? fs.readFileSync(pkgFile, 'utf8') : '';
  return `项目事实：\n${bits}\n\nPRODUCT_SPEC：\n${spec}\n\n技术栈（真实 Demo 依赖）：\n${stack.slice(0, 800)}`;
}

interface DiagramJob {
  id: string;
  name: string;
  kind: 'layered' | 'framework-3col' | 'stageflow-3col' | 'roadmap-5band';
  instruction: string;
}

const JOBS: DiagramJob[] = [
  {
    id: 'system-architecture',
    name: '系统技术架构图',
    kind: 'layered',
    instruction:
      '输出分层架构 JSON：{"title":"图标题","layers":[{"name":"层名","components":["组件1","组件2",...]},...共4-6层,自顶向下],"flows":["层内组件A>层内组件B",...可选,最多6条]}。' +
      '层示例：用户层（学生/教师/评委）、应用层（真实 Demo 页面）、AI能力层、数据层、外部服务层（搜索/LLM API）。组件名用项目真实技术（React/Vite/Playwright/LLM API 等）。',
  },
  {
    id: 'product-functions',
    name: '产品功能架构图',
    kind: 'framework-3col',
    instruction:
      '这是三栏研究框架图模板（左：阶段链，中：内容块，右：方法清单）。请把它用作产品功能架构：左栏=产品模块阶段，中栏块=功能模块与功能点，右栏=支撑技术/方法。保持示例 JSON 的键名结构不变。',
  },
  {
    id: 'core-flow',
    name: '核心业务流程图',
    kind: 'stageflow-3col',
    instruction:
      '这是三栏阶段流程图模板（中栏每块实色标题条+步骤组，左栏阶段，右栏说明）。请表达产品的核心业务流程（用户从进入到完成目标的步骤）。保持示例 JSON 的键名结构不变。',
  },
  {
    id: 'tech-roadmap',
    name: '技术路线图',
    kind: 'roadmap-5band',
    instruction:
      '这是五带技术路线图模板（破题→准备→方法→结果→推广）。请表达项目技术演进路线（Demo 阶段→优化→扩展）。保持示例 JSON 的键名结构不变。',
  },
  {
    id: 'dev-roadmap',
    name: '发展路线图',
    kind: 'roadmap-5band',
    instruction:
      '这是五带路线图模板。请表达产品/业务发展路线（概念验证→Demo→试点→推广）。保持示例 JSON 的键名结构不变。',
  },
];

function exampleFor(kind: DiagramJob['kind']): string {
  if (kind === 'layered') return '';
  const dirName = { 'framework-3col': 'framework-3col', 'stageflow-3col': 'stageflow-3col', 'roadmap-5band': 'roadmap-5band' }[kind];
  const file = path.join(SCI_BOX, 'assets', dirName, 'example.json');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').slice(0, 6000) : '';
}

async function genContentJson(projectId: string, job: DiagramJob): Promise<string> {
  const example = exampleFor(job.kind);
  const brief = projectBrief(projectId);
  const resp = await chatCompletion([
    {
      role: 'system',
      content:
        `你是架构图设计师，为竞赛项目生成 sci-box 模板的内容 JSON。图名：${job.name}。\n` +
        (job.kind === 'layered'
          ? `${job.instruction}\n只输出 JSON，不要解释。\n`
          : `${job.instruction}\n下面是模板占位示例，把占位内容替换为项目真实内容（键名与结构必须完全一致，文案保持相近字数，用 \\n 手动断行）：\n${example}\n\n只输出替换后的完整 JSON，不要输出解释或 markdown 代码块。`),
    },
    { role: 'user', content: brief },
  ]);
  const jsonMatch = /\{[\s\S]*\}/.exec(resp.replace(/```json\n?|```\n?/g, ''));
  if (!jsonMatch) throw new Error(`${job.name} 内容 JSON 生成失败`);
  // 校验是合法 JSON
  JSON.parse(jsonMatch[0]);
  return jsonMatch[0];
}

// ---------- 分层架构图（drawio XML 生成，sci-box 风格模板） ----------

interface LayeredSpec {
  title: string;
  layers: { name: string; components: string[] }[];
  flows?: string[];
}

function textWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) > 255 ? fontSize : fontSize * 0.55;
  return Math.ceil(w);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function layeredToDrawio(spec: LayeredSpec): string {
  const FONT = 14;
  const canvasW = 1240;
  const margin = 40;
  let y = 24;
  let cellId = 2;
  const cells: string[] = [];
  const usedIds = new Set<string>();

  // 标题
  const titleW = Math.max(300, textWidth(spec.title, 20) + 60);
  cells.push(
    `<mxCell id="${cellId}" value="${esc(spec.title)}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#1d4ed8;strokeColor=#1e40af;fontColor=#ffffff;fontSize=20;fontStyle=1;" vertex="1" parent="1"><mxGeometry x="${(canvasW - titleW) / 2}" y="${y}" width="${titleW}" height="44" as="geometry" /></mxCell>`,
  );
  usedIds.add(String(cellId));
  cellId++;
  y += 44 + 28;

  const layerMeta: { id: number; name: string; chipIds: { id: number; name: string }[]; bandBottom: number; cx: number }[] = [];

  for (const layer of spec.layers) {
    const chipGap = 16;
    const chipH = 38;
    const innerW = canvasW - margin * 2 - 48;
    // 自动换行排布组件
    const rows: string[][] = [[]];
    let rowW = 0;
    for (const comp of layer.components) {
      const w = Math.max(90, textWidth(comp, FONT) + 28);
      if (rowW + w > innerW && rows[rows.length - 1].length > 0) {
        rows.push([]);
        rowW = 0;
      }
      rows[rows.length - 1].push(comp);
      rowW += w + chipGap;
    }
    const bandH = 46 + rows.length * (chipH + 12) + 10;
    const bandId = cellId++;
    const bandX = margin;
    cells.push(
      `<mxCell id="${bandId}" value="${esc(layer.name)}" style="rounded=1;whiteSpace=wrap;html=1;verticalAlign=top;align=left;spacingLeft=12;spacingTop=6;fillColor=none;dashed=1;strokeColor=#3b82f6;fontSize=15;fontStyle=1;fontColor=#1e3a8a;" vertex="1" parent="1"><mxGeometry x="${bandX}" y="${y}" width="${canvasW - margin * 2}" height="${bandH}" as="geometry" /></mxCell>`,
    );
    usedIds.add(String(bandId));

    const chipIds: { id: number; name: string }[] = [];
    let chipY = y + 44;
    for (const row of rows) {
      let chipX = bandX + 24;
      for (const comp of row) {
        const w = Math.max(90, textWidth(comp, FONT) + 28);
        const id = cellId++;
        cells.push(
          `<mxCell id="${id}" value="${esc(comp)}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#93c5fd;fontSize=${FONT};fontColor=#0f172a;" vertex="1" parent="1"><mxGeometry x="${chipX}" y="${chipY}" width="${w}" height="${chipH}" as="geometry" /></mxCell>`,
        );
        usedIds.add(String(id));
        chipIds.push({ id, name: comp });
        chipX += w + chipGap;
      }
      chipY += chipH + 12;
    }
    layerMeta.push({ id: bandId, name: layer.name, chipIds, bandBottom: y + bandH, cx: canvasW / 2 });
    y += bandH + 26;
  }

  // 相邻层箭头
  for (let i = 0; i + 1 < layerMeta.length; i++) {
    const a = layerMeta[i];
    const b = layerMeta[i + 1];
    const id = cellId++;
    cells.push(
      `<mxCell id="${id}" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#64748b;strokeWidth=1.5;endArrow=block;" edge="1" parent="1" source="${a.id}" target="${b.id}"><mxGeometry relative="1" as="geometry" /></mxCell>`,
    );
    usedIds.add(String(id));
  }
  // 自定义 flows（A>B，按名字找 chip）
  if (Array.isArray(spec.flows)) {
    const byName = new Map<string, number>();
    for (const l of layerMeta) for (const c of l.chipIds) if (!byName.has(c.name)) byName.set(c.name, c.id);
    for (const flow of spec.flows.slice(0, 8)) {
      const [from, to] = flow.split('>').map((s) => s.trim());
      if (!from || !to || !byName.has(from) || !byName.has(to)) continue;
      const id = cellId++;
      cells.push(
        `<mxCell id="${id}" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#f59e0b;strokeWidth=1.5;endArrow=block;dashed=1;" edge="1" parent="1" source="${byName.get(from)}" target="${byName.get(to)}"><mxGeometry relative="1" as="geometry" /></mxCell>`,
      );
      usedIds.add(String(id));
    }
  }

  const canvasH = y + 20;
  return [
    '<mxfile host="metis-competition" type="device">',
    '  <diagram name="layered-architecture" id="layered-architecture">',
    `    <mxGraphModel dx="900" dy="700" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${canvasW}" pageHeight="${canvasH}" math="0" shadow="0">`,
    '      <root>',
    '        <mxCell id="0" />',
    '        <mxCell id="1" parent="0" />',
    ...cells.map((c) => `        ${c}`),
    '      </root>',
    '    </mxGraphModel>',
    '  </diagram>',
    '</mxfile>',
  ].join('\n');
}

// ---------- 主流程 ----------

export async function runDiagrams(projectId: string): Promise<{ diagrams: string[] }> {
  if (!getLlmConfig()) throw new Error('架构图生成需要 LLM（未配置）');
  setTaskStatus(projectId, 'diagrams', 'running');
  try {
    const dir = projectDir(projectId);
    const outDir = path.join(dir, 'assets', 'diagrams');
    fs.mkdirSync(outDir, { recursive: true });

    const made: string[] = [];
    const jobErrors: string[] = [];
    let seq = readManifest(projectId).length;
    const newAssets: Asset[] = [];

    for (const job of JOBS) {
      const existingPng = path.join(outDir, `${job.id}.png`);
      if (fs.existsSync(existingPng)) {
        // 断点续跑：已生成的图不重复生成，但补齐 manifest 记录
        made.push(job.name);
        seq += 1;
        newAssets.push({
          id: `asset_${String(seq).padStart(3, '0')}`,
          type: 'diagram',
          path: `diagrams/${job.id}.png`,
          title: job.name,
          description: `基于项目事实生成的${job.name}（drawio 源文件同目录）`,
          tags: ['diagram', job.id.replace(/-/g, '_')],
          source: 'generated',
          recommended_for: ['business-plan', 'ppt', 'patent'],
        });
        continue;
      }
      try {
        await genDiagram(projectId, job, outDir, made, newAssets);
      } catch (err) {
        // 单图失败不拖垮整个任务（PRD §61 验收线：架构图+功能图各≥1）
        jobErrors.push(`${job.name}: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
      }
    }

    if (newAssets.length) {
      // 统一编号后写入 manifest（跳过分支与新生成分支共用）
      newAssets.forEach((a, i) => {
        a.id = `asset_${String(seq + 1 + i).padStart(3, '0')}`;
      });
      addAssets(projectId, newAssets);
    }
    if (made.length < 2) {
      throw new Error(`架构图生成成功数不足（${made.length}）：${jobErrors.join('；')}`);
    }
    if (jobErrors.length) console.warn(`[diagrams] 部分图未生成：${jobErrors.join('；')}`);
    touch(projectId);
    setTaskStatus(projectId, 'diagrams', 'done');
    return { diagrams: made };
  } catch (err) {
    setTaskStatus(projectId, 'diagrams', 'failed');
    throw err;
  }
}

async function genDiagram(
  projectId: string,
  job: DiagramJob,
  outDir: string,
  made: string[],
  newAssets: Asset[],
): Promise<void> {
  let contentJson = await genContentJson(projectId, job);
  const specPath = path.join(outDir, `${job.id}-spec.md`);
  fs.writeFileSync(specPath, `# ${job.name}\n\n\`\`\`json\n${contentJson}\n\`\`\`\n`, 'utf8');

  const drawioPath = path.join(outDir, `${job.id}.drawio`);
  const pngPath = drawioPath.replace(/\.drawio$/, '.png');

  if (job.kind === 'layered') {
    const spec = JSON.parse(contentJson) as LayeredSpec;
    fs.writeFileSync(drawioPath, layeredToDrawio(spec), 'utf8');
  } else {
    const script = { 'framework-3col': 'framework_3col.py', 'stageflow-3col': 'stageflow_3col.py', 'roadmap-5band': 'roadmap_5band.py' }[job.kind];
    const tmpJson = path.join(outDir, `${job.id}.content.json`);
    fs.writeFileSync(tmpJson, contentJson, 'utf8');
    let r = runPy([path.join(SCI_BOX, 'scripts', script), tmpJson, '-o', drawioPath], outDir);
    if (!r.ok) {
      // 自动修复一次（PRD §72）：把容量报错反馈给 LLM，要求缩短文字后重试
      const shortened = await chatCompletion([
        {
          role: 'system',
          content:
            '你是图表内容编辑。下面是 sci-box 模板的容量检查报错：文字超出槽位尺寸。' +
            '请缩短对应节点的文字（每处最多删字/换更短的词，不得改变含义与结构），只输出修正后的完整 JSON，不要解释。',
        },
        { role: 'user', content: `原 JSON：\n${contentJson}\n\n报错：\n${r.output.slice(-500)}` },
      ]);
      const m2 = /\{[\s\S]*\}/.exec(shortened);
      if (!m2) throw new Error(`sci-box ${script} 失败：${r.output.slice(-400)}`);
      contentJson = m2[0].trim();
      fs.writeFileSync(tmpJson, contentJson, 'utf8');
      r = runPy([path.join(SCI_BOX, 'scripts', script), tmpJson, '-o', drawioPath], outDir);
      if (!r.ok) throw new Error(`sci-box ${script} 失败（已缩短重试一次）：${r.output.slice(-400)}`);
    }
  }

  // 校验
  const check = runPy([path.join(SCI_BOX, 'scripts', 'check_layout.py'), drawioPath], outDir);
  if (!check.ok) console.warn(`[diagrams] ${job.id} check_layout 未通过：`, check.output.slice(-200));

  // 导出 PNG
  exportPng(drawioPath);
  if (!fs.existsSync(pngPath)) throw new Error(`${job.id}.png 未生成`);

  newAssets.push({
    id: 'pending',
    type: 'diagram',
    path: `diagrams/${job.id}.png`,
    title: job.name,
    description: `基于项目事实生成的${job.name}（drawio 源文件同目录）`,
    tags: ['diagram', job.id.replace(/-/g, '_')],
    source: 'generated',
    recommended_for: ['business-plan', 'ppt', 'patent'],
  });
  made.push(job.name);
}
