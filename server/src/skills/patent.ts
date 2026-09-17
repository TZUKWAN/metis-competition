/**
 * patent.ts — 专利模块（PRD §38–39）
 * 方法论接入 patent-disclosure-skill（third_party/patent-disclosure-skill，交底流程参考其 skills/patent-disclosure/SKILL.md）。
 * 输入：项目 facts、Demo PRODUCT_SPEC、真实架构图内容、Demo 代码摘要、技术调研。
 * 输出：patent/patent-points.md（专利点挖掘+发明/实用新型初步判断）、patent/disclosure.md（技术交底书）、
 *      patent/claim-draft.md（初步权利要求建议）、patent/attachments/（附图拷贝）。
 * 红线（§39）：清楚区分自研/第三方组件/开源技术/API/公开算法；不把开源写成原创；不写已完成但没做的实验。
 */
import fs from 'node:fs';
import path from 'node:path';
import { chatCompletion, getLlmConfig } from '../llm.js'
import { getPrompt } from '../settings.js';
import { projectDir, readFacts, readManifest, setTaskStatus, touch } from '../workspace.js';
import { extractPage, getSearchProvider } from './search.js';

function requireLlm(): void {
  if (!getLlmConfig()) throw new Error('专利材料生成需要 LLM（未配置）');
}

function readCap(dir: string, rel: string, cap = 3000): string {
  const f = path.join(dir, rel);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').slice(0, cap) : '';
}

/** 真实 Demo 代码摘要：文件清单 + 每个文件前 40 行 + 总行数（软著与专利都要用，禁止凭空生成代码） */
export function summarizeCode(projectId: string, capFiles = 12): { files: { path: string; lines: number }[]; excerpt: string } {
  const demoDir = path.join(projectDir(projectId), 'demo');
  const srcDir = path.join(demoDir, 'src');
  const files: { path: string; lines: number }[] = [];
  const walk = (dir: string, rel: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), childRel);
      else if (/\.(ts|tsx|css|html)$/.test(entry.name)) {
        files.push({ path: `src/${childRel}`, lines: fs.readFileSync(path.join(dir, entry.name), 'utf8').split('\n').length });
      }
    }
  };
  walk(srcDir, '');
  const parts: string[] = [];
  for (const f of files.slice(0, capFiles)) {
    const content = fs.readFileSync(path.join(demoDir, f.path), 'utf8').split('\n').slice(0, 40).join('\n');
    parts.push(`// ${f.path}（共 ${f.lines} 行，前 40 行）\n${content}`);
  }
  return { files, excerpt: parts.join('\n\n') };
}

function patentContext(projectId: string): string {
  const dir = projectDir(projectId);
  const facts = readFacts(projectId);
  const arch = readCap(dir, path.join('assets', 'diagrams', 'system-architecture-spec.md'), 2500) ||
    readCap(dir, path.join('assets', 'diagrams', 'system-architecture.content.json'), 2500);
  const code = summarizeCode(projectId);
  return [
    `项目事实：\n${facts.map((f) => `${f.label}: ${f.value}`).join('\n')}`,
    `产品规格：\n${readCap(dir, 'demo/PRODUCT_SPEC.md', 2500)}`,
    `系统架构：\n${arch || '（未生成架构图，基于产品规格推断）'}`,
    `真实代码结构（${code.files.length} 个源文件）：\n${code.files.map((f) => `${f.path} (${f.lines} 行)`).join('\n')}\n\n代码摘录：\n${code.excerpt.slice(0, 3000)}`,
    `技术调研：\n${readCap(dir, 'research/technology.md', 1500)}`,
  ].join('\n\n');
}

async function noveltyCheck(projectId: string, points: string): Promise<string> {
  const search = getSearchProvider();
  if (!search) return '（未配置搜索 API，未做查新；建议人工补充检索）';
  const facts = readFacts(projectId);
  const name = facts.find((f) => f.key === 'project_name')?.value ?? '';
  try {
    const results = await search.search(`${name} 专利 技术方案`, 5);
    if (results.length === 0) return '未检索到明显相同方案的公开专利（轻量查新）。';
    const lines: string[] = [];
    for (const r of results.slice(0, 3)) {
      try {
        const page = await extractPage(r.url);
        lines.push(`- ${page.title}（${r.url}）：${page.text.slice(0, 120).replace(/\n/g, ' ')}`);
      } catch {
        lines.push(`- ${r.title}（${r.url}）：${r.snippet.slice(0, 100)}`);
      }
    }
    return ['轻量查新发现的相近公开信息（未做专业检索，仅供参考）：', ...lines].join('\n');
  } catch (err) {
    return `（查新失败：${err instanceof Error ? err.message : err}）`;
  }
}

