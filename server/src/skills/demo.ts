/**
 * demo.ts — 产品 Demo 生成与验证（PRD §8–10）
 * React + Vite + TypeScript + Tailwind v4 + 本地 mock 数据。
 * 流程：PRODUCT_SPEC.md → page-plan.json → 确定性脚手架 → 逐页 LLM 生成 →
 *       npm install → npm run build（失败自动修复一次）→ Playwright 基础测试（失败自动修复一次）
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chatCompletion, getLlmConfig } from '../llm.js'
import { getPrompt } from '../settings.js';
import { projectDir, readFacts, setTaskStatus, touch, type Fact } from '../workspace.js';
import { killPort, waitForPort } from './netutil.js';

const DEMO_PORT = 5199;

function requireLlm() {
  if (!getLlmConfig()) throw new Error('Demo 生成需要 LLM（COMP_LLM_API_BASE/KEY/MODEL 未配置）');
}

function factValue(facts: Fact[], key: string): string {
  return facts.find((f) => f.key === key)?.value ?? '';
}

function projectBrief(projectId: string): string {
  const facts = readFacts(projectId);
  const dir = projectDir(projectId);
  const researchFile = path.join(dir, 'research', 'research-summary.md');
  const research = fs.existsSync(researchFile) ? fs.readFileSync(researchFile, 'utf8').slice(0, 3000) : '（尚无调研资料）';
  const lines = facts.map((f) => `${f.label}: ${f.value}`).join('\n');
  const specFile = path.join(dir, 'demo', 'PRODUCT_SPEC.md');
  return [
    `项目事实：\n${lines}`,
    `调研摘要：\n${research}`,
    fs.existsSync(specFile) ? `已存在的 PRODUCT_SPEC（用户可能修改过，优先沿用）：\n${fs.readFileSync(specFile, 'utf8').slice(0, 3000)}` : '',
  ].filter(Boolean).join('\n\n');
}

// ---------- 1. PRODUCT_SPEC.md ----------

async function genSpec(projectId: string): Promise<string> {
  const dir = projectDir(projectId);
  const specPath = path.join(dir, 'demo', 'PRODUCT_SPEC.md');
  // 用户可能手工改过 spec（PRD §54），存在则沿用
  if (fs.existsSync(specPath) && fs.readFileSync(specPath, 'utf8').trim().length > 100) {
    return fs.readFileSync(specPath, 'utf8');
  }
  const md = await chatCompletion([
    {
      role: 'system',
      content:
        getPrompt('prompt.demo_spec', ('你是产品经理，为大学生竞赛项目写 Demo 产品规格 PRODUCT_SPEC.md。只输出 Markdown。' +
        '必须包含：目标用户、用户痛点、核心功能（3-5个）、页面列表（5-8个主要页面：入口/首页/核心功能1-3/结果或分析/数据看板）、' +
        '页面之间的流程、每个页面展示什么、哪些数据是模拟数据（必须明确标注）。' +
        '要求平实、可实现，不要写无法在前端静态实现的功能（不要后端、不要真实登录支付）。'))},
    { role: 'user', content: projectBrief(projectId) },
  ]);
  fs.writeFileSync(specPath, md + '\n', 'utf8');
  return md;
}

// ---------- 2. page-plan.json ----------

interface PagePlan {
  productName: string;
  pages: { path: string; file: string; name: string; purpose: string; core?: boolean }[];
}

async function genPagePlan(projectId: string, spec: string): Promise<PagePlan> {
  // 已有规划则沿用（重跑不漂移；用户手工改过也优先保留，PRD §54）
  const planFile = path.join(projectDir(projectId), 'demo', 'page-plan.json');
  if (fs.existsSync(planFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(planFile, 'utf8')) as PagePlan;
      if (Array.isArray(existing.pages) && existing.pages.length >= 3) return normalizePlan(existing);
    } catch {
      // 解析失败则重新生成
    }
  }
  const resp = await chatCompletion([
    {
      role: 'system',
      content:
        getPrompt('prompt.demo_spec', ('根据 PRODUCT_SPEC 输出页面规划，只输出 JSON：{"productName":"产品名","pages":[{"path":"/","file":"Home.tsx","name":"首页","purpose":"一句话说明","core":true/false}]}。' +
        '要求：5-8个页面；第一个 path 必须是 "/"；文件名为 PascalCase.tsx（只有文件名，不要带任何路径前缀），放在 src/pages/ 下；标记 3 个核心功能页 core=true。'))},
    { role: 'user', content: spec.slice(0, 6000) },
  ]);
  const jsonMatch = /\{[\s\S]*\}/.exec(resp);
  if (!jsonMatch) throw new Error('页面规划 LLM 输出不是有效 JSON');
  const plan = JSON.parse(jsonMatch[0]) as PagePlan;
  if (!Array.isArray(plan.pages) || plan.pages.length < 3) throw new Error('页面规划不合理');
  return normalizePlan(plan);
}

/** 规整页面规划：file 只留文件名，path 保证以 / 开头 */
function normalizePlan(plan: PagePlan): PagePlan {
  for (const p of plan.pages) {
    p.file = path.basename(String(p.file ?? 'Page.tsx')).replace(/[^\w.-]/g, '') || 'Page.tsx';
    if (!/\.tsx$/.test(p.file)) p.file += '.tsx';
    p.path = String(p.path ?? '/').startsWith('/') ? String(p.path) : `/${String(p.path ?? '')}`;
  }
  return plan;
}

