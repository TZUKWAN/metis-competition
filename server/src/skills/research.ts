/**
 * research.ts — 联网调研（PRD §7）
 * 搜索市场/政策/竞品/技术 → 保存 sources.json → 生成 research/*.md → 更新 facts.json
 * 所有外部数据必须带来源（PRD 硬规则4）；无搜索 key 时如实报 needs_input，不伪造来源。
 */
import fs from 'node:fs';
import path from 'node:path';
import { chatCompletion, getLlmConfig } from '../llm.js'
import { getPrompt } from '../settings.js';
import { projectDir, readFacts, readJsonArr, setTaskStatus, touch, writeJson, type SourceItem } from '../workspace.js';
import { extractPage, getSearchProvider, type SearchResultItem } from './search.js';

interface ResearchQuery {
  usedFor: string;
  query: string;
  fileHint: 'market' | 'policy' | 'competitor' | 'technology';
}

function buildQueries(projectName: string, summary: string): ResearchQuery[] {
  const base = `${projectName} ${summary}`.slice(0, 60);
  return [
    { usedFor: 'market_size', query: `${base} 市场规模 行业报告 2025 2026`, fileHint: 'market' },
    { usedFor: 'policy', query: `${base} 国家政策 指导意见 发展规划`, fileHint: 'policy' },
    { usedFor: 'competitor', query: `${base} 竞品 对比 产品`, fileHint: 'competitor' },
    { usedFor: 'technology', query: `${base} 技术趋势 研究进展`, fileHint: 'technology' },
    { usedFor: 'business_model', query: `${base} 商业模式 定价 收费`, fileHint: 'market' },
  ];
}

