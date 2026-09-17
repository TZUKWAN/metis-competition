/** bp-selftest.ts — 无 LLM 验证 M6 财务与导出链路：assumptions → 三表 → xlsx/PNG → 合并 → DOCX/PDF */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createProject, projectDir, WORKSPACE_ROOT } from './workspace.js';
import { runFinancial } from './skills/businessplan.js';

const meta = createProject({ name: '财务自测项目', summary: '验证财务与导出', project_type: 'software' });
const dir = projectDir(meta.project_id);
fs.mkdirSync(path.join(dir, 'business-plan'), { recursive: true });
fs.writeFileSync(
  path.join(dir, 'business-plan', 'assumptions.json'),
  JSON.stringify({ start_year: 2026, revenue: 1200000, growth_rates: [0.3, 0.35, 0.3], gross_margin: 0.55, sales_expense_rate: 0.12, management_expense_rate: 0.1, rd_expense_rate: 0.15, tax_rate: 0.25, initial_capital: 500000 }, null, 2),
);

await runFinancial(meta.project_id);

const bp = path.join(dir, 'business-plan');
assert.ok(fs.existsSync(path.join(bp, 'financial-model.xlsx')), 'xlsx 未生成');
assert.ok(fs.existsSync(path.join(bp, 'figures', 'revenue-growth.png')), 'revenue 图未生成');
assert.ok(fs.existsSync(path.join(bp, 'figures', 'profit-growth.png')), 'profit 图未生成');
assert.ok(fs.existsSync(path.join(bp, 'figures', 'cash-flow.png')), 'cashflow 图未生成');
assert.ok(fs.existsSync(path.join(bp, 'financial-summary.md')), 'summary 未生成');
assert.ok(fs.existsSync(path.join(dir, 'assets', 'charts', 'revenue-growth.png')), 'charts 资产未复制');
const summary = fs.readFileSync(path.join(bp, 'financial-summary.md'), 'utf8');
assert.ok(summary.includes('预测'), '预测标注缺失');
assert.ok(summary.includes('1200000'), '首年营收数字缺失');
console.log('PASS: 财务三表 + xlsx + 3 张 PNG + summary + 资产入库');

// 清理
fs.rmSync(path.join(WORKSPACE_ROOT, meta.project_id), { recursive: true, force: true });
console.log('BP FINANCE SELFTEST PASSED');
process.exit(0);