export async function runPatent(projectId: string): Promise<{ outputs: string[] }> {
  requireLlm();
  setTaskStatus(projectId, 'patent', 'running');
  try {
    const dir = projectDir(projectId);
    const outDir = path.join(dir, 'patent');
    const attachDir = path.join(outDir, 'attachments');
    fs.mkdirSync(attachDir, { recursive: true });
    const ctx = patentContext(projectId);

    // 1. 专利点挖掘 + 类型初步判断（§38 重点）
    const points = await chatCompletion([
      {
        role: 'system',
        content:
          getPrompt('prompt.patent', ('你是专利代理师，为大学生竞赛项目做专利点挖掘。输出 Markdown：\n' +
          '## 一、可专利点清单（3-6个，每个含：名称、要解决的技术问题、技术方案要点、与现有技术的区别、建议类型 发明/实用新型/外观设计、自研成分）\n' +
          '## 二、发明/实用新型初步判断（哪些适合发明、哪些只能实用新型，理由）\n' +
          '## 三、技术成分划分（项目自研 / 第三方组件 / 开源技术 / 模型API / 公开算法，逐项列清，禁止把开源组件写成团队原创）\n' +
          '## 四、不建议申请的点（公知技术或缺乏新颖性的，说明原因）\n' +
          '要求：基于给定的真实技术材料，不得编造未做过的实验或性能数据；引用真实代码中的实现作为技术方案支撑。'))},
      { role: 'user', content: ctx },
    ]);
    fs.writeFileSync(path.join(outDir, 'patent-points.md'), points + '\n', 'utf8');

    // 2. 轻量查新
    const novelty = await noveltyCheck(projectId, points);
    fs.writeFileSync(path.join(outDir, 'novelty-notes.md'), `# 查新记录\n\n${novelty}\n`, 'utf8');

    // 3. 技术交底书（按 patent-disclosure-skill 交底结构）
    const disclosure = await chatCompletion([
      {
        role: 'system',
        content:
          '你是专利代理师，基于专利点挖掘结果撰写技术交底书（交底结构参考 patent-disclosure-skill）。输出 Markdown，结构：\n' +
          '# <项目/发明名称>技术交底书\n' +
          '## 一、技术领域\n## 二、背景技术（现有方案及缺陷，注明常识性描述）\n## 三、发明内容（要解决的技术问题/技术方案/有益效果）\n' +
          '## 四、技术方案详述（结合系统架构与真实代码实现，分模块说明，写明数据流/流程）\n' +
          '## 五、附图说明（列出应配的图：系统架构图、流程图等）\n## 六、具体实施方式（至少一个完整实施例，可结合 Demo 实现）\n' +
          '## 七、关键术语表\n' +
          '红线：区分自研与开源/第三方；预测性内容标注"拟/计划"；不得写未完成的实验结论。',
      },
      { role: 'user', content: `${ctx}\n\n专利点挖掘：\n${points.slice(0, 4000)}` },
    ]);
    fs.writeFileSync(path.join(outDir, 'disclosure.md'), disclosure + '\n', 'utf8');

    // 4. 初步权利要求建议
    const claims = await chatCompletion([
      {
        role: 'system',
        content:
          '基于技术交底书输出初步权利要求建议（非正式申请文件）：1条独立权利要求（系统/方法二选一，按交底核心方案）+ 4-8条从属权利要求。每条一句话，编号"1.""2."…。只输出权利要求正文。',
      },
      { role: 'user', content: disclosure.slice(0, 6000) },
    ]);
    fs.writeFileSync(path.join(outDir, 'claim-draft.md'), `# 初步权利要求建议（草稿）\n\n${claims}\n`, 'utf8');

    // 5. 附图：拷贝真实架构图/流程图进 attachments（§41 资产复用）
    const diagrams = readManifest(projectId).filter((a) => a.type === 'diagram');
    for (const d of diagrams) {
      const src = path.join(dir, 'assets', d.path);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(attachDir, path.basename(d.path)));
    }

    // 6. 交底书导出 docx
    const { spawnSync } = await import('node:child_process');
    spawnSync('pandoc', ['disclosure.md', '-o', 'disclosure.docx'], { cwd: outDir, encoding: 'utf8', timeout: 60_000 });

    touch(projectId);
    setTaskStatus(projectId, 'patent', 'done');
    return { outputs: ['patent/patent-points.md', 'patent/novelty-notes.md', 'patent/disclosure.md', 'patent/claim-draft.md', 'patent/disclosure.docx', 'patent/attachments/'] };
  } catch (err) {
    setTaskStatus(projectId, 'patent', 'failed');
    throw err;
  }
}
