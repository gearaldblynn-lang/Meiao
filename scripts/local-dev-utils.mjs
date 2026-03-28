export const buildDoctorReport = ({ devServer, apiServer, proxyHealthy }) => {
  const devReady = Boolean(devServer?.listening);
  const apiReady = Boolean(apiServer?.listening);
  const proxyReady = Boolean(proxyHealthy);

  let status = 'ok';
  let summary = '本地开发环境已就绪，可直接打开 http://localhost:3000。';

  if (!devReady && apiReady) {
    status = 'warning';
    summary = '后端 3100 已启动，但前端 3000 的 Vite 开发页还没启动。请先启动本地开发页。';
  } else if (devReady && !apiReady) {
    status = 'warning';
    summary = '前端 3000 已启动，但后端 3100 没有监听，接口请求会失败。';
  } else if (!devReady && !apiReady) {
    status = 'warning';
    summary = '3000 和 3100 目前都没有启动，本地测试页暂时不可用。';
  } else if (!proxyReady) {
    status = 'warning';
    summary = '3000 和 3100 都已启动，但 3000/api/health 没有成功代理到后端。';
  }

  return {
    status,
    summary,
    checks: {
      devServer: {
        ok: devReady,
        label: `开发页 3000${devServer?.owner ? ` (${devServer.owner})` : ''}`,
      },
      apiServer: {
        ok: apiReady,
        label: `后端 3100${apiServer?.owner ? ` (${apiServer.owner})` : ''}`,
      },
      proxy: {
        ok: proxyReady,
        label: '3000/api/health 代理检查',
      },
    },
  };
};

export const formatDoctorReport = (report) => {
  const icon = report.status === 'ok' ? 'OK' : 'WARN';
  const lines = [
    `[${icon}] ${report.summary}`,
    `- ${report.checks.devServer.ok ? '已就绪' : '未就绪'}: ${report.checks.devServer.label}`,
    `- ${report.checks.apiServer.ok ? '已就绪' : '未就绪'}: ${report.checks.apiServer.label}`,
    `- ${report.checks.proxy.ok ? '已就绪' : '未就绪'}: ${report.checks.proxy.label}`,
    '',
    '默认开发入口: http://localhost:3000',
    '后端健康检查: http://127.0.0.1:3100/api/health',
  ];

  return lines.join('\n');
};

export const formatStartPlan = ({ devServer, apiServer }) => {
  const lines = ['准备启动本地开发环境:'];

  if (devServer?.listening) {
    lines.push(`- 3000 已被占用，当前监听者: ${devServer.owner || '未知进程'}。如不是当前项目，请先释放端口。`);
  } else {
    lines.push('- 3000 空闲，将启动 Vite 开发页。');
  }

  if (apiServer?.listening) {
    lines.push(`- 3100 已在运行，当前监听者: ${apiServer.owner || '未知进程'}。将复用现有后端。`);
  } else {
    lines.push('- 3100 空闲，将启动本地后端。');
  }

  lines.push('完成后请打开: http://localhost:3000');
  return lines.join('\n');
};
