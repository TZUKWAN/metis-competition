/**
 * copyright.ts — 软件著作权材料（PRD §40–41）
 * 流程参考 SoftwareCopyright-Skill（third_party/SoftwareCopyright-Skill/software-copyright-materials）。
 * 核心红线（§40.3）：代码材料只来自 METIS 生成并运行通过的 Demo 真实源码，禁止凭空生成。
 * 输出：application-info.docx / user-manual.docx / source-code.docx / design-description.docx → exported/
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chatCompletion, getLlmConfig } from '../llm.js';
import { projectDir, readFacts, readManifest, setTaskStatus, touch } from '../workspace.js';
import { summarizeCode } from './patent.js';

const LINES_PER_PAGE = 50;
const MAX_PAGES = 30;

function requireLlm(): void {
  if (!getLlmConfig()) throw new Error('软著材料生成需要 LLM（未配置）');
}

function readCap(dir: string, rel: string, cap = 3000): string {
  const f = path.join(dir, rel);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').slice(0, cap) : '';
}

/** 收集真实源码全文（demo/src），按鉴别材料规则截取前30页+后30页 */
function collectSource(projectId: string): { all: { path: string; content: string }[]; totalPages: number; truncated: boolean } {
  const demoDir = path.join(projectDir(projectId), 'demo');
  const srcDir = path.join(demoDir, 'src');
  const all: { path: string; content: string }[] = [];
  const walk = (dir: string, rel: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), childRel);
      else if (/\.(ts|tsx|css)$/.test(entry.name)) {
        all.push({ path: `src/${childRel}`, content: fs.readFileSync(path.join(dir, entry.name), 'utf8') });
      }
    }
  };
  walk(srcDir, '');
  const totalPages = Math.ceil(all.reduce((s, f) => s + f.content.split('\n').length, 0) / LINES_PER_PAGE);
  return { all, totalPages, truncated: totalPages > MAX_PAGES * 2 };
}

