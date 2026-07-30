const normalizeDirectory = (value) => String(value || '').replace(/\/+$/u, '');

export const buildDoctorReport = ({
  devServer,
  apiServer,
  proxyHealthy,
  expectedWorkingDirectory = '',
}) => {
  const devReady = Boolean(devServer?.listening);
  const apiReady = Boolean(apiServer?.listening);
  const proxyReady = Boolean(proxyHealthy);
  const expectedDirectory = normalizeDirectory(expectedWorkingDirectory);
  const runtimeDirectories = [
    devReady ? normalizeDirectory(devServer?.workingDirectory) : '',
    apiReady ? normalizeDirectory(apiServer?.workingDirectory) : '',
  ].filter(Boolean);
  const staleRuntimeDirectories = expectedDirectory
    ? runtimeDirectories.filter((directory) => directory !== expectedDirectory)
    : [];
  const runtimeIdentityReady = staleRuntimeDirectories.length === 0;

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
  } else if (!runtimeIdentityReady) {
    status = 'warning';
    summary = '3000/3100 虽然健康，但运行的是另一个工作区，页面可能显示旧功能。请先切换常驻进程的工作目录。';
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
      runtimeIdentity: {
        ok: runtimeIdentityReady,
        label: runtimeIdentityReady
          ? '3000/3100 运行目录与当前项目一致'
          : `当前项目 ${expectedDirectory}；实际进程 ${[...new Set(staleRuntimeDirectories)].join(', ')}`,
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
    ...(report.checks.runtimeIdentity
      ? [`- ${report.checks.runtimeIdentity.ok ? '已就绪' : '未就绪'}: ${report.checks.runtimeIdentity.label}`]
      : []),
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

// 复用 3100 前的体检判据(S1):HTTP 活着不等于后端健康——Temporal worker poller
// 可能已静默死亡,此时任务会永远排队。healthJson 来自 GET /api/health。
export const evaluateBackendReuse = (healthJson) => {
  if (!healthJson || typeof healthJson !== 'object') {
    return {
      ok: false,
      reason: '3100 的 /api/health 没有返回合法 JSON，后端状态未知，不能安全复用。请先 kill 掉占用 3100 的进程再重跑。',
    };
  }

  const worker = healthJson.worker;
  if (worker && worker.healthy === false) {
    const detail = worker.error
      ? `worker 探测报错: ${worker.error}`
      : `task queue 上没有任何存活 poller（workflow: ${worker.workflowPollers ?? 0}, activity: ${worker.activityPollers ?? 0}）`;
    return {
      ok: false,
      reason: [
        '3100 后端进程还活着，但 Temporal worker 已经死了——新任务会永远排队、一直显示"处理中"。',
        `- ${detail}`,
        '- 不能复用这个后端，请先重启它:',
        '  手动进程: kill $(lsof -ti tcp:3100) 之后重新运行本命令',
        '  launchd 常驻: launchctl kickstart -k gui/$(id -u)/<服务名>（用 launchctl list | grep -i meiao 查服务名）',
      ].join('\n'),
    };
  }

  return { ok: true };
};
