import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const demo = 'D:/metis竞赛/workspace/competition/comp_003/demo';
const server = spawn('npm.cmd', ['run', 'preview'], { cwd: demo, stdio: 'ignore', shell: true });
await new Promise(r => setTimeout(r, 8000));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const routes = [['/', 'landing'], ['/home', 'home'], ['/rules', 'rules'], ['/project', 'project'], ['/document', 'document'], ['/analysis', 'analysis'], ['/dashboard', 'dashboard'], ['/ai-records', 'airecords']];
for (const [path, name] of routes) {
  await page.goto(`http://127.0.0.1:5199/#${path}`, { waitUntil: 'networkidle', timeout: 25000 }).catch(() => null);
  await page.waitForTimeout(700);
  const h = await page.evaluate(() => document.getElementById('root')?.innerText.length ?? 0);
  const sh = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.screenshot({ path: `D:/metis竞赛/test-assets/audit-${name}.png`, fullPage: true });
  console.log(`${name}: textLen=${h} scrollHeight=${sh}`);
}
await browser.close();
server.kill();
process.exit(0);
