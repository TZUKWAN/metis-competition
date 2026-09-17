/** rules-extract-selftest.ts — 无 LLM 验证比赛规则文件的 docx/pdf/txt 文本抽取 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createProject, projectDir, WORKSPACE_ROOT } from './workspace.js';
import { extractText } from './skills/rules.js';

const work = path.join(os.tmpdir(), 'rules-extract-test');
fs.mkdirSync(work, { recursive: true });

// 造真实 docx（python-docx）与 pdf（matplotlib PdfPages）
const mk = spawnSync('python', ['-c', `
import docx
d = docx.Document()
d.add_heading('大学生创新创业大赛通知', 0)
d.add_paragraph('路演时长八分钟，答辩五分钟。计划书不超过三十页。')
d.save(r'${work.replace(/\\/g, '/')}/notice.docx')
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
with PdfPages(r'${work.replace(/\\/g, '/')}/notice.pdf') as pdf:
    fig = plt.figure(figsize=(8, 4))
    fig.text(0.1, 0.7, 'Scoring: innovation 30 points, business 30 points')
    fig.text(0.1, 0.5, 'PPT limit 20 pages, pitch 8 minutes')
    pdf.savefig(fig)
    plt.close(fig)
print('fixtures ok')`], { encoding: 'utf8' });
assert.ok(mk.status === 0, 'fixture 生成失败: ' + mk.stderr);

const meta = createProject({ name: '规则抽取自测', summary: '验证 docx/pdf 抽取', project_type: 'software' });
const inputDir = path.join(projectDir(meta.project_id), 'input');
fs.copyFileSync(path.join(work, 'notice.docx'), path.join(inputDir, 'notice.docx'));
fs.copyFileSync(path.join(work, 'notice.pdf'), path.join(inputDir, 'notice.pdf'));

const docxText = await extractText(path.join(inputDir, 'notice.docx'));
assert.ok(docxText.includes('创新创业大赛'), 'docx 抽取内容不对: ' + docxText.slice(0, 80));
assert.ok(docxText.includes('八分钟'), 'docx 抽取缺关键字');
console.log('PASS: docx 抽取', docxText.length, '字符');

const pdfText = await extractText(path.join(inputDir, 'notice.pdf'));
assert.ok(pdfText.includes('innovation 30 points'), 'pdf 抽取内容不对: ' + pdfText.slice(0, 120));
console.log('PASS: pdf 抽取', pdfText.length, '字符');

fs.rmSync(path.join(WORKSPACE_ROOT, meta.project_id), { recursive: true, force: true });
console.log('RULES EXTRACT SELFTEST PASSED');
process.exit(0);
