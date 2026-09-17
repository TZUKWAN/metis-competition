/**
 * capture.ts — 自动截图与录屏（PRD §11–12）
 * Playwright Screenshot：默认 1440×900，核心页面命名截图；视频：完整录屏 + 10-30 秒短片段；
 * 截图/视频全部写回 assets/ 并更新 manifest.json（PRD §13/§14：真实 Demo 截图优先）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { addAssets, projectDir, readManifest, setTaskStatus, touch, type Asset } from '../workspace.js';
import { killPort, waitForPort } from './netutil.js';

const DEMO_PORT = 5199;

interface PagePlan {
  productName: string;
  pages: { path: string; file: string; name: string; purpose: string; core?: boolean }[];
}

function loadPlan(demoDir: string): PagePlan {
  const planFile = path.join(demoDir, 'page-plan.json');
  if (!fs.existsSync(planFile)) throw new Error('缺少 page-plan.json，请先生成并通过测试的 Demo');
  return JSON.parse(fs.readFileSync(planFile, 'utf8')) as PagePlan;
}

/** 截图文件名映射（PRD §11.2） */
function shotName(index: number, page: { name: string; core?: boolean }): string {
  const padded = String(index + 1).padStart(2, '0');
  if (index === 0) return `${padded}-home.png`;
  if (page.core) return `${padded}-core-feature.png`;
  return `${padded}-${page.name.replace(/[^\w\u4e00-\u9fa5-]/g, '')}.png`;
}

