const BASE = 'http://localhost:8787';
const NL = String.fromCharCode(10);
const post = async (url, body) => {
  const res = await fetch(BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const text = await res.text();
  if (text.startsWith('data:')) {
    const lines = text.split(NL).filter((l) => l.startsWith('data:'));
    try {
      const last = JSON.parse(lines[lines.length - 1].slice(5).trim());
      return last.message ?? last;
    } catch { return text; }
  }
  return JSON.parse(text);
};
const get = async (url) => (await fetch(BASE + url)).json();

const p = await post('/api/projects');
const id = p.project.project_id;
console.log('project:', id);

await post(`/api/projects/${id}/onboarding/select`, { outputs: ['demo', 'business_plan', 'ppt'] });
let state = await get(`/api/projects/${id}/state`);
console.log('step after select:', state.project.onboarding.step);

const answers = [
  '面向高校校园周边的小型种植户和都市园艺爱好者，市场是智慧农业加校园消费',
  '做一个联网的花盆和种植箱，用户在手机上能看到湿度光照数据，自动浇水，还能拍成长日记分享',
  '硬件套装一次性购买，加上每月 10 元的会员数据服务和社区功能',
  '团队 3 人：硬件、前端、设计各一人；学校开放实验室和一块试验田；拿过校级创新创业训练立项',
  '山东理工大学',
];

for (const answer of answers) {
  const before = (await get(`/api/projects/${id}/state`)).project.onboarding.step;
  await post(`/api/projects/${id}/chat`, { message: answer });
  for (let t = 0; t < 60; t++) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = (await get(`/api/projects/${id}/state`)).project.onboarding.step;
    if (s !== before) break;
  }
  const after = (await get(`/api/projects/${id}/state`)).project.onboarding.step;
  console.log(`step ${before} -> ${after}`);
  if (after === 'done') break;
}

for (let t = 0; t < 12; t++) {
  state = await get(`/api/projects/${id}/state`);
  if (state.auto_running) break;
  await new Promise((r) => setTimeout(r, 5000));
}
console.log('final:', JSON.stringify({
  name: state.project.name,
  step: state.project.onboarding.step,
  selected: state.project.selected_outputs,
  auto_running: state.auto_running,
  research: state.tasks.find((t) => t.id === 'research')?.status,
}));
const chat = await get(`/api/projects/${id}/chat`);
const tools = chat.messages.filter((m) => m.kind === 'tool').map((m) => `${m.task}:${m.status}`);
console.log('tool blocks:', JSON.stringify(tools));
