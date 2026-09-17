/**
 * rules.ts — 比赛规则理解（PRD §6）
 * 读取 input/ 下的比赛通知/评分表 → rules.json + competition-rules.md
 * 没有规则文件时不阻塞：使用默认竞赛模式。
 */
import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { chatCompletion, getLlmConfig } from '../llm.js';
import { projectDir, setTaskStatus, touch } from '../workspace.js';

export interface ScoreItem {
  name: string;
  weight?: string;
  note?: string;
}

export interface RulesData {
  competition_name: string;
  track: string;
  ppt_page_limit: number | null;
  pitch_minutes: number | null;
  business_plan_required: boolean;
  demo_required: boolean;
  video_required: boolean;
  score_items: ScoreItem[];
  hard_requirements: string[];
  deadline: string;
}

export async function extractText(absPath: string): Promise<string> {
  const ext = path.extname(absPath).toLowerCase();
  if (ext === '.txt' || ext === '.md') return fs.readFileSync(absPath, 'utf8');
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: absPath });
    return result.value;
  }
  if (ext === '.pdf') {
    const parser = new PDFParse({ data: fs.readFileSync(absPath) });
    try {
      const data = await parser.getText();
      return data.text;
    } finally {
      await parser.destroy().catch(() => {});
    }
  }
  throw new Error(`不支持的规则文件格式: ${ext}`);
}

const DEFAULT_RULES: RulesData = {
  competition_name: '',
  track: '',
  ppt_page_limit: null,
  pitch_minutes: null,
  business_plan_required: true,
  demo_required: false,
  video_required: false,
  score_items: [],
  hard_requirements: [],
  deadline: '',
};

export async function runRules(projectId: string): Promise<{ rulesPath: string; summaryPath: string; usedInput: string | null }> {
  setTaskStatus(projectId, 'rules', 'running');
  try {
    const dir = projectDir(projectId);
    const inputDir = path.join(dir, 'input');
    const candidates = fs.existsSync(inputDir)
      ? fs.readdirSync(inputDir).filter((f) => ['.txt', '.md', '.docx', '.pdf'].includes(path.extname(f).toLowerCase()))
      : [];

    let rules = { ...DEFAULT_RULES };
    let md = '';
    let usedInput: string | null = null;

    if (candidates.length === 0) {
      // 无规则文件：默认竞赛模式，不阻塞
      md = [
        '# 比赛规则',
        '',
        '未提供比赛规则文件，系统使用默认竞赛模式继续生成。',
        '',
        '- 商业计划书：必需',
        '- PPT：无页数限制',
        '- Demo / 视频：建议准备',
      ].join('\n');
    } else {
      usedInput = `input/${candidates[0]}`;
      const text = (await extractText(path.join(inputDir, candidates[0]))).slice(0, 30_000);
      if (!getLlmConfig()) throw new Error('解析比赛规则需要 LLM（COMP_LLM_API_BASE/KEY/MODEL 未配置）');
      const resp = await chatCompletion([
        {
          role: 'system',
          content:
            '你是比赛规则解析器。从用户给出的比赛通知/评分表中提取结构化信息，只输出 JSON（不要输出其他内容）。' +
            'JSON 格式：{"competition_name":"比赛名称","track":"赛道","ppt_page_limit":数字或null,"pitch_minutes":数字或null,' +
            '"business_plan_required":true/false,"demo_required":true/false,"video_required":true/false,' +
            '"score_items":[{"name":"评分项","weight":"权重或分值","note":"说明"}],"hard_requirements":["硬性要求"],' +
            '"deadline":"截止日期原文或空字符串"}。提取不到的信息用 null 或空字符串，不要编造。',
        },
        { role: 'user', content: text },
      ]);
      const jsonMatch = /\{[\s\S]*\}/.exec(resp);
      if (!jsonMatch) throw new Error('LLM 未返回有效 JSON');
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      rules = {
        competition_name: String(parsed.competition_name ?? ''),
        track: String(parsed.track ?? ''),
        ppt_page_limit: typeof parsed.ppt_page_limit === 'number' ? parsed.ppt_page_limit : null,
        pitch_minutes: typeof parsed.pitch_minutes === 'number' ? parsed.pitch_minutes : null,
        business_plan_required: Boolean(parsed.business_plan_required ?? true),
        demo_required: Boolean(parsed.demo_required ?? false),
        video_required: Boolean(parsed.video_required ?? false),
        score_items: Array.isArray(parsed.score_items) ? (parsed.score_items as { name: string; weight?: string; note?: string }[]) : [],
        hard_requirements: Array.isArray(parsed.hard_requirements) ? parsed.hard_requirements.map(String) : [],
        deadline: String(parsed.deadline ?? ''),
      };
      const scoreTable = rules.score_items
        .map((s) => `| ${s.name} | ${s.weight ?? ''} | ${s.note ?? ''} |`)
        .join('\n');
      md = [
        '# 比赛规则',
        '',
        `- 比赛名称：${rules.competition_name || '未提取到'}`,
        `- 赛道：${rules.track || '未提取到'}`,
        `- 计划书要求：${rules.business_plan_required ? '必需' : '非必需'}`,
        `- PPT 要求：${rules.ppt_page_limit ? `不超过 ${rules.ppt_page_limit} 页` : '未明确页数限制'}`,
        `- 路演时长：${rules.pitch_minutes ? `${rules.pitch_minutes} 分钟` : '未明确'}`,
        `- Demo 要求：${rules.demo_required ? '必需' : '未要求'}`,
        `- 视频要求：${rules.video_required ? '必需' : '未要求'}`,
        `- 截止日期：${rules.deadline || '未提取到'}`,
        '',
        '## 评分项',
        '',
        '| 评分项 | 权重/分值 | 说明 |',
        '| --- | --- | --- |',
        scoreTable || '| 未提取到 | | |',
        '',
        '## 硬性要求',
        '',
        ...(rules.hard_requirements.length ? rules.hard_requirements.map((h) => `- ${h}`) : ['未提取到']),
        '',
        `> 来源文件：${usedInput}`,
      ].join('\n');
    }

    fs.writeFileSync(path.join(dir, 'rules.json'), JSON.stringify(rules, null, 2) + '\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'competition-rules.md'), md + '\n', 'utf8');
    touch(projectId);
    setTaskStatus(projectId, 'rules', 'done');
    return { rulesPath: 'rules.json', summaryPath: 'competition-rules.md', usedInput };
  } catch (err) {
    setTaskStatus(projectId, 'rules', 'failed');
    throw err;
  }
}
