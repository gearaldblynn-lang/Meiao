import { execFile } from 'node:child_process';

const clean = (value, max = 5000) => String(value ?? '').trim().slice(0, max);
const list = (value) => (Array.isArray(value) ? value : []);

const ALLOWED_EXECUTORS = new Set(['feishu.create_sheet']);
const EXECUTOR_ENV_KEYS = {
  'feishu.create_sheet': 'SMART_FACTORY_CLI_FEISHU_CREATE_SHEET_COMMAND',
};

const parseCommand = (value = '') => {
  const raw = clean(value, 2000);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((item) => clean(item, 1000)).filter(Boolean);
  } catch {
    // Require JSON arrays so command execution stays explicit and shell-free.
  }
  return [];
};

const execFileWithInput = (file, args = [], input = '', options = {}) => new Promise((resolve, reject) => {
  const child = execFile(file, args, {
    timeout: Number(options.timeoutMs || 30000),
    maxBuffer: 1024 * 1024,
    env: options.env,
  }, (error, stdout, stderr) => {
    if (error) {
      const message = clean(stderr || error.message, 1000);
      reject(new Error(message || 'CLI 执行失败。'));
      return;
    }
    resolve({ stdout, stderr });
  });
  child.stdin?.end(input);
});

const normalizeCliMessages = (stdout = '') => {
  const text = clean(stdout, 20000);
  if (!text) return [{ type: 'text', message: { text: 'CLI 执行完成，但没有返回内容。' } }];
  try {
    const payload = JSON.parse(text);
    if (Array.isArray(payload?.messages)) return payload.messages;
    if (payload?.url) return [{ type: 'link', message: { text: clean(payload.url, 2000) } }];
    if (payload?.text || payload?.content) {
      return [{ type: 'text', message: { text: clean(payload.text || payload.content, 5000) } }];
    }
  } catch {
    // Plain stdout is accepted for generic CLI tools.
  }
  if (/^https?:\/\//.test(text)) return [{ type: 'link', message: { text } }];
  return [{ type: 'text', message: { text } }];
};

export const runAllowedCliTool = async ({ executorRef = '', args = {}, env = process.env } = {}) => {
  const ref = clean(executorRef, 200);
  if (!ALLOWED_EXECUTORS.has(ref)) {
    throw new Error(`Smart Factory CLI executor is not allowlisted: ${ref}`);
  }
  const envKey = EXECUTOR_ENV_KEYS[ref];
  const command = parseCommand(env?.[envKey]);
  if (!command.length) {
    throw new Error(`Smart Factory CLI executor ${ref} is not configured. Set ${envKey} to a JSON command array.`);
  }
  const { stdout } = await execFileWithInput(command[0], command.slice(1), JSON.stringify({
    executorRef: ref,
    args,
  }), { env });
  return normalizeCliMessages(stdout);
};

export const createCliToolExecutors = (tools = []) => Object.fromEntries(
  list(tools)
    .filter((tool) => tool?.enabled !== false && clean(tool?.name))
    .map((tool) => [
      clean(tool.name),
      ({ args, env }) => runAllowedCliTool({
        executorRef: tool.executorRef || tool.executor_ref || tool.name,
        args,
        env,
      }),
    ])
);
