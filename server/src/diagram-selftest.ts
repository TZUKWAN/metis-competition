/** diagram-selftest.ts — 无 LLM 验证分层架构图生成器：XML → check_layout → PNG 导出 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { layeredToDrawio } from './skills/diagram.js';

const spec = {
  title: 'METIS Competition 系统技术架构图',
  layers: [
    { name: '用户层', components: ['学生', '教师', '评委', '项目团队'] },
    { name: '应用层', components: ['产品 Demo', '商业计划书', '路演 PPT', '专利材料', '软著材料'] },
    { name: 'AI 能力层', components: ['联网调研 Agent', 'Demo 生成', '截图录屏', '图表生成', '一致性检查'] },
    { name: '数据层', components: ['facts.json 事实库', 'sources.json 来源库', 'assets 资产库', '项目工作空间'] },
    { name: '外部服务层', components: ['LLM API', '搜索 API', '图片生成 API', '视频生成 API', 'Playwright 浏览器'] },
  ],
  flows: ['联网调研 Agent>facts.json 事实库', 'Demo 生成>产品 Demo'],
};

const out = path.join(os.tmpdir(), 'diagram-test', 'layered.drawio');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, layeredToDrawio(spec), 'utf8');

const SCI = path.resolve(process.cwd(), '..', 'third_party', 'sci-box', 'skills', 'scibox-diagram');
const check = spawnSync('python', [path.join(SCI, 'scripts', 'check_layout.py'), out], { encoding: 'utf8' });
console.log('check_layout:', (check.stdout + check.stderr).trim().split('\n').pop());

const exp = spawnSync('python', [path.join(SCI, 'scripts', 'export_figure.py'), out, '--png-only'], {
  encoding: 'utf8',
  env: { ...process.env, PATH: `${path.resolve(process.cwd(), '..', 'bin')};${process.env.PATH}` },
});
console.log('export:', (exp.stdout + exp.stderr).trim().split('\n').pop());
console.log('png exists:', fs.existsSync(out.replace(/\.drawio$/, '.png')));
