/**
 * qa.ts — 最终检查与答辩辅助（PRD §44–47）
 * consistency-report.md（只报告冲突，不擅自批量改）、fact-check.md（无来源数据/虚构成果等）、
 * defense-questions.md（20 普通 + 10 技术 + 10 商业 + 10 尖锐）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { chatCompletion, getLlmConfig } from '../llm.js'
import { getPrompt } from '../settings.js';
import { projectDir, readFacts, readJsonArr, readJsonFile, setTaskStatus, touch, type SourceItem } from '../workspace.js';

function requireLlm(): void {
  if (!getLlmConfig()) throw new Error('QA 需要 LLM（未配置）');
}

function readCap(dir: string, rel: string, cap = 6000): string {
  const f = path.join(dir, rel);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').slice(0, cap) : '（不存在）';
}

export async function runQaConsistency(projectId: string): Promise<{ reports: string[] }> {
  requireLlm();
  setTaskStatus(projectId, 'qa_consistency', 'running');
  try {
    const dir = projectDir(projectId);
    const qaDir = path.join(dir, 'qa');
    fs.mkdirSync(qaDir, { recursive: true });

    const facts = readFacts(projectId);
    const factsMd = facts.map((f) => `${f.key} | ${f.label} | ${f.value} | ${f.type} | confirmed=${f.confirmed}`).join('\n');
    const plan = readCap(dir, 'business-plan/business-plan.md', 12000);
    const patent = readCap(dir, 'patent/disclosure.md', 5000);
    const copyright = readCap(dir, 'software-copyright/application-info.md', 3000);
    const slides = readCap(dir, 'ppt/slide-plan.json', 4000);
    const sources = readJsonArr<SourceItem>(path.join(dir, 'sources.json'));

    // 1. 一致性检查（§44 十二项）
    const consistency = await chatCompletion([
      {
        role: 'system',
        content:
          getPrompt('prompt.qa_consistency', ('你是交付物质检员。逐项检查以下交付物之间是否存在冲突，只报告发现的问题，不要修改任何文件。检查项：项目名称/产品名称/核心功能/核心技术/技术架构/团队成员/导师/客户数量/知识产权数量/财务数据/市场规模/项目阶段。输出 Markdown：\n' +
          '# 一致性检查报告\n\n每项一节：检查项 | 各交付物中的表述 | 是否一致 | 冲突说明（如有） | 建议（仅供人参考）。\n最后给"严重冲突数/轻微冲突数/一致项数"汇总。'))},
      {
        role: 'user',
        content: `## facts.json\n${factsMd}\n\n## 商业计划书（摘录）\n${plan}\n\n## slide-plan.json\n${slides}\n\n## 专利交底书（摘录）\n${patent}\n\n## 软著申请表信息（摘录）\n${copyright}`,
      },
    ]);
    fs.writeFileSync(path.join(qaDir, 'consistency-report.md'), consistency + '\n', 'utf8');

    // 2. 事实检查（§45）
    const factCheck = await chatCompletion([
      {
        role: 'system',
        content:
          '你是事实核查员。检查商业计划书中：无来源的数据、可能虚构的成果（客户/收入/合作/融资/专利授权/媒体报道）、夸大的技术、把预测写成事实、把概念图写成实物成果。' +
          '结合 sources.json 判断数据是否有来源。输出 Markdown：# 事实核查报告\n\n| 位置（章节） | 表述 | 问题类型 | 依据 | 建议改法 |\n无问题也要明说"未发现"。',
      },
      {
        role: 'user',
        content: `## sources.json\n${sources.map((s) => `${s.id}: ${s.title} ${s.url} 用途:${s.used_for.join('/')}`).join('\n') || '（无外部来源）'}\n\n## 商业计划书（摘录）\n${plan}`,
      },
    ]);
    fs.writeFileSync(path.join(qaDir, 'fact-check.md'), factCheck + '\n', 'utf8');

    // 3. PPT 覆盖检查（§46；PPT 未生成时如实说明）
    const pptCheck = await chatCompletion([
      {
        role: 'system',
        content:
          '你是路演 PPT 质检员。根据 slide-plan.json 检查 PPT 是否覆盖：市场/痛点/产品截图/技术架构/成果/竞品/商业模式/团队/财务/发展规划/社会价值。输出 Markdown 清单：覆盖项 ✅/❌ + 页码 + 一句话评价；若 PPT 尚未生成，输出"PPT 尚未生成，本检查待 PPT 完成后重新执行"。',
      },
      { role: 'user', content: `## slide-plan.json\n${slides}` },
    ]);
    fs.writeFileSync(path.join(qaDir, 'ppt-check.md'), pptCheck + '\n', 'utf8');

    touch(projectId);
    setTaskStatus(projectId, 'qa_consistency', 'done');
    return { reports: ['qa/consistency-report.md', 'qa/fact-check.md', 'qa/ppt-check.md'] };
  } catch (err) {
    setTaskStatus(projectId, 'qa_consistency', 'failed');
    throw err;
  }
}

export async function runDefense(projectId: string): Promise<{ questions: number }> {
  requireLlm();
  setTaskStatus(projectId, 'defense', 'running');
  try {
    const dir = projectDir(projectId);
    const qaDir = path.join(dir, 'qa');
    fs.mkdirSync(qaDir, { recursive: true });

    const plan = readCap(dir, 'business-plan/business-plan.md', 10000);
    const facts = readFacts(projectId);
    const rules = readJsonFile<Record<string, unknown>>(path.join(dir, 'rules.json')) ?? {};
    const scoreItems = JSON.stringify(rules.score_items ?? []);

    const md = await chatCompletion([
      {
        role: 'system',
        content:
          '你是竞赛答辩教练。基于商业计划书、项目事实与比赛评分项，生成答辩问题清单。输出 Markdown，分四部分：\n' +
          '## 一、普通问题（20个）## 二、技术问题（10个）## 三、商业问题（10个）## 四、尖锐问题（10个，模拟苛刻评委）\n' +
          '每个问题附：建议回答要点（3条以内）/ 涉及的真实事实 / 不能乱说的地方（如数据无来源、成果未落地）。问题必须结合项目真实内容，不要泛泛而谈。',
      },
      {
        role: 'user',
        content: `## 项目事实\n${facts.map((f) => `${f.label}: ${f.value}`).join('\n')}\n\n## 比赛评分项\n${scoreItems}\n\n## 商业计划书（摘录）\n${plan}`,
      },
    ]);
    const questionCount = (md.match(/^###?\s*\d+/gm) ?? []).length;
    fs.writeFileSync(path.join(qaDir, 'defense-questions.md'), `# 答辩问题与建议\n\n${md}\n`, 'utf8');

    touch(projectId);
    setTaskStatus(projectId, 'defense', 'done');
    return { questions: questionCount };
  } catch (err) {
    setTaskStatus(projectId, 'defense', 'failed');
    throw err;
  }
}
