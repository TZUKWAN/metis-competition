/**
 * video.ts — 视频生成（PRD §20）
 * VideoProvider：优先 image-to-video（VIDEO_API_BASE/VIDEO_API_KEY/VIDEO_MODEL）。
 * 流程：选资产库图片作首帧 → 生成动作描述 → 调用视频模型 → MP4 → 抽尾帧 → 全部进资产库。
 * 各家视频 API 差异大：默认适配 OpenAI 兼容风格（images/generations 类似端点 /video/generations 返回 b64/url），
 * 未配置时如实 needs_input，不伪造视频。
 */
import fs from 'node:fs';
import path from 'node:path';
import { chatCompletion, getLlmConfig } from '../llm.js'
import { getPrompt } from '../settings.js';
import { addAssets, projectDir, readFacts, readManifest, setTaskStatus, touch, type Asset } from '../workspace.js';
import { ffmpegFrames, hasFfmpeg } from './ffmpeg.js';

interface VideoProvider {
  imageToVideo(imagePath: string, prompt: string): Promise<Buffer>;
}

function getVideoProvider(): VideoProvider | null {
  const base = process.env.VIDEO_API_BASE;
  const key = process.env.VIDEO_API_KEY;
  const model = process.env.VIDEO_MODEL;
  if (!base || !key || !model) return null;
  const baseUrl = base.replace(/\/$/, '');
  return {
    async imageToVideo(imagePath, prompt) {
      const base64 = fs.readFileSync(imagePath).toString('base64');
      const resp = await fetch(`${baseUrl}/video/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, prompt, image: `data:image/png;base64,${base64}`, duration: 8, size: '1280x720' }),
        signal: AbortSignal.timeout(600_000),
      });
      if (!resp.ok) throw new Error(`视频 API 失败 HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      const data = (await resp.json()) as { data?: { b64_json?: string; url?: string }[]; video?: string };
      const url = data.data?.[0]?.url ?? data.video;
      if (data.data?.[0]?.b64_json) return Buffer.from(data.data[0].b64_json, 'base64');
      if (url?.startsWith('http')) return Buffer.from(await (await fetch(url)).arrayBuffer());
      if (url?.startsWith('data:')) return Buffer.from(url.split(',')[1], 'base64');
      throw new Error('视频 API 返回格式不支持（需要 b64_json/url）');
    },
  };
}

export async function runVideo(projectId: string): Promise<{ videos: string[] }> {
  setTaskStatus(projectId, 'video', 'running');
  try {
    const provider = getVideoProvider();
    if (!provider) throw new Error('未配置视频 API：请设置 VIDEO_API_BASE / VIDEO_API_KEY / VIDEO_MODEL');
    if (!getLlmConfig()) throw new Error('视频动作描述需要 LLM（未配置）');

    const dir = projectDir(projectId);
    const videoDir = path.join(dir, 'assets', 'videos');
    fs.mkdirSync(videoDir, { recursive: true });
    const facts = readFacts(projectId);
    const manifest = readManifest(projectId);
    const productName = facts.find((f) => f.key === 'project_name')?.value ?? '产品';

    // 首帧：优先 Hero 图，其次首页截图
    const firstFrame =
      manifest.find((a) => a.tags.includes('hero')) ?? manifest.find((a) => a.path.includes('home') && a.type === 'screenshot');
    if (!firstFrame) throw new Error('资产库中没有可用作首帧的图片（先执行生图/截图任务）');

    const motion = await chatCompletion([
      {
        role: 'system',
        content: getPrompt('prompt.video', ('为 image-to-video 生成 8 秒动作描述（镜头缓慢推近、自然光变化、元素轻微运动，写实风格），50-80字，只输出描述。'))},
      { role: 'user', content: `产品：${productName}；首帧素材：${firstFrame.title}（${firstFrame.description}）` },
    ]);

    const mp4Path = path.join(videoDir, 'ai-demo-scene.mp4');
    fs.writeFileSync(mp4Path, await provider.imageToVideo(path.join(dir, 'assets', firstFrame.path), motion));

    const seq = manifest.length;
    const newAssets: Asset[] = [
      {
        id: `asset_${String(seq + 1).padStart(3, '0')}`,
        type: 'video',
        path: 'videos/ai-demo-scene.mp4',
        title: 'AI 生成项目场景短视频',
        description: `基于资产 ${firstFrame.id} 首帧生成：${motion}`,
        tags: ['video', 'ai-generated', 'short'],
        source: 'generated',
        recommended_for: ['ppt'],
        derived_from: firstFrame.id,
      },
    ];

    // 尾帧
    if (hasFfmpeg()) {
      try {
        await ffmpegFrames(mp4Path, path.join(videoDir, 'ai-demo-scene-end.png'), null);
        newAssets.push({
          id: `asset_${String(seq + 2).padStart(3, '0')}`,
          type: 'screenshot',
          path: 'videos/ai-demo-scene-end.png',
          title: 'AI 视频尾帧',
          description: 'ai-demo-scene.mp4 尾帧',
          tags: ['video', 'end-frame'],
          source: 'generated',
          recommended_for: ['ppt'],
          derived_from: newAssets[0].id,
        });
      } catch {
        // 尾帧缺失不阻塞
      }
    }

    addAssets(projectId, newAssets);
    touch(projectId);
    setTaskStatus(projectId, 'video', 'done');
    return { videos: ['assets/videos/ai-demo-scene.mp4'] };
  } catch (err) {
    setTaskStatus(projectId, 'video', 'failed');
    throw err;
  }
}
