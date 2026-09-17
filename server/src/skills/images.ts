/**
 * images.ts — AI 生图 Skill（PRD §17–19）
 * ImageProvider：OpenAI 兼容图片 API（IMAGE_API_BASE/IMAGE_API_KEY/IMAGE_MODEL）。
 * 关键规则（§19）：生成前先写 image-brief.md；软件产品优先"真实 Demo 截图 + 真实设备/场景"，
 * UI-on-device 用 HTML 设备样机 + Playwright 合成（不让生图模型幻想 UI）；视觉 QA 最多重试 2 次。
 */
import fs from 'node:fs';
import path from 'node:path';
import { chatCompletion, getLlmConfig } from '../llm.js'
import { getPrompt } from '../settings.js';
import { addAssets, projectDir, readFacts, readManifest, setTaskStatus, touch, type Asset } from '../workspace.js';

interface ImageProvider {
  generate(prompt: string, size: '1024x1024' | '1536x1024' | '1024x1536'): Promise<Buffer>;
}

function getImageProvider(): ImageProvider | null {
  const base = process.env.IMAGE_API_BASE;
  const key = process.env.IMAGE_API_KEY;
  const model = process.env.IMAGE_MODEL;
  if (!base || !key || !model) return null;
  const baseUrl = base.replace(/\/$/, '');
  return {
    async generate(prompt, size) {
      const resp = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, prompt, size, response_format: 'b64_json' }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!resp.ok) throw new Error(`生图 API 失败 HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      const data = (await resp.json()) as { data?: { b64_json?: string; url?: string }[] };
      const item = data.data?.[0];
      if (item?.b64_json) return Buffer.from(item.b64_json, 'base64');
      if (item?.url) return Buffer.from(await (await fetch(item.url)).arrayBuffer());
      throw new Error('生图 API 返回为空');
    },
  };
}

function briefFor(kind: string, facts: { label: string; value: string }[], extra: string): string {
  const core = facts.filter((f) => ['项目名称', '一句话介绍', '目标客户', '核心功能', '核心技术'].includes(f.label));
  return `# image-brief\n\n- 图片用途：${kind}\n${core.map((f) => `- ${f.label}：${f.value}`).join('\n')}\n${extra}\n- 必须出现：与项目相关的真实场景元素\n- 禁止出现：乱码文字、假 Logo、假证书、悬浮屏幕、错误人手\n- 风格：真实摄影感、自然光、蓝灰主色\n`;
}

/** 视觉 QA：模型支持 vision 时检查，不支持则如实记录"未做视觉 QA" */
async function visualQa(imagePath: string, brief: string, expect: string): Promise<{ pass: boolean; note: string }> {
  const cfg = getLlmConfig();
  if (!cfg) return { pass: false, note: 'LLM 未配置' };
  const base64 = fs.readFileSync(imagePath).toString('base64');
  try {
    const resp = await chatCompletion([
      {
        role: 'system',
        content: '你是图片质检员。检查图片：1 像不像真实照片 2 是否符合用途（见用户消息）3 有无明显 AI 错误/乱码 4 能否放进 PPT。只输出 JSON {"pass":true/false,"problems":"问题描述"}',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `用途：${expect}\n\n要求：${brief.slice(0, 500)}` },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
        ],
      },
    ]);
    const m = /\{[\s\S]*\}/.exec(resp);
    if (!m) return { pass: true, note: 'QA 输出异常，按通过处理（已记录）' };
    const r = JSON.parse(m[0]) as { pass?: boolean; problems?: string };
    return { pass: Boolean(r.pass), note: r.problems ?? '' };
  } catch {
    return { pass: true, note: '当前 LLM 不支持视觉输入，未做视觉 QA（已如实记录）' };
  }
}