export async function runCopyright(projectId: string): Promise<{ outputs: string[] }> {
  requireLlm();
  setTaskStatus(projectId, 'copyright', 'running');
  try {
    const dir = projectDir(projectId);
    const outDir = path.join(dir, 'software-copyright');
    const expDir = path.join(outDir, 'exported');
    fs.mkdirSync(expDir, { recursive: true });

    const facts = readFacts(projectId);
    const productName = facts.find((f) => f.key === 'product_name')?.value ?? '未命名软件';
    const spec = readCap(dir, 'demo/PRODUCT_SPEC.md', 3500);
    const code = summarizeCode(projectId);
    const source = collectSource(projectId);
    const screenshots = readManifest(projectId).filter((a) => a.type === 'screenshot').slice(0, 6);

    const base = `软件名称：${productName}\n版本号：V1.0\n开发完成日期：待用户确认\n著作权人：待用户补充（请用户填写真实姓名/单位）\n开发方式：独立开发（待确认）\n权利取得方式：原始取得`;

    const common = `软件：${productName} V1.0\n\n产品规格：\n${spec}\n\n真实源码结构（${code.files.length} 个文件）：\n${code.files.map((f) => `${f.path} (${f.lines} 行)`).join('\n')}\n\n基本信息：\n${base}\n\n可用截图：\n${screenshots.map((s) => `${s.title} assets/${s.path}`).join('\n') || '（无，先执行截图任务）'}`;

    // 1. 申请表信息
    const appInfo = await chatCompletion([
      {
        role: 'system',
        content:
          '你是软著申请资料整理员。基于真实项目信息生成《申请表信息》文本（填报时对照复制）。字段：软件全称/简称、版本号、软件分类（应用软件/嵌入式等）、开发完成日期、发表状态、著作权人、开发方式、技术特点（200字内）、主要功能（与软件功能一一对应）、源程序量（行数，用给定数据计算）、开发环境、运行环境、编程语言。未知字段原样标注"待用户补充"，禁止编造。',
      },
      { role: 'user', content: `${common}\n\n源码总行数：${code.files.reduce((s, f) => s + f.lines, 0)} 行\n技术栈：见 package.json（React + TypeScript + Vite + Tailwind）` },
    ]);
    fs.writeFileSync(path.join(outDir, 'application-info.md'), `# 软件著作权申请表信息\n\n${appInfo}\n`, 'utf8');

    // 2. 用户手册（用真实截图 + 真实页面名）
    const manual = await chatCompletion([
      {
        role: 'system',
        content:
          `你是技术文档工程师，为软件《${productName}》编写软著用户手册。要求：\n` +
          '结构：一、软件概述（功能定位/运行环境/安装与启动）→ 二、功能使用说明（按真实页面逐个写：功能入口、操作步骤、界面说明，引用给出的真实截图编号）→ 三、常见问题。\n' +
          '手册面向审核员：步骤具体、用语规范；每个功能配截图引用（格式：见 图X <截图标题>）；禁止编造没有的页面或功能；说明文档中数据为演示模拟数据。',
      },
      { role: 'user', content: common },
    ]);
    const manualMd = path.join(outDir, 'user-manual.md');
    fs.writeFileSync(manualMd, manual + '\n', 'utf8');

    // 3. 源代码材料（前30页+后30页规则，全部来自真实源码）
    const pages: string[] = [];
    let current = '';
    let pageNo = 0;
    const flush = () => {
      if (current.trim()) pages.push(current);
      current = '';
    };
    for (const f of source.all) {
      const header = `// ==================== 文件：${f.path} ====================\n`;
      const lines = f.content.split('\n');
      for (const line of lines) {
        if (pageNo >= MAX_PAGES && source.truncated) break;
        if (current.split('\n').length >= LINES_PER_PAGE) {
          flush();
          pageNo++;
        }
        current += line + '\n';
      }
      current = header + current;
      if (pageNo >= MAX_PAGES && source.truncated) break;
    }
    flush();
    let codeMaterial = pages.join('\n\n');
    if (source.truncated) {
      // 追加后30页
      const tailPages: string[] = [];
      let tail = '';
      const allLines = source.all.map((f) => `// ===== ${f.path} =====\n${f.content}`).join('\n').split('\n');
      for (let i = Math.max(0, allLines.length - LINES_PER_PAGE * MAX_PAGES); i < allLines.length; i++) {
        if (tail.split('\n').length >= LINES_PER_PAGE) {
          tailPages.push(tail);
          tail = '';
        }
        tail += allLines[i] + '\n';
      }
      if (tail.trim()) tailPages.push(tail);
      codeMaterial += `\n\n// ==================== 后 ${MAX_PAGES} 页（鉴别材料规则）====================\n\n` + tailPages.join('\n\n');
    }
    fs.writeFileSync(path.join(outDir, 'source-code.md'), `# 源程序鉴别材料（共 ${source.totalPages} 页）\n\n> 材料全部来自本项目真实 Demo 源码（demo/src），共 ${code.files.reduce((s, f) => s + f.lines, 0)} 行。\n\n\`\`\`ts\n${codeMaterial}\n\`\`\`\n`, 'utf8');

    // 4. 设计说明书（如适用：结构化前端系统适用）
    const design = await chatCompletion([
      {
        role: 'system',
        content:
          `为软件《${productName}》编写设计说明书（软著材料）。结构：一、系统概述与设计目标；二、总体架构（分层说明，结合真实技术栈 React/TS/Vite）；三、模块设计（按真实源码文件逐个说明职责、输入输出、关键数据结构）；四、界面设计（结合真实页面与截图）；五、数据设计（mock 数据结构与 localStorage 使用）。必须与给定真实代码一致，禁止编造模块。`,
      },
      { role: 'user', content: `${common}\n\n代码摘录：\n${code.excerpt.slice(0, 3000)}` },
    ]);
    fs.writeFileSync(path.join(outDir, 'design-description.md'), design + '\n', 'utf8');

    // 5. 导出正式 DOCX
    const toDocx = (md: string, out: string) => {
      const res = spawnSync('pandoc', [md, '-o', out, '--resource-path', dir], { cwd: outDir, encoding: 'utf8', timeout: 60_000 });
      if (res.status !== 0) throw new Error(`pandoc 导出 ${out} 失败: ${(res.stderr ?? '').slice(-200)}`);
    };
    toDocx('application-info.md', path.join('exported', 'application-info.docx'));
    toDocx('user-manual.md', path.join('exported', 'user-manual.docx'));
    toDocx('source-code.md', path.join('exported', 'source-code.docx'));
    toDocx('design-description.md', path.join('exported', 'design-description.docx'));

    touch(projectId);
    setTaskStatus(projectId, 'copyright', 'done');
    return { outputs: ['software-copyright/application-info.md', 'software-copyright/user-manual.md', 'software-copyright/source-code.md', 'software-copyright/design-description.md', 'software-copyright/exported/*.docx'] };
  } catch (err) {
    setTaskStatus(projectId, 'copyright', 'failed');
    throw err;
  }
}
