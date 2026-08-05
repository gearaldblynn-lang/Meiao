#!/usr/bin/env node

import net from 'node:net';
import { execFileSync } from 'node:child_process';

import {
  buildDoctorReport,
  evaluatePortOwnerReuse,
  formatDoctorReport,
} from './local-dev-utils.mjs';

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

const getPortProcessCwd = (port) => {
  try {
    const pid = execFileSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')[0];
    if (!pid) return '';

    const output = execFileSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], {
      encoding: 'utf8',
    });
    const cwdLine = output
      .split('\n')
      .find((line) => line.startsWith('n'));
    return cwdLine ? cwdLine.slice(1) : '';
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
    devServer: {
      listening: devListening,
      port: 3000,
      owner: devListening ? getPortOwner(3000) : '',
      workspaceOk: !devListening || evaluatePortOwnerReuse({
        port: 3000,
        owner: getPortOwner(3000),
        processCwd: getPortProcessCwd(3000),
        expectedCwd: process.cwd(),
      }).ok,
    },
    apiServer: {
      listening: apiListening,
      port: 3100,
      owner: apiListening ? getPortOwner(3100) : '',
      workspaceOk: !apiListening || evaluatePortOwnerReuse({
        port: 3100,
        owner: getPortOwner(3100),
        processCwd: getPortProcessCwd(3100),
        expectedCwd: process.cwd(),
      }).ok,
    },
    proxyHealthy,
  });

  console.log(formatDoctorReport(report));
  process.exit(report.status === 'ok' ? 0 : 1);
};

main().catch((error) => {
  console.error('本地健康检查失败:', error.message);
  process.exit(1);
});
