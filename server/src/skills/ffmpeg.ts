/**
 * ffmpeg.ts — ffmpeg 极简封装：视频抽帧
 * 依赖系统 PATH 中的 ffmpeg；不可用时由调用方降级处理。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

export function hasFfmpeg(): boolean {
  const res = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', timeout: 10_000 });
  return res.status === 0;
}

/** 抽帧：timestamp 为 ffmpeg 时间格式（如 00:00:01）；为 null 时取最后一帧 */
export async function ffmpegFrames(videoPath: string, outPath: string, timestamp: string | null): Promise<void> {
  if (!fs.existsSync(videoPath)) throw new Error(`视频不存在: ${videoPath}`);
  const args = timestamp
    ? ['-y', '-ss', timestamp, '-i', videoPath, '-frames:v', '1', outPath]
    : ['-y', '-sseof', '-0.1', '-i', videoPath, '-frames:v', '1', outPath];
  const res = spawnSync('ffmpeg', args, { encoding: 'utf8', timeout: 60_000 });
  if (res.status !== 0 || !fs.existsSync(outPath)) {
    throw new Error(`ffmpeg 抽帧失败: ${(res.stderr ?? '').slice(-300)}`);
  }
}