// ---------- 3. 确定性脚手架 ----------

const SCAFFOLD: Record<string, (plan: PagePlan) => string> = {
  'package.json': () =>
    JSON.stringify(
      {
        name: 'metis-competition-demo',
        private: true,
        version: '0.1.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'tsc -b && vite build', preview: 'vite preview' },
        dependencies: {
          'lucide-react': '^0.469.0',
          react: '^19.1.0',
          'react-dom': '^19.1.0',
          'react-router-dom': '^7.1.1',
        },
        devDependencies: {
          '@tailwindcss/vite': '^4.1.0',
          '@types/react': '^19.1.0',
          '@types/react-dom': '^19.1.0',
          '@vitejs/plugin-react': '^4.4.0',
          tailwindcss: '^4.1.0',
          typescript: '^5.8.0',
          vite: '^6.3.0',
        },
      },
      null,
      2,
    ) + '\n',
  'vite.config.ts': () =>
    `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nimport tailwindcss from '@tailwindcss/vite';\n\nexport default defineConfig({\n  plugins: [react(), tailwindcss()],\n  server: { port: ${DEMO_PORT}, strictPort: true, host: '127.0.0.1' },\n  preview: { port: ${DEMO_PORT}, strictPort: true, host: '127.0.0.1' },\n});\n`,
  'tsconfig.json': () =>
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          useDefineForClassFields: true,
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          skipLibCheck: true,
          moduleResolution: 'bundler',
          allowImportingTsExtensions: true,
          resolveJsonModule: true,
          isolatedModules: true,
          noEmit: true,
          jsx: 'react-jsx',
          strict: true,
          noUnusedLocals: false,
          noUnusedParameters: false,
          noFallthroughCasesInSwitch: true,
        },
        include: ['src'],
      },
      null,
      2,
    ) + '\n',
  'index.html': (plan) =>
    `<!doctype html>\n<html lang="zh-CN">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>${plan.productName}</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n`,
  'src/index.css': () => `@import "tailwindcss";\n\nbody {\n  font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;\n}\n`,
  'src/main.tsx': () =>
    `import { StrictMode } from 'react';\nimport { createRoot } from 'react-dom/client';\nimport { HashRouter } from 'react-router-dom';\nimport App from './App';\nimport './index.css';\n\ncreateRoot(document.getElementById('root')!).render(\n  <StrictMode>\n    <HashRouter>\n      <App />\n    </HashRouter>\n  </StrictMode>,\n);\n`,
  'src/App.tsx': (plan) => {
    const imports = plan.pages.map((p) => `import ${p.file.replace('.tsx', '')} from './pages/${p.file.replace('.tsx', '')}';`).join('\n');
    const routes = plan.pages.map((p) => `        <Route path="${p.path}" element={<${p.file.replace('.tsx', '')} />} />`).join('\n');
    const navs = plan.pages.map((p) => `          <NavItem to="${p.path}" name="${p.name}" />`).join('\n');
    const navItem = [
      "function NavItem({ to, name }: { to: string; name: string }) {",
      '  return (',
      '    <NavLink',
      '      to={to}',
      '      className={({ isActive }) =>',
      "        'block rounded-lg px-3 py-2 text-sm transition-colors ' +",
      "        (isActive ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100')",
      '      }',
      '    >',
      '      {name}',
      '    </NavLink>',
      '  );',
      '}',
    ].join('\n');
    return [
      "import { Route, Routes, NavLink } from 'react-router-dom';",
      "import { type ReactNode } from 'react';",
      imports,
      '',
      navItem,
      '',
      'export default function App(): ReactNode {',
      '  return (',
      '    <div className="flex min-h-screen bg-slate-50">',
      '      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white p-4">',
      `        <div className="mb-4 px-3 py-2 text-base font-bold text-slate-800">${plan.productName}</div>`,
      '        <nav className="space-y-1">',
      navs,
      '        </nav>',
      '        <div className="mt-6 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">演示环境：页面数据为 Demo 模拟数据</div>',
      '      </aside>',
      '      <main className="flex-1 overflow-auto p-6">',
      '        <Routes>',
      routes,
      '        </Routes>',
      '      </main>',
      '    </div>',
      '  );',
      '}',
      '',
    ].join('\n');
  },
};

