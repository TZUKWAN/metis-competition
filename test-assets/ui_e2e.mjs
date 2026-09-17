import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
const shot = (n) => page.screenshot({ path: `D:/metis竞赛/test-assets/e2e-${n}.png` });
const wait = (ms) => page.waitForTimeout(ms);

// ===== 场景 A：新建项目 → 选成果 → 五问 → 自动执行 =====
await page.goto('http://localhost:8787/', { waitUntil: 'networkidle', timeout: 20000 });
await wait(800);
await page.getByText('+ 新建项目').click();
await wait(1200);
await page.getByText('选择要制作的成果（可多选）').waitFor({ timeout: 8000 });
await page.getByText('商业计划书', { exact: true }).click();
await page.getByText('路演 PPT', { exact: true }).click();
await page.getByText('产品 Demo', { exact: true }).click();
await shot('a2-selected');
await page.getByRole('button', { name: '继续' }).click();
await wait(1500);
const q1 = await page.getByText('这个项目主要面向什么市场', { exact: false }).count();
console.log('A1: Q1 shown =', q1 > 0);

// ===== 场景 D：刷新恢复 =====
await page.reload({ waitUntil: 'networkidle' });
await wait(1800);
const q1after = await page.getByText('这个项目主要面向什么市场', { exact: false }).count();
console.log('D: reload 后 Q1 仍在 =', q1after > 0);

// ===== 回答五问（UI 第一问，其余 API 直发加速） =====
await page.getByPlaceholder(/描述你的想法/).fill('面向高校校园周边的小型种植户和园艺爱好者');
await page.getByRole('button', { name: '发送' }).click();
await wait(20000);
const q2 = await page.getByText('你希望这个项目最终实际做成什么样', { exact: false }).count();
console.log('A2: Q2 shown =', q2 > 0);
await shot('a4-q2');

const projectId = await page.evaluate(() => localStorage.getItem('metis:lastProject'));
console.log('project =', projectId);

// 通过 API 把剩下四问答完
const answer = async (msg) => {
  const res = await fetch(`http://localhost:8787/api/projects/${projectId}/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg }),
  });
  return await res.text();
};
console.log('Q3:', (await answer('主要卖给学校农业实验社团和个人，算 SaaS 订阅加硬件套餐吧')).slice(0, 60));
console.log('Q4:', (await answer('团队三个人，会写代码和做设计，学校提供了实验田')).slice(0, 60));
console.log('Q5:', (await answer('山东理工大学')).slice(0, 60));

// ===== onboarding 结束：总结 + 自动执行 =====
await wait(6000);
await page.reload({ waitUntil: 'networkidle' });
await wait(2500);
const summaryShown = await page.getByText('我已经基本了解这个项目', { exact: false }).count();
const toolRunning = await page.getByText('调研市场与竞品', { exact: false }).count();
console.log('A3: 总结出现 =', summaryShown > 0, '| 工具块出现 =', toolRunning > 0);
await shot('a5-autorun');

// 右栏状态
const state = await (await fetch(`http://localhost:8787/api/projects/${projectId}/state`)).json();
console.log('A-state: selected =', JSON.stringify(state.project.selected_outputs), '| auto_running =', state.auto_running);
console.log('A-state: 名称 =', state.project.name);
const runTool = await page.evaluate(() => {
  const msgs = JSON.parse(localStorage.getItem('noop') || 'null');
  return null;
});

// ===== 场景 B：只选商业计划书（API 驱动） =====
const p2 = await (await fetch('http://localhost:8787/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
const bid = p2.project.project_id;
await fetch(`http://localhost:8787/api/projects/${bid}/onboarding/select`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outputs: ['business_plan'] }) });
for (const m of ['大学生考研人群', '刷题与规划工具', '会员制', '无', '测试大学']) {
  await fetch(`http://localhost:8787/api/projects/${bid}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: m }) });
}
await wait(3000);
const bstate = await (await fetch(`http://localhost:8787/api/projects/${bid}/state`)).json();
console.log('B: selected =', JSON.stringify(bstate.project.selected_outputs), '| 应只有 business_plan');
const btasks = Object.fromEntries(bstate.tasks.map((t) => [t.id, t.status]));
console.log('B: ppt 任务 =', btasks.ppt, '| patent 任务 =', btasks.patent, '| research 任务 =', btasks.research);

// ===== 场景 E：修改 Prompt → 生效 =====
const pr = await (await fetch('http://localhost:8787/api/prompts')).json();
await fetch('http://localhost:8787/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompts: { 'prompt.research_summary': '【测试覆盖】这是被设置页覆盖后的调研提示词。' } }) });
const pr2 = await (await fetch('http://localhost:8787/api/prompts')).json();
const target = pr2.prompts.find((p) => p.key === 'prompt.research_summary');
console.log('E: override 生效 =', target.override.includes('【测试覆盖】'));
// 恢复默认
await fetch('http://localhost:8787/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompts: { 'prompt.research_summary': '' } }) });

// ===== 场景 C：已完成项目补做专利（用 comp_003） =====
await fetch(`http://localhost:8787/api/projects/comp_003/outputs/add`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outputs: ['patent'] }) });
await wait(1500);
const c3 = await (await fetch('http://localhost:8787/api/projects/comp_003/state')).json();
console.log('C: comp_003 selected 含 patent =', c3.project.selected_outputs.includes('patent'), '| patent 任务 =', c3.tasks.find((t) => t.id === 'patent')?.status);

await browser.close();
console.log('page errors:', JSON.stringify(errors));
process.exit(0);
