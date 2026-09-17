/** ppt-selftest.ts — 无 LLM 验证 PPT 机械链路：
 *  生成测试模板 → 读取结构 → 克隆页 → 替换文本 → 替换图片 → 删原页 → 保存 → COM 渲染 PNG/PDF → 校验产物 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PptxFile } from './skills/ppt/pptx-io.js';

const work = path.join(os.tmpdir(), 'ppt-selftest');
fs.mkdirSync(work, { recursive: true });
const ps = (script: string, ...args: string[]) =>
  spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts', script), ...args], { encoding: 'utf8', timeout: 300_000 });

// 1. 生成测试模板
const tpl = path.join(work, 'template.pptx');
let r = ps('gen_template.ps1', tpl);
assert.ok(r.status === 0 && fs.existsSync(tpl), '模板生成失败: ' + r.stderr);
console.log('PASS 1: 测试模板生成');

// 2. 读取结构
const pptx = await PptxFile.load(tpl);
const slides = await pptx.listSlides();
assert.strictEqual(slides.length, 6, '模板页数应为 6');
assert.ok(slides[0].texts.length >= 2, '封面应有文本框');
console.log('PASS 2: 结构读取，封面文本框:', slides[0].texts.map((t) => t.text).join(' | '));

// 3. 克隆第 4 页（图文页）两次，克隆第 6 页一次
const p4a = await pptx.cloneSlide(slides[3].part);
const p4b = await pptx.cloneSlide(slides[3].part);
const p6 = await pptx.cloneSlide(slides[5].part);

// 4. 替换文字
const info4 = await pptx.describeSlide(p4a, 7);
const titleBox = info4.texts.find((t) => t.isTitle) ?? info4.texts[0];
await pptx.replaceText(p4a, titleBox.shapeId, 'AI 竞赛助手功能实测');
const bodyBox = info4.texts.find((t) => t.shapeId !== titleBox.shapeId);
if (bodyBox) await pptx.replaceText(p4a, bodyBox.shapeId, '第一点说明\n第二点说明');

// 5. 替换图片（生成一张纯色 PNG 作为假截图）
const { chromium } = await import('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
await page.setContent('<body style="margin:0;background:#2563eb;display:flex;align-items:center;justify-content:center;color:#fff;font:32px sans-serif">Demo 截图占位</body>');
const shotPath = path.join(work, 'fake-shot.png');
await page.screenshot({ path: shotPath });
await browser.close();

const pics = await pptx.listPictures(p4a);
assert.ok(pics.length > 0, '图文页应有图片 shape');
await pptx.replaceImage(p4a, pics[0].relEmbedId, fs.readFileSync(shotPath), 'png');
console.log('PASS 3: 克隆 + 文本替换 + 图片替换');

// 6. 图表替换
const chartSlide = slides[4];
const p5 = await pptx.cloneSlide(chartSlide.part);
await pptx.replaceChartWithImage(p5, fs.readFileSync(shotPath));
console.log('PASS 4: 图表替换为图片');

// 7. 只保留克隆页
await pptx.keepSlidesOnly(new Set([p4a, p4b, p6, p5]));
const out = path.join(work, 'final.pptx');
await pptx.save(out);

// 8. COM 渲染
const pngDir = path.join(work, 'rendered');
r = ps('render_ppt.ps1', out, pngDir, path.join(work, 'final.pdf'));
assert.ok(r.status === 0 && (r.stdout ?? '').includes('OK'), '渲染失败: ' + r.stdout + r.stderr);
const pngs = fs.readdirSync(pngDir).filter((f) => f.endsWith('.png'));
assert.strictEqual(pngs.length, 4, '应渲染 4 页');
assert.ok(fs.existsSync(path.join(work, 'final.pdf')), 'PDF 未生成');
console.log('PASS 5: COM 渲染', pngs.length, '页 + PDF', fs.statSync(path.join(work, 'final.pdf')).size, 'bytes');

// 9. 校验替换后的文本出现在渲染图里（用文本提取确认）
const finalPptx = await PptxFile.load(out);
const finalSlides = await finalPptx.listSlides();
assert.ok(finalSlides.some((s) => s.texts.some((t) => t.text.includes('AI 竞赛助手功能实测'))), '替换文本未生效');
const firstSlide = finalSlides[0];
assert.ok(!firstSlide.texts.some((t) => t.text === '产品功能展示'), '第一页（已替换页）模板原文本残留');
assert.ok(firstSlide.texts.some((t) => t.text.includes('第一点说明')), '第一页正文替换未生效');
console.log('PASS 6: 替换生效且原文本已清除');

console.log('PPTX-IO SELFTEST PASSED, workdir:', work);
process.exit(0);
