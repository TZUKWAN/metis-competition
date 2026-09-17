/** netutil.ts — 端口等待与清理 */
import { spawnSync } from 'node:child_process';

export async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      // 明确用 IPv4：vite 可能只绑 ::1 或 127.0.0.1，localhost 解析顺序不确定
      const resp = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
      if (resp.status < 500) return;
    } catch {
      // not ready
    }
    if (Date.now() > deadline) throw new Error(`端口 ${port} 未就绪`);
    await new Promise((r) => setTimeout(r, 800));
  }
}

export async function killPort(port: number): Promise<void> {
  // Node 内解析 netstat 再 taskkill（cmd for /f 管道转义在不同 shell 下不可靠）
  const res = spawnSync('netstat', ['-ano'], { encoding: 'utf8', shell: true, timeout: 30_000 });
  const pids = new Set<string>();
  for (const line of (res.stdout ?? '').split('\n')) {
    if (!line.includes('LISTENING')) continue;
    if (!new RegExp(`[:.]${port}\\s`).test(line)) continue;
    const pid = line.trim().split(/\s+/).pop() ?? '';
    if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid);
  }
  for (const pid of pids) {
    spawnSync('taskkill', ['/F', '/PID', pid], { shell: true, timeout: 30_000 });
  }
  await new Promise((r) => setTimeout(r, 500));
}
