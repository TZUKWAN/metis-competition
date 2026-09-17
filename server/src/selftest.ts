/**
 * selftest.ts — M1 验收自测（PRD §57）：
 * 1. 创建一个项目后工作目录完整产生
 * 2. 关闭（重新加载）后项目仍然存在
 * 3. 文件读写、事实库读写正常
 * 直接运行：npm run test -w server（不依赖 HTTP，直接调 workspace 层）
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  createProject,
  getProject,
  listProjects,
  readFacts,
  readProjectFile,
  setTaskStatus,
  TASK_ORDER,
  writeFacts,
  writeProjectFile,
  WORKSPACE_ROOT,
} from './workspace.js';

const REQUIRED_PATHS = [
  'project.json',
  'facts.json',
  'sources.json',
  'rules.json',
  'tasks.json',
  'context.md',
  'input',
  'demo',
  'assets/manifest.json',
  'assets/screenshots',
  'assets/diagrams',
  'assets/charts',
  'assets/generated-images',
  'assets/videos',
  'assets/team',
  'assets/certificates',
  'assets/ip',
  'research',
  'business-plan/sections',
  'business-plan/figures',
  'ppt/rendered',
  'patent',
  'software-copyright/exported',
  'qa',
];

const meta = createProject({ name: '自测项目', summary: '自测用项目', project_type: 'software' });
console.log(`created project: ${meta.project_id}`);

// 1. 目录完整性
const dir = path.join(WORKSPACE_ROOT, meta.project_id);
for (const rel of REQUIRED_PATHS) {
  assert.ok(fs.existsSync(path.join(dir, rel)), `missing: ${rel}`);
}
console.log('PASS: 项目目录结构完整');

// 2. tasks.json 顺序与初始状态
const { tasks } = getProject(meta.project_id);
assert.deepStrictEqual(tasks.map((t) => t.id), [...TASK_ORDER]);
assert.strictEqual(tasks[0].status, 'done');
assert.ok(tasks.slice(1).every((t) => t.status === 'waiting'));
console.log('PASS: tasks.json 固定顺序 + 初始状态');

// 3. 重开仍在（重新从磁盘读取）
const again = listProjects().find((p) => p.project_id === meta.project_id);
assert.ok(again, 'project lost after reload');
assert.strictEqual(again.name, '自测项目');
console.log('PASS: 项目持久化（重读仍在）');

// 4. 文件读写
writeProjectFile(meta.project_id, 'research/research-summary.md', '# 调研摘要\n自测内容\n');
const { abs, isText } = readProjectFile(meta.project_id, 'research/research-summary.md');
assert.ok(isText && fs.readFileSync(abs, 'utf8').includes('自测内容'));
console.log('PASS: 项目文件读写');

// 5. 事实库读写
writeFacts(meta.project_id, [
  { key: 'target_user', label: '目标客户', value: '高校创新创业团队', type: 'assumption', source: 'research/project-analysis', confirmed: false },
]);
assert.strictEqual(readFacts(meta.project_id).length, 1);
assert.strictEqual(readFacts(meta.project_id)[0].key, 'target_user');
console.log('PASS: facts.json 读写');

// 6. 任务状态更新
setTaskStatus(meta.project_id, 'research', 'running');
assert.strictEqual(getProject(meta.project_id).tasks.find((t) => t.id === 'research')?.status, 'running');
console.log('PASS: tasks.json 状态更新');

// 7. 路径越权防护
assert.throws(() => readProjectFile(meta.project_id, '../outside.txt'), /invalid path/);
console.log('PASS: 路径越权防护');

// 清理自测项目，避免污染正式 workspace
fs.rmSync(dir, { recursive: true, force: true });
console.log('\nALL M1 WORKSPACE TESTS PASSED');
