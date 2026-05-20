import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_BUFFER = 1024 * 1024;

const normalizeOutput = (stdout = '', stderr = '') => [stdout, stderr].map((item) => String(item || '').trim()).filter(Boolean).join('\n').trim();

const findFirst = (text, patterns) => {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim().replace(/[，。,.]+$/, '');
  }
  return '';
};

const parseJsonPayload = (text = '') => {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
};

const formatDreaminaCreditText = (payload) => {
  if (!payload || typeof payload !== 'object') return '';
  const pieces = [];
  const totalCredit = Number(payload.total_credit ?? payload.totalCredit ?? payload.credit ?? payload.balance);
  if (Number.isFinite(totalCredit)) pieces.push(`可用额度 ${totalCredit}`);
  const vipLevel = String(payload.vip_level ?? payload.vipLevel ?? payload.level ?? '').trim();
  if (vipLevel) pieces.push(`等级 ${vipLevel}`);
  return pieces.join(' · ');
};

export const resolveDreaminaBinary = (env = process.env) => {
  const configured = String(env.MEIAO_DREAMINA_CLI_PATH || env.DREAMINA_CLI_PATH || env.DREAMINA_BINARY || '').trim();
  if (configured) return configured;
  const homeLocal = path.join(env.HOME || homedir(), '.local', 'bin', 'dreamina');
  if (existsSync(homeLocal)) return homeLocal;
  return 'dreamina';
};

export const resolveDreaminaRuntimeHome = (env = process.env) => {
  const configured = String(env.MEIAO_DREAMINA_HOME || env.DREAMINA_HOME || '').trim();
  if (configured) return configured;
  return path.join(process.cwd(), 'server', 'data', 'dreamina-home');
};

export const prepareDreaminaRuntimeHome = ({
  runtimeHome = resolveDreaminaRuntimeHome(process.env),
  sourceVersionPath = path.join(homedir(), '.dreamina_cli', 'version.json'),
} = {}) => {
  const homeRoot = runtimeHome;
  const cliRoot = path.join(homeRoot, '.dreamina_cli');
  const logsDir = path.join(cliRoot, 'logs');
  const versionFile = path.join(cliRoot, 'version.json');

  mkdirSync(logsDir, { recursive: true });
  if (!existsSync(versionFile) && existsSync(sourceVersionPath)) {
    copyFileSync(sourceVersionPath, versionFile);
  }

  return { homeRoot, cliRoot, logsDir, versionFile };
};

export const buildDreaminaCommandArgs = (action, options = {}) => {
  if (action === 'login-start') return ['login', '--headless'];
  if (action === 'login-check') {
    const deviceCode = String(options.deviceCode || '').trim();
    if (!deviceCode) throw new Error('缺少 device_code，无法完成即梦登录确认。');
    const poll = Math.max(1, Math.min(120, Number.parseInt(String(options.poll || 30), 10) || 30));
    return ['login', 'checklogin', `--device_code=${deviceCode}`, `--poll=${poll}`];
  }
  if (action === 'logout') return ['logout'];
  if (action === 'status') return ['user_credit'];
  throw new Error(`未知的即梦 CLI 动作：${action}`);
};

export const parseDreaminaLoginStartOutput = (stdout = '', stderr = '') => {
  const rawOutput = normalizeOutput(stdout, stderr);
  const verificationUri = findFirst(rawOutput, [
    /verification_uri(?:_complete)?\s*[:：=]\s*(https?:\/\/\S+)/i,
    /(?:visit|open|打开|访问)[^\n]*(https?:\/\/\S+)/i,
    /(https?:\/\/\S+)/i,
  ]);
  const userCode = findFirst(rawOutput, [
    /user_code\s*[:：=]\s*([A-Za-z0-9-]+)/i,
    /用户码\s*[:：=]\s*([A-Za-z0-9-]+)/i,
    /验证码\s*[:：=]\s*([A-Za-z0-9-]+)/i,
  ]);
  const deviceCode = findFirst(rawOutput, [
    /device_code\s*[:：=]\s*([A-Za-z0-9._-]+)/i,
    /设备码\s*[:：=]\s*([A-Za-z0-9._-]+)/i,
  ]);
  return { verificationUri, userCode, deviceCode, rawOutput };
};

