/**
 * env.ts — 极简 .env 加载器（无第三方依赖）
 * 读取仓库根目录 .env（若存在），不覆盖已存在的进程环境变量。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.resolve(__dirname, '..', '..', '.env');

export function loadEnv(): void {
  try {
    if (!fs.existsSync(ENV_FILE)) return;
    const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
    console.log(`[env] 已加载 ${ENV_FILE}`);
  } catch {
    // .env 读取失败不阻塞启动
  }
}

// 模块加载即生效：任何入口 import './env.js' 后环境变量即可用
loadEnv();

// 用户设置（设置页保存的模型/Prompt 配置）覆盖 .env：显式设置优先，清空回落
import { applySettingsToEnv } from './settings.js';
applySettingsToEnv();
