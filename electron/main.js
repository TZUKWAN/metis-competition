/**
 * electron/main.js — METIS Competition 桌面壳
 * 以子进程拉起 Express server（随机空闲端口），就绪后开 BrowserWindow 加载；
 * 窗口关闭时回收子进程。数据/工作区仍为仓库内 workspace/，与 Web 模式完全一致。
 */
const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');

// 每次启动选一个空闲端口，避免与本机可能已运行的 Web 模式(8787)冲突
async function pickPort() {
  const net = require('node:net');
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function waitForServer(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const probe = () => {
      const req = http.get(`http://127.0.0.1:${port}/api/projects`, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) return resolve();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(2000, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() > deadline) return reject(new Error('server 启动超时'));
      setTimeout(probe, 600);
    };
    probe();
  });
}

async function main() {
  const port = await pickPort();
  // 直接用系统 node 跑 tsx CLI（.exe，无需 shell / npx 链），避免 cmd 中间层导致的各种坑
  const server = spawn('node', [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/index.ts'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(port), ELECTRON_RUN_AS_NODE: undefined },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  server.on('error', (err) => {
    fs.appendFileSync(path.join(ROOT, 'electron-server.log'), `[spawn error] ${err.stack}\n`);
  });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));
  fs.rmSync(path.join(ROOT, 'electron-server.log'), { force: true });
  const tail = () => serverLog.slice(-2000);
  server.on('exit', (code) => {
    fs.appendFileSync(path.join(ROOT, 'electron-server.log'), `[server exit] code ${code}\n${tail()}\n`);
    if (!app.isQuitting) {
      const { dialog } = require('electron');
      dialog.showErrorBox('服务进程退出', `server 进程退出（code ${code}）：\n${tail()}`);
      app.quit();
    }
  });

  try {
    await waitForServer(port, 60_000);
  } catch (err) {
    const { dialog } = require('electron');
    dialog.showErrorBox('启动失败', `${err.message}\n\nserver 日志：\n${tail()}`);
    app.quit();
    return;
  }

  const win = new BrowserWindow({
    width: 1600,
    height: 950,
    title: 'METIS Competition',
    backgroundColor: '#f8fafc',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true },
  });
  // 外部链接用系统浏览器打开，不在应用内跳走
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  win.loadURL(`http://127.0.0.1:${port}/`);
  win.on('closed', () => {
    app.isQuitting = true;
    server.kill();
  });
}

app.whenReady().then(main);
app.on('window-all-closed', () => app.quit());