function writeScaffold(demoDir: string, plan: PagePlan): void {
  for (const [rel, make] of Object.entries(SCAFFOLD)) {
    const abs = path.join(demoDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, make(plan), 'utf8');
  }
  fs.mkdirSync(path.join(demoDir, 'src', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(demoDir, 'page-plan.json'), JSON.stringify(plan, null, 2) + '\n', 'utf8');
}

// ---------- 4. 逐页生成 ----------

async function genPages(projectId: string, spec: string, plan: PagePlan): Promise<void> {
  const demoDir = path.join(projectDir(projectId), 'demo');
  for (const page of plan.pages) {
    const target = path.join(demoDir, 'src', 'pages', page.file);
    if (fs.existsSync(target) && fs.readFileSync(target, 'utf8').trim().length > 50) continue; // 用户改过则不覆盖
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // 页面级重试：上游免费容量偶发返回空内容（llm 内部已重试 3 次，这里再兜底 3 轮并逐步要求精简）
    let code: string | null = null;
    for (let attempt = 0; attempt < 3 && !code; attempt++) {
      try {
        const raw = await chatCompletion(
          [
            {
              role: 'system',
              content:
                getPrompt('prompt.demo_page', (`你是资深前端工程师，为竞赛项目 Demo 编写 React 页面组件。产品：${plan.productName}。\n` +
                '硬性要求：\n' +
                `1. 只输出一个 tsx 文件的全部内容（首行以 export default 开头或包含 export default function），不要输出任何解释、不要 markdown 代码块标记。\n` +
                '2. React 19 + TypeScript + Tailwind CSS v4（类名 Utility 风格），可以 import { 图标 } from "lucide-react"。\n' +
                '3. 组件必须 export default，函数名与文件名一致。\n' +
                '4. 所有数据用组件内硬编码的 mock 数据（中文、贴合项目场景、具体不空洞），在页面明显位置放 <div className="text-xs text-amber-600">演示数据为模拟数据</div>。\n' +
                '5. 禁止 Lorem Ipsum、禁止占位英文、禁止与项目无关内容、禁止大面积空白。页面要有真实感：卡片、表格、图表感（可用 div+tailwind 模拟）、统计数字。\n' +
                '6. 不要使用未声明的变量；不要使用任何外部请求；不要新增依赖。\n' +
                '7. 视觉风格统一：白底、slate 系文字、blue-600 作为主色。\n' +
                '8. 页面顶部用 <h1 className="text-xl font-bold text-slate-800 mb-4">页面标题</h1>。' +
                (attempt > 0 ? `\n9. 输出务必精简：代码控制在 150 行以内，保证一次输出完整。` : '')))},
            { role: 'user', content: `PRODUCT_SPEC：\n${spec.slice(0, 5000)}\n\n本页职责：${page.purpose}${page.core ? '（核心功能页，内容要最丰富）' : ''}\n页面名称：${page.name}` },
          ],
          { temperature: 0.4 },
        );
        const cleaned = raw.replace(/```tsx?\n?/g, '').trim();
        if (cleaned.length >= 200) code = cleaned;
      } catch (err) {
        console.log(`[demo] 页面 ${page.file} 第 ${attempt + 1} 轮失败: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (!code) throw new Error(`页面 ${page.file} 连续生成失败（空返回/过短）`);
    fs.writeFileSync(target, code + '\n', 'utf8');
  }
}

// ---------- 5. 构建 ----------

function runNpm(demoDir: string, args: string[]): { ok: boolean; output: string } {
  const isWin = process.platform === 'win32';
  // Windows 上 .cmd 必须 shell:true（Node ≥18.20 安全策略，shell:false 直接 EINVAL）
  const res = spawnSync(isWin ? 'npm.cmd' : 'npm', args, { cwd: demoDir, encoding: 'utf8', timeout: 600_000, shell: isWin });
  const output = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  return { ok: res.status === 0, output: output.slice(-6000) };
}

async function buildWithAutoFix(projectId: string, spec: string, plan: PagePlan): Promise<void> {
  const demoDir = path.join(projectDir(projectId), 'demo');
  let attempt = runNpm(demoDir, ['run', 'build']);
  for (let round = 0; !attempt.ok && round < 1; round++) {
    // 自动修复一次（PRD §59）
      const fix = await chatCompletion([
        {
          role: 'system',
          content:
            '你是前端修复工程师。下面是 React+TS+Vite+Tailwind 项目的构建错误输出。' +
            '请输出修复方案：按文件给出完整替换内容，格式为每段：\n<<<FILE: 相对路径>>>\n内容\n<<<END>>>\n只输出需要修改的文件，不要解释。\n' +
            '硬性约束：只能修改 src/pages/ 下已存在的页面文件；禁止新建文件、禁止重写 src/App.tsx、src/main.tsx、vite.config.ts，禁止更换路由结构。',
        },
        { role: 'user', content: attempt.output.slice(-4000) },
      ]);
    applyFileBlocks(demoDir, fix);
    attempt = runNpm(demoDir, ['run', 'build']);
  }
  fs.mkdirSync(path.join(demoDir, 'test-results'), { recursive: true });
  fs.writeFileSync(path.join(demoDir, 'test-results', 'build.log'), attempt.output, 'utf8');
  if (!attempt.ok) throw new Error(`Demo 构建失败（已自动修复一次）：\n${attempt.output.slice(-1500)}`);
}

export function applyFileBlocks(baseDir: string, text: string): void {
  const re = /<<<FILE:\s*([^>]+)>>>\s*([\s\S]*?)<<<END>>>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const rel = m[1].trim();
    const abs = path.resolve(baseDir, rel);
    if (!abs.startsWith(path.resolve(baseDir))) continue;
    // 物理防护：修复轮曾把 App.tsx 重写成BrowserRouter+桩页面，导致整套富页面被旁路。
    // 只允许改已存在的页面/样式文件，禁止动脚手架与路由结构。
    const norm = path.relative(path.resolve(baseDir), abs).replace(/\\/g, '/');
    if (/^src\/(App|main)\.(tsx|jsx|js)$/i.test(norm) || /^vite\.config\.(ts|js)$/i.test(norm) || /^(package|tsconfig)\.json$/i.test(norm)) continue;
    if (/\.jsx$/i.test(norm) && !fs.existsSync(abs)) continue; // 禁止新增 jsx 旁路文件（.jsx 会被 vite 优先于 .tsx 解析）
    if (/^src\/pages\//i.test(norm) && !fs.existsSync(abs)) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, m[2].trim() + '\n', 'utf8');
  }
}

// ---------- 6. Playwright 基础测试（M3） ----------

export interface TestResult {
  ok: boolean;
  checks: { name: string; pass: boolean; detail?: string }[];
  consoleErrors: string[];
}

export async function runDemoTest(projectId: string, plan: PagePlan): Promise<TestResult> {
  const demoDir = path.join(projectDir(projectId), 'demo');
  const resultsDir = path.join(demoDir, 'test-results');
  fs.mkdirSync(resultsDir, { recursive: true });

  const server = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'preview'], {
    cwd: demoDir,
    stdio: 'ignore',
    detached: false,
    shell: process.platform === 'win32',
  });
  try {
    // 等待端口就绪
    await waitForPort(DEMO_PORT, 30_000);
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
      });
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 300)));

      const checks: TestResult['checks'] = [];
      // 首页能打开
      const homeResp = await page.goto(`http://127.0.0.1:${DEMO_PORT}/`, { waitUntil: 'networkidle', timeout: 30_000 });
      const homeOk = (homeResp?.status() ?? 500) < 400 && (await page.locator('h1').count()) > 0;
      checks.push({ name: '首页能打开且含标题', pass: homeOk });

      // 导航能切换 + 核心路径能走通
      for (const p of plan.pages.slice(0, 8)) {
        await page.goto(`http://127.0.0.1:${DEMO_PORT}/#${p.path}`, { waitUntil: 'networkidle', timeout: 20_000 }).catch(() => null);
        await page.waitForTimeout(400);
        // 只取 #root：布局中 <main> 嵌套在 #root 内，多元素 locator 会触发严格模式错误
        const hasContent = (await page.locator('#root').innerText().catch(() => '')).trim().length > 20;
        checks.push({ name: `页面可访问：${p.name}`, pass: hasContent, detail: hasContent ? undefined : '页面内容为空' });
      }

      const severe = [...consoleErrors, ...pageErrors].filter((e) => !/favicon|DevTools/.test(e));
      checks.push({ name: '控制台无严重错误', pass: severe.length === 0, detail: severe.slice(0, 3).join(' | ') });
      const ok = checks.every((c) => c.pass);
      fs.writeFileSync(
        path.join(resultsDir, 'playwright-test.json'),
        JSON.stringify({ at: new Date().toISOString(), ok, checks, consoleErrors: severe }, null, 2),
        'utf8',
      );
      return { ok, checks, consoleErrors: severe };
    } finally {
      await browser.close().catch(() => {});
    }
  } finally {
    server.kill();
    await killPort(DEMO_PORT);
  }
}

