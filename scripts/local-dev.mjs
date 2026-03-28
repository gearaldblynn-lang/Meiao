#!/usr/bin/env node

import net from 'node:net';
import { execFileSync, spawn } from 'node:child_process';

import { formatStartPlan } from './local-dev-utils.mjs';

const checkPortListening = (port) =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (listening) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(listening);
    };

    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });

const waitForPort = async (port, timeoutMs = 20000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkPortListening(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
};

const getPortOwner = (port) => {
  try {
    const output = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    const lines = output.trim().split('\n');
    if (lines.length < 2) return '';
    const parts = lines[1].trim().split(/\s+/);
    return `${parts[0]}(${parts[1]})`;
  } catch {
    return '';
  }
};

const spawnNpmScript = (scriptName) =>
  spawn('npm', ['run', scriptName], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

const waitForChildExit = (child) =>
  new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      resolve({ code, signal });
    });
  });

const main = async () => {
  const devListening = await checkPortListening(3000);
  const apiListening = await checkPortListening(3100);
  const devOwner = devListening ? getPortOwner(3000) : '';
  const apiOwner = apiListening ? getPortOwner(3100) : '';

  console.log(
    formatStartPlan({
      devServer: { listening: devListening, port: 3000, owner: devOwner },
      apiServer: { listening: apiListening, port: 3100, owner: apiOwner },
    })
  );

  if (devListening && devOwner && !devOwner.startsWith('node(')) {
    console.error(`3000 当前被非 Node 进程占用: ${devOwner}。请先释放端口后再重试。`);
    process.exit(1);
  }

  if (apiListening && apiOwner && !apiOwner.startsWith('node(')) {
    console.error(`3100 当前被非 Node 进程占用: ${apiOwner}。请先释放端口后再重试。`);
    process.exit(1);
  }

  const children = [];

  if (!apiListening) {
    const serverProcess = spawnNpmScript('server');
    children.push(serverProcess);
    const serverResult = await Promise.race([
      waitForPort(3100).then((ready) => ({ type: 'ready', ready })),
      waitForChildExit(serverProcess).then((result) => ({ type: 'exit', result })),
    ]);
    if (serverResult.type === 'exit') {
      console.error(
        `后端 3100 启动失败，\`npm run server\` 已提前退出（code: ${serverResult.result.code ?? 'unknown'}）。`
      );
      process.exit(1);
    }
    if (!serverResult.ready) {
      console.error('后端 3100 启动超时，请检查 `npm run server` 日志。');
      process.exit(1);
    }
  }

  if (!devListening) {
    const devProcess = spawnNpmScript('dev');
    children.push(devProcess);
    const devResult = await Promise.race([
      waitForPort(3000).then((ready) => ({ type: 'ready', ready })),
      waitForChildExit(devProcess).then((result) => ({ type: 'exit', result })),
    ]);
    if (devResult.type === 'exit') {
      console.error(
        `前端 3000 启动失败，\`npm run dev\` 已提前退出（code: ${devResult.result.code ?? 'unknown'}）。`
      );
      process.exit(1);
    }
    if (!devResult.ready) {
      console.error('前端 3000 启动超时，请检查 `npm run dev` 日志。');
      process.exit(1);
    }
  }

  console.log('');
  console.log('本地开发环境已启动。');
  console.log('开发页: http://localhost:3000');
  console.log('后端健康检查: http://127.0.0.1:3100/api/health');
  console.log('按 Ctrl+C 可结束当前脚本启动的本地进程。');

  const shutdown = () => {
    children.forEach((child) => {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    });
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (children.length === 0) {
    process.exit(0);
  }
};

main().catch((error) => {
  console.error('本地启动失败:', error.message);
  process.exit(1);
});