export const parseDreaminaStatusOutput = (stdout = '', stderr = '') => {
  const rawOutput = normalizeOutput(stdout, stderr);
  const loginMissing = /(?:not\s+login|not\s+logged|unauthorized|未登录|未检测到.*登录态|登录态.*失效|登录已失效|请.*登录|login\s+first)/i.test(rawOutput);
  const jsonPayload = loginMissing ? null : parseJsonPayload(rawOutput);
  const formattedCreditText = formatDreaminaCreditText(jsonPayload);
  return {
    authenticated: !loginMissing && (!jsonPayload || Object.keys(jsonPayload).length > 0),
    rawOutput,
    creditText: loginMissing ? '' : (formattedCreditText || rawOutput),
    totalCredit: Number.isFinite(Number(jsonPayload?.total_credit)) ? Number(jsonPayload.total_credit) : undefined,
    userId: jsonPayload?.user_id != null ? String(jsonPayload.user_id) : undefined,
    userName: jsonPayload?.user_name != null ? String(jsonPayload.user_name) : undefined,
    vipLevel: jsonPayload?.vip_level != null ? String(jsonPayload.vip_level) : undefined,
  };
};

export const runDreaminaCli = (action, options = {}) => {
  const env = options.env || process.env;
  const binary = resolveDreaminaBinary(env);
  const args = buildDreaminaCommandArgs(action, options);
  const runtimeHome = resolveDreaminaRuntimeHome(env);
  const commandEnv = buildDreaminaCommandEnv(env, { runtimeHome });

  return new Promise((resolve, reject) => {
    execFile(binary, args, {
      env: commandEnv,
      timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      maxBuffer: DEFAULT_MAX_BUFFER,
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        error.binary = binary;
        error.args = args;
        reject(error);
        return;
      }
      resolve({ binary, args, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
};

export const buildDreaminaCommandEnv = (env = process.env, { runtimeHome = resolveDreaminaRuntimeHome(env) } = {}) => {
  const localBin = path.join(env.HOME || homedir(), '.local', 'bin');
  prepareDreaminaRuntimeHome({
    runtimeHome,
    sourceVersionPath: path.join(homedir(), '.dreamina_cli', 'version.json'),
  });

  return {
    ...process.env,
    ...env,
    HOME: env.HOME || homedir(),
    MEIAO_DREAMINA_HOME: runtimeHome,
    DREAMINA_HOME: runtimeHome,
    PATH: [localBin, env.PATH || process.env.PATH || ''].filter(Boolean).join(path.delimiter),
  };
};

const buildCliErrorStatus = (error) => {
  const rawOutput = normalizeOutput(error?.stdout, error?.stderr || error?.message);
  if (error?.code === 'ENOENT') {
    return {
      installed: false,
      authenticated: false,
      cliPath: String(error?.binary || ''),
      rawOutput,
      creditText: '',
      message: '未检测到即梦 CLI，请先在服务器安装 dreamina 命令。',
    };
  }
  const parsed = parseDreaminaStatusOutput(error?.stdout || '', error?.stderr || error?.message || '');
  return {
    installed: true,
    authenticated: false,
    cliPath: String(error?.binary || ''),
    rawOutput,
    creditText: '',
    message: parsed.authenticated ? rawOutput || '即梦 CLI 状态检查失败。' : '即梦账号未登录或登录已失效。',
  };
};

export const getDreaminaStatus = async (env = process.env) => {
  try {
    const result = await runDreaminaCli('status', { env, timeoutMs: 15_000 });
    const parsed = parseDreaminaStatusOutput(result.stdout, result.stderr);
    return {
      installed: true,
      authenticated: parsed.authenticated,
      cliPath: result.binary,
      rawOutput: parsed.rawOutput,
      creditText: parsed.creditText,
      message: parsed.authenticated ? '即梦账号已登录。' : '即梦账号未登录或登录已失效。',
    };
  } catch (error) {
    return buildCliErrorStatus(error);
  }
};

export const startDreaminaLogin = async (env = process.env) => {
  const result = await runDreaminaCli('login-start', { env, timeoutMs: 30_000 });
  return parseDreaminaLoginStartOutput(result.stdout, result.stderr);
};

export const checkDreaminaLogin = async ({ deviceCode, poll = 30, env = process.env } = {}) => {
  const result = await runDreaminaCli('login-check', { deviceCode, poll, env, timeoutMs: (Number(poll) + 10) * 1000 });
  const rawOutput = normalizeOutput(result.stdout, result.stderr);
  return {
    authenticated: !/(pending|authorization_pending|未完成|等待|expired|过期|failed|失败)/i.test(rawOutput),
    rawOutput,
  };
};

export const logoutDreamina = async (env = process.env) => {
  const result = await runDreaminaCli('logout', { env, timeoutMs: 15_000 });
  return { rawOutput: normalizeOutput(result.stdout, result.stderr) };
};
