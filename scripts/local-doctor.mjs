#!/usr/bin/env node

import net from 'node:net';
import { execFileSync } from 'node:child_process';

import { buildDoctorReport, formatDoctorReport } from './local-dev-utils.mjs';

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

const checkProxyHealth = async () => {
  try {
    const response = await fetch('http://127.0.0.1:3000/api/health');
    return response.ok;
  } catch {
    return false;
  }
};

const main = async () => {
  const [devListening, apiListening, proxyHealthy] = await Promise.all([
    checkPortListening(3000),
    checkPortListening(3100),
    checkProxyHealth(),
  ]);

  const report = buildDoctorReport({
    devServer: { listening: devListening, port: 3000, owner: devListening ? getPortOwner(3000) : '' },
    apiServer: { listening: apiListening, port: 3100, owner: apiListening ? getPortOwner(3100) : '' },
    proxyHealthy,
  });

  console.log(formatDoctorReport(report));
  process.exit(report.status === 'ok' ? 0 : 1);
};

main().catch((error) => {
  console.error('本地健康检查失败:', error.message);
  process.exit(1);
});