function nextSourceId(existing: SourceItem[]): string {
  let max = 0;
  for (const s of existing) {
    const m = /^src_(\d+)$/.exec(s.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `src_${String(max + 1).padStart(3, '0')}`;
}

export async function runResearch(projectId: string): Promise<{ sources: number; files: string[] }> {
  setTaskStatus(projectId, 'research', 'running');
  try {
    const search = getSearchProvider();
    if (!search) throw new Error('未配置搜索能力：请设置 SEARCH_API_KEY（SEARCH_PROVIDER=serper|tavily，默认 serper）');
    if (!getLlmConfig()) throw new Error('调研总结需要 LLM（COMP_LLM_API_BASE/KEY/MODEL 未配置）');

    const dir = projectDir(projectId);
    const facts = readFacts(projectId);
    const projectName = facts.find((f) => f.key === 'project_name')?.value ?? '项目';
    const summary = facts.find((f) => f.key === 'summary')?.value ?? '';

    const sourcesFile = path.join(dir, 'sources.json');
    const sources = readJsonArr<SourceItem>(sourcesFile);
    const collected: { item: SearchResultItem; usedFor: string; text?: string }[] = [];

    // 1. 搜索 + 抓取（每个查询抓前 2 页正文，控制耗时）
    for (const q of buildQueries(projectName, summary)) {
      const results = await search.search(q.query, 6);
      for (const r of results.slice(0, 4)) {
        if (sources.some((s) => s.url === r.url) || collected.some((c) => c.item.url === r.url)) continue;
        collected.push({ item: r, usedFor: q.usedFor });
      }
      for (const r of results.slice(0, 2)) {
        const entry = collected.find((c) => c.item.url === r.url);
        if (!entry) continue;
        try {
          const page = await extractPage(r.url);
          entry.text = `标题：${page.title}\n${page.text}`.slice(0, 4000);
        } catch {
          entry.text = undefined; // 抓取失败保留摘要
        }
      }
    }

    // 2. 写 sources.json（保存真实来源，PRD §7.2）
    const accessed = new Date().toISOString();
    for (const c of collected) {
      sources.push({
        id: nextSourceId(sources),
        title: c.item.title,
        url: c.item.url,
        publisher: new URL(c.item.url).hostname,
        date: '',
        accessed_at: accessed,
        summary: c.item.snippet.slice(0, 300),
        used_for: [c.usedFor],
      });
    }
    writeJson(sourcesFile, sources);

    // 3. 生成 research/*.md（LLM 基于真实抓取内容写作，标注来源 id）
    const material = collected
      .map((c, i) => `[S${i}] ${c.item.title} (${c.item.url})\n用途：${c.usedFor}\n${c.text ?? c.item.snippet}`)
      .join('\n\n---\n\n')
      .slice(0, 24_000);

    const fileNames = { market: 'market.md', policy: 'policy.md', competitor: 'competitor.md', technology: 'technology.md' } as const;
    const fileTitles = { market: '市场分析', policy: '政策环境', competitor: '竞品分析', technology: '技术趋势' } as const;
    const written: string[] = [];
    for (const hint of ['market', 'policy', 'competitor', 'technology'] as const) {
      const relevant = collected
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.usedFor === fileHintToUsedFor(hint) || (hint === 'market' && c.usedFor === 'business_model'));
      if (relevant.length === 0) continue;
      const excerpt = relevant.map(({ c, i }) => `[S${i}] ${c.item.title}\n${c.text ?? c.item.snippet}`).join('\n\n---\n\n').slice(0, 12_000);
      const md = await chatCompletion([
        {
          role: 'system',
          content:
            getPrompt('prompt.research_summary', (`你是竞赛项目调研员，为"${projectName}"（${summary}）撰写${fileTitles[hint]}初稿。` +
            '要求：平实专业、逻辑严谨、不编造数据；每个关键数据后用 [S数字] 标注来源编号；' +
            '数据找不到就写"公开资料有限，待补充"，不要虚构。输出 Markdown，300-600字。'))},
        { role: 'user', content: excerpt },
      ]);
      fs.writeFileSync(path.join(dir, 'research', fileNames[hint]), `# ${fileTitles[hint]}\n\n${md}\n`, 'utf8');
      written.push(`research/${fileNames[hint]}`);
    }

    // 4. research-summary.md + facts 更新
    const summaryMd = await chatCompletion([
      {
        role: 'system',
        content:
          getPrompt('prompt.research_summary', (`基于以下调研材料，为"${projectName}"写 research-summary.md 摘要：目标用户、核心痛点、市场规模要点、3-5个竞品、政策依据、技术趋势。` +
          '数据后标注 [S数字] 来源；300-500字；平实专业。'))},
      { role: 'user', content: material.slice(0, 12_000) },
    ]);
    fs.writeFileSync(path.join(dir, 'research', 'research-summary.md'), `# 调研摘要\n\n${summaryMd}\n`, 'utf8');
    written.push('research/research-summary.md');

    const factsJson = await chatCompletion([
      {
        role: 'system',
        content:
          '从调研材料中提取项目关键事实，只输出 JSON 数组，每项：{"key":"英文下划线","label":"中文名","value":"简短值","type":"verified_external|assumption","source":"src_编号或research"}。' +
          `可选 key：target_user, pain_point, market_size, growth_trend, competitors, policy_support, tech_stack, business_model, pricing。没有依据的不要输出。项目：${projectName}，${summary}`,
      },
      { role: 'user', content: material.slice(0, 12_000) },
    ]);
    const jsonMatch = /\[[\s\S]*\]/.exec(factsJson);
    if (jsonMatch) {
      try {
        const extracted = JSON.parse(jsonMatch[0]) as { key: string; label: string; value: string; type: string; source: string }[];
        const current = readFacts(projectId);
        for (const e of extracted) {
          if (current.some((f) => f.key === e.key)) continue;
          current.push({ key: e.key, label: e.label, value: e.value, type: e.type === 'assumption' ? 'assumption' : 'verified_external', source: e.source, confirmed: false });
        }
        const { writeFacts } = await import('../workspace.js');
        writeFacts(projectId, current);
      } catch {
        // 事实提取失败不阻塞调研本身
      }
    }

    touch(projectId);
    setTaskStatus(projectId, 'research', 'done');
    return { sources: collected.length, files: written };
  } catch (err) {
    setTaskStatus(projectId, 'research', 'failed');
    throw err;
  }
}

function fileHintToUsedFor(hint: 'market' | 'policy' | 'competitor' | 'technology'): string {
  return { market: 'market_size', policy: 'policy', competitor: 'competitor', technology: 'technology' }[hint];
}