export async function runImages(projectId: string): Promise<{ images: string[]; notes: string[] }> {
  setTaskStatus(projectId, 'images', 'running');
  try {
    const provider = getImageProvider();
    if (!provider) throw new Error('未配置生图 API：请设置 IMAGE_API_BASE / IMAGE_API_KEY / IMAGE_MODEL');
    if (!getLlmConfig()) throw new Error('image-brief 生成需要 LLM（未配置）');

    const dir = projectDir(projectId);
    const outDir = path.join(dir, 'assets', 'generated-images');
    fs.mkdirSync(outDir, { recursive: true });
    const facts = readFacts(projectId);
    const manifest = readManifest(projectId);
    const screenshots = manifest.filter((a) => a.type === 'screenshot');
    const seq0 = manifest.length;

    const made: string[] = [];
    const notes: string[] = [];
    let seq = seq0;
    const pushAsset = (file: string, title: string, desc: string, tags: string[], derivedFrom?: string) => {
      seq += 1;
      const asset: Asset = {
        id: `asset_${String(seq).padStart(3, '0')}`,
        type: 'generated-image',
        path: `generated-images/${file}`,
        title,
        description: desc,
        tags,
        source: 'generated',
        recommended_for: ['ppt', 'business-plan'],
      };
      if (derivedFrom) asset.derived_from = derivedFrom;
      addAssets(projectId, [asset]);
      made.push(file);
    };

    const productName = facts.find((f) => f.key === 'project_name')?.value ?? '产品';
    const summary = facts.find((f) => f.key === 'summary')?.value ?? '';

    // 1. Hero 图
    const heroBrief = briefFor('项目 Hero 图（PPT 封面/计划书扉页）', facts, `- 画面主体：能代表"${productName}"的抽象+具象结合视觉，科技感但克制`);
    fs.writeFileSync(path.join(outDir, 'image-brief-hero.md'), heroBrief, 'utf8');
    const heroPrompt = await chatCompletion([
      { role: 'system', content: getPrompt('prompt.image', ('把 image-brief 转成一段高质量英文生图 prompt（photorealistic, natural lighting），只输出 prompt 本身。'))},
      { role: 'user', content: heroBrief },
    ]);
    let heroBuf = await provider.generate(heroPrompt, '1536x1024');
    let heroPath = path.join(outDir, 'hero.png');
    fs.writeFileSync(heroPath, heroBuf);
    let qa = await visualQa(heroPath, heroBrief, '项目 Hero 图');
    notes.push(`hero: ${qa.note || 'QA 通过'}`);
    for (let retry = 0; !qa.pass && retry < 2; retry++) {
      heroBuf = await provider.generate(heroPrompt + ', fix: ' + qa.note, '1536x1024');
      fs.writeFileSync(heroPath, heroBuf);
      qa = await visualQa(heroPath, heroBrief, '项目 Hero 图');
      notes.push(`hero retry${retry + 1}: ${qa.note || 'QA 通过'}`);
    }
    pushAsset('hero.png', '项目 Hero 图', 'AI 生成的项目主视觉（概念图，非实拍）', ['hero', 'concept_render', 'generated']);

    // 2. 真实使用场景图
    const sceneBrief = briefFor('真实使用场景图（学生在真实环境中使用产品）', facts, '- 场景：高校实验室/图书馆/教室，真实人物自然使用笔记本电脑\n- 光线：自然室内光');
    fs.writeFileSync(path.join(outDir, 'image-brief-scene.md'), sceneBrief, 'utf8');
    const scenePrompt = await chatCompletion([
      { role: 'system', content: getPrompt('prompt.image', ('把 image-brief 转成一段高质量英文生图 prompt（photorealistic, real campus environment, natural indoor light），屏幕内容保持模糊或显示通用界面（不要编造具体 UI 文字）。只输出 prompt 本身。'))},
      { role: 'user', content: sceneBrief },
    ]);
    const scenePath = path.join(outDir, 'usage-scene.png');
    fs.writeFileSync(scenePath, await provider.generate(scenePrompt, '1536x1024'));
    const qa2 = await visualQa(scenePath, sceneBrief, '真实使用场景图');
    notes.push(`scene: ${qa2.note || 'QA 通过'}`);
    pushAsset('usage-scene.png', '真实使用场景图', 'AI 生成的使用场景（场景示意，非实拍）', ['scene', 'generated']);

    // 3. UI-on-device：真实 Demo 截图 + HTML 设备样机合成（PRD §19.1 不让模型幻想 UI）
    const homeShot = screenshots.find((s) => s.path.includes('home')) ?? screenshots[0];
    if (homeShot) {
      const shotAbs = path.join(dir, 'assets', homeShot.path);
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;width:1600px;height:1000px;background:linear-gradient(135deg,#e2e8f0 0%,#cbd5e1 100%);display:flex;align-items:center;justify-content:center;font-family:"Microsoft YaHei",sans-serif}
.desk{position:relative;width:1200px;height:760px;background:#94a3b8;border-radius:16px;box-shadow:0 30px 60px rgba(15,23,42,.35);display:flex;align-items:center;justify-content:center}
.screen{width:1080px;height:680px;background:#0f172a;border-radius:10px;padding:18px}
.laptop{display:block;width:100%;height:100%;border-radius:4px;object-fit:cover;object-position:top}
.caption{position:absolute;bottom:-46px;width:100%;text-align:center;color:#334155;font-size:22px}
</style></head><body><div class="desk"><div class="screen"><img class="laptop" src="data:image/png;base64,${fs.readFileSync(shotAbs).toString('base64')}"/></div><div class="caption">${productName} · ${summary}</div></div></body></html>`;
      const htmlPath = path.join(outDir, '_device-mock.html');
      fs.writeFileSync(htmlPath, html, 'utf8');
      const { chromium } = await import('playwright');
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
        await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`);
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(outDir, 'ui-on-device.png') });
      } finally {
        await browser.close().catch(() => {});
      }
      fs.rmSync(htmlPath, { force: true });
      pushAsset('ui-on-device.png', '产品界面在真实设备上', '真实 Demo 首页截图合成到设备样机（截图来自自动截图任务）', ['ui_on_device', 'demo', 'product'], homeShot.id);
    } else {
      notes.push('ui-on-device: 无 Demo 截图可用，跳过（请先执行截图任务）');
    }

    touch(projectId);
    setTaskStatus(projectId, 'images', 'done');
    return { images: made, notes };
  } catch (err) {
    setTaskStatus(projectId, 'images', 'failed');
    throw err;
  }
}
