/** export-selftest.ts — 无 LLM 验证合并 + pandoc DOCX + chromium PDF 导出 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createProject, projectDir, WORKSPACE_ROOT } from './workspace.js';
import { mergeSections, exportDocx, exportPdf } from './skills/businessplan.js';

const meta = createProject({ name: '导出自测项目', summary: '验证导出', project_type: 'software' });
const dir = projectDir(meta.project_id);
const secDir = path.join(dir, 'business-plan', 'sections');
fs.mkdirSync(secDir, { recursive: true });
fs.writeFileSync(path.join(secDir, '01-摘要.md'), '## 一、摘要\n\n本项目为导出链路自测。**加粗**与列表：\n\n- 第一项\n- 第二项\n\n图：首页截图\n\n资料来源：项目团队\n');
fs.writeFileSync(path.join(secDir, '02-公司介绍.md'), '## 二、公司介绍\n\n学生团队，尚未工商注册，计划毕业后注册公司。\n\n| 指标 | 值 |\n| --- | --- |\n| 成员 | 5人 |\n');

const merged = mergeSections(meta.project_id);
assert.ok(merged.includes('图1：'), '图编号未生成');
assert.ok(merged.includes('导出自测项目商业计划书'), '标题缺失');
console.log('PASS: 章节合并 + 图自动编号');

await exportDocx(meta.project_id);
const docx = path.join(dir, 'business-plan', 'business-plan.docx');
assert.ok(fs.existsSync(docx) && fs.statSync(docx).size > 5000, 'DOCX 缺失或过小');
console.log('PASS: DOCX 导出', fs.statSync(docx).size, 'bytes');

await exportPdf(meta.project_id);
const pdf = path.join(dir, 'business-plan', 'business-plan.pdf');
assert.ok(fs.existsSync(pdf) && fs.statSync(pdf).size > 10000, 'PDF 缺失或过小');
const head = fs.readFileSync(pdf).slice(0, 5).toString();
assert.ok(head.startsWith('%PDF'), '不是有效 PDF');
console.log('PASS: PDF 导出', fs.statSync(pdf).size, 'bytes');

fs.rmSync(path.join(WORKSPACE_ROOT, meta.project_id), { recursive: true, force: true });
console.log('EXPORT SELFTEST PASSED');
process.exit(0);
