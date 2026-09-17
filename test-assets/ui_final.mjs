import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const shot = (n) => page.screenshot({ path: `D:/metis竞赛/test-assets/final-${n}.png` });

await page.goto('http://localhost:8787/', { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForTimeout(1500);

// 切到正在生成的 comp_004（新 UI 会恢复上次项目，localStorage 为空 → 选最后一个）
await page.getByText('校园智植互联花园').first().click();
await page.waitForTimeout(2000);
await shot('comp004-chat-running');

// 切到 comp_003 看预览
await page.getByText('AI大学生竞赛辅助平台').first().click();
await page.waitForTimeout(2000);

// 右栏点击 商业计划书 → 预览
const bpCard = page.locator('button', { hasText: '商业计划书' }).first();
await bpCard.click();
await page.waitForTimeout(2500);
await shot('comp003-bp-preview');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// PPT 预览
const pptCard = page.locator('button', { hasText: '路演 PPT' }).first();
await pptCard.click();
await page.waitForTimeout(3000);
await shot('comp003-ppt-preview');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// Demo 预览（iframe）
const demoCard = page.locator('button', { hasText: '产品 Demo' }).first();
await demoCard.click();
await page.waitForTimeout(4000);
await shot('comp003-demo-preview');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// 设置页
await page.getByText('⚙ 设置').click();
await page.waitForTimeout(1500);
await shot('settings');
await page.getByText('Prompts', { exact: true }).click();
await page.waitForTimeout(1000);
await shot('settings-prompts');
await page.keyboard.press('Escape');

await browser.close();
console.log('done');
process.exit(0);