export async function runCapture(projectId: string): Promise<{ screenshots: number; videos: number }> {
  setTaskStatus(projectId, 'capture', 'running');
  const server = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'preview'], {
    cwd: path.join(projectDir(projectId), 'demo'),
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  try {
    const dir = projectDir(projectId);
    const demoDir = path.join(dir, 'demo');
    const plan = loadPlan(demoDir);
    await waitForPort(DEMO_PORT, 30_000);

    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    const existing = readManifest(projectId);
    const newAssets: Asset[] = [];
    let seq = existing.length;

    // ---------- 截图 ----------
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const shotDir = path.join(dir, 'assets', 'screenshots');
    fs.mkdirSync(shotDir, { recursive: true });

    let shotCount = 0;
    for (let i = 0; i < plan.pages.length && shotCount < 8; i++) {
      const p = plan.pages[i];
      await page.goto(`http://127.0.0.1:${DEMO_PORT}/#${p.path}`, { waitUntil: 'networkidle', timeout: 25_000 }).catch(() => null);
      await page.waitForTimeout(600);
      // 截图前状态保证（PRD §11.3）：滚动回顶部、无报错弹层
      await page.evaluate("window.scrollTo(0, 0)").catch(() => {});
      const fileName = shotName(shotCount, p);
      await page.screenshot({ path: path.join(shotDir, fileName) });
      seq += 1;
      newAssets.push({
        id: `asset_${String(seq).padStart(3, '0')}`,
        type: 'screenshot',
        path: `screenshots/${fileName}`,
        title: `产品界面：${p.name}`,
        description: p.purpose,
        tags: ['demo', 'product', p.core ? 'core-feature' : 'page'],
        source: 'demo',
        recommended_for: ['business-plan', 'ppt', 'software-copyright'],
      });
      shotCount++;
    }
    await context.close();

    // ---------- 录屏：完整操作录屏 + 短片段 ----------
    const videoDir = path.join(dir, 'assets', 'videos');
    fs.mkdirSync(videoDir, { recursive: true });
    let videoCount = 0;

    const record = async (target: string, maxPages: number, slowMo: number) => {
      const vContext = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
      });
      const vPage = await vContext.newPage();
      const pagesToVisit = plan.pages.slice(0, maxPages);
      for (const p of pagesToVisit) {
        await vPage.goto(`http://127.0.0.1:${DEMO_PORT}/#${p.path}`, { waitUntil: 'networkidle', timeout: 25_000 }).catch(() => null);
        await vPage.waitForTimeout(slowMo);
        await vPage.evaluate("window.scrollTo(0, 400)").catch(() => {});
        await vPage.waitForTimeout(slowMo);
      }
      await vPage.evaluate("window.scrollTo(0, 0)").catch(() => {});
      const video = vPage.video();
      await vContext.close(); // close 后 video 落盘
      if (video) {
        const src = await video.path();
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(videoDir, target));
          fs.rmSync(src, { force: true });
        }
      }
    };

    // 完整录屏（覆盖全部页面）
    await record('demo-full.mp4', plan.pages.length, 1500);
    if (fs.existsSync(path.join(videoDir, 'demo-full.mp4'))) videoCount++;
    seq += 1;
    newAssets.push({
      id: `asset_${String(seq).padStart(3, '0')}`,
      type: 'video',
      path: 'videos/demo-full.mp4',
      title: 'Demo 完整操作录屏',
      description: '覆盖全部页面的演示录屏',
      tags: ['demo', 'video', 'full'],
      source: 'demo',
      recommended_for: ['ppt'],
    });

    // 10-30 秒核心片段（核心页 + 首页）
    const corePages = plan.pages.filter((p) => p.core);
    const shortPlan: PagePlan = { ...plan, pages: [plan.pages[0], ...corePages] };
    const vContext2 = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
    });
    const vPage2 = await vContext2.newPage();
    for (const p of shortPlan.pages) {
      await vPage2.goto(`http://127.0.0.1:${DEMO_PORT}/#${p.path}`, { waitUntil: 'networkidle', timeout: 25_000 }).catch(() => null);
      await vPage2.waitForTimeout(2500);
    }
    const video2 = vPage2.video();
    await vContext2.close();
    if (video2) {
      const src = await video2.path();
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(videoDir, 'demo-short.mp4'));
        fs.rmSync(src, { force: true });
        videoCount++;
      }
    }
    if (fs.existsSync(path.join(videoDir, 'demo-short.mp4'))) {
      seq += 1;
      newAssets.push({
        id: `asset_${String(seq).padStart(3, '0')}`,
        type: 'video',
        path: 'videos/demo-short.mp4',
        title: 'Demo 核心演示片段',
        description: '首页 + 核心功能页的短演示',
        tags: ['demo', 'video', 'short'],
        source: 'demo',
        recommended_for: ['ppt'],
      });
    }

    await browser.close();

    // ---------- 视频封面/尾帧（PRD §12） ----------
    let coverMade = false;
    if (fs.existsSync(path.join(videoDir, 'demo-short.mp4'))) {
      try {
        const { ffmpegFrames } = await import('./ffmpeg.js');
        await ffmpegFrames(path.join(videoDir, 'demo-short.mp4'), path.join(videoDir, 'demo-video-cover.png'), '00:00:01');
        await ffmpegFrames(path.join(videoDir, 'demo-short.mp4'), path.join(videoDir, 'demo-video-end.png'), null);
        coverMade = fs.existsSync(path.join(videoDir, 'demo-video-cover.png'));
      } catch {
        // ffmpeg 不可用时封面缺失不阻塞（封面的替代来源是截图资产）
      }
    }
    if (coverMade) {
      seq += 1;
      newAssets.push({
        id: `asset_${String(seq).padStart(3, '0')}`,
        type: 'screenshot',
        path: 'videos/demo-video-cover.png',
        title: '演示视频封面',
        description: '短演示片段首帧',
        tags: ['demo', 'video', 'cover'],
        source: 'demo',
        recommended_for: ['business-plan', 'ppt'],
        derived_from: newAssets.find((a) => a.path === 'videos/demo-short.mp4')?.id,
      });
    }

    addAssets(projectId, newAssets);
    touch(projectId);
    setTaskStatus(projectId, 'capture', 'done');
    return { screenshots: shotCount, videos: videoCount };
  } catch (err) {
    setTaskStatus(projectId, 'capture', 'failed');
    throw err;
  } finally {
    server.kill();
    await killPort(DEMO_PORT);
  }
}