// ---------- 主流程 ----------

export async function runDemo(projectId: string): Promise<{ pages: number }> {
  requireLlm();
  setTaskStatus(projectId, 'demo', 'running');
  try {
    const demoDir = path.join(projectDir(projectId), 'demo');
    fs.mkdirSync(demoDir, { recursive: true });

    const spec = await genSpec(projectId);
    const plan = await genPagePlan(projectId, spec);
    writeScaffold(demoDir, plan);
    await genPages(projectId, spec, plan);

    let install = runNpm(demoDir, ['install']);
    if (!install.ok) throw new Error(`npm install 失败：${install.output.slice(-800)}`);
    await buildWithAutoFix(projectId, spec, plan);
    touch(projectId);
    setTaskStatus(projectId, 'demo', 'done');
    return { pages: plan.pages.length };
  } catch (err) {
    setTaskStatus(projectId, 'demo', 'failed');
    throw err;
  }
}

export async function runDemoTestTask(projectId: string): Promise<TestResult> {
  setTaskStatus(projectId, 'demo_test', 'running');
  try {
    const demoDir = path.join(projectDir(projectId), 'demo');
    const planFile = path.join(demoDir, 'page-plan.json');
    if (!fs.existsSync(planFile)) throw new Error('缺少 page-plan.json，请先生成 Demo');
    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8')) as PagePlan;
    let result = await runDemoTest(projectId, plan);
    if (!result.ok) {
      // 自动修复一次：把失败信息给 LLM 修复后重测（PRD §59）
      const demoDirPath = demoDir;
      const fix = await chatCompletion([
        {
          role: 'system',
          content:
            '你是前端修复工程师。React Demo 的 Playwright 测试失败。请输出修复：按文件给完整替换内容，格式：\n<<<FILE: 相对路径>>>\n内容\n<<<END>>>\n只输出要改的文件。\n' +
            '硬性约束：只能修改 src/pages/ 下已存在的页面文件；禁止新建文件、禁止重写 src/App.tsx、src/main.tsx、vite.config.ts，禁止更换路由结构。',
        },
        { role: 'user', content: JSON.stringify(result.checks.filter((c) => !c.pass)).slice(0, 3000) },
      ]);
      applyFileBlocks(demoDirPath, fix);
      const rebuild = runNpm(demoDirPath, ['run', 'build']);
      if (rebuild.ok) result = await runDemoTest(projectId, plan);
    }
    setTaskStatus(projectId, 'demo_test', result.ok ? 'done' : 'failed');
    return result;
  } catch (err) {
    setTaskStatus(projectId, 'demo_test', 'failed');
    throw err;
  }
}
