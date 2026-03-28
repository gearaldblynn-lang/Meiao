#!/usr/bin/env node

import net from 'node:net';
import { fileURLToPath } from 'node:url';

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

const checkJsonEndpoint = async (url) => {
  try {
    const response = await fetch(url);
    if (!response.ok) return false;
    await response.json().catch(() => ({}));
    return true;
  } catch {
    return false;
  }
};

const statusLabel = (ok) => (ok ? '已具备基础条件' : '待人工验证');

export const buildAcceptanceReport = ({ environment }) => {
  const lines = [
    '# 服务端收口与任务队列验收清单',
    '',
    '## 基础环境验收',
    `- ${statusLabel(environment.localDoctorOk)}：运行 \`npm run doctor\` 确认本地开发页与后端状态`,
    `- ${environment.devHealthy ? '已检测到 3000 可访问' : '待确认 3000 可访问'}：默认开发页 \`http://localhost:3000\``,
    `- ${environment.apiHealthy ? '已检测到 3100 健康检查可访问' : '待确认 3100 健康检查可访问'}：后端健康检查 \`http://127.0.0.1:3100/api/health\``,
    '- MySQL 模式下确认 `internal_jobs` 已建表，且任务提交后能写入记录',
    '- 设置页应只显示只读系统状态，不再暴露真实密钥',
    '- 浏览器 Network 面板确认不再出现直连第三方引擎的前端请求',
    '- 浏览器请求头确认不再出现第三方 Bearer Key',
    '',
    '## 通用任务队列验收',
    '- 任意模块提交任务后，观察状态是否按 `queued -> running -> succeeded/failed/cancelled` 流转',
    '- 提交多个任务，确认超过并发上限时会排队，不是前端直接并发跑',
    '- 制造瞬时错误，确认进入重试等待；制造鉴权/参数错误，确认直接失败',
    '- 任务运行中刷新页面，确认状态和结果仍可恢复',
    '- 找回功能必须走内部恢复接口，不是前端直接请求第三方任务状态',
    '- 取消任务后，确认排队任务直接取消，运行中任务停止推进或标记取消',
    '- 重试任务后，确认日志中可见重试痕迹',
    '',
    '## 逐模块业务验收',
    '- 一键主图 / 一键详情：策划、生成、找回、重试、中断、结果回写',
    '- 出海翻译：上传、处理、结果展示、刷新后记录保留',
    '- 产品精修：分析、生成、单任务找回、重试、中断',
    '- 买家秀：策划、图片生成、结果恢复',
    '- 短视频：长视频主流程、Veo、分镜脚本、分镜板、白底图、刷新恢复',
    '- 素材上传：上传成功后由内部接口返回素材地址，同一用户路径保持隔离',
    '',
    '## 管理与排障验收',
    '- 管理员日志页可按功能、人员、结果筛选',
    '- 日志中至少可见：内部任务 ID、外部任务 ID、provider、重试次数、错误摘要',
    '- 员工账号不能看到真实密钥，也不能修改系统级敏感配置',
    '- 环境变量缺失时，服务端必须返回明确报错，不是静默失败',
    '- 本地模式访问任务队列接口时，应明确提示“不支持完整内部任务队列”',
    '',
    '## 建议先跑的命令',
    '- `npm run doctor`',
    '- `npm run lint`',
    '- `npm run build`',
    '- `node --test server/jobRuntime.test.mjs`',
    '- `node --test scripts/local-dev-utils.test.mjs`',
  ];

  return lines.join('\n');
};

const main = async () => {
  const [devHealthy, apiHealthy] = await Promise.all([
    checkPortListening(3000),
    checkJsonEndpoint('http://127.0.0.1:3100/api/health'),
  ]);

  const localDoctorOk = devHealthy && apiHealthy && (await checkJsonEndpoint('http://127.0.0.1:3000/api/health'));
  console.log(
    buildAcceptanceReport({
      environment: {
        localDoctorOk,
        devHealthy,
        apiHealthy,
      },
    })
  );
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error('验收清单生成失败:', error.message);
    process.exit(1);
  });
}
