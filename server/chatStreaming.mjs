export const formatChatSseEvent = (type, payload = {}) =>
  `data: ${JSON.stringify({ type, ...payload })}\n\n`;

export const DEFAULT_CHAT_SSE_HEARTBEAT_INTERVAL_MS = 15_000;
const MIN_CHAT_SSE_HEARTBEAT_INTERVAL_MS = 1_000;

export const formatChatSseHeartbeat = () => ': keep-alive\n\n';

export const getChatSseHeartbeatIntervalMs = (env = process.env) => {
  const parsed = Number.parseInt(String(env?.MEIAO_CHAT_SSE_HEARTBEAT_MS || ''), 10);
  return Number.isFinite(parsed) && parsed >= MIN_CHAT_SSE_HEARTBEAT_INTERVAL_MS
    ? parsed
    : DEFAULT_CHAT_SSE_HEARTBEAT_INTERVAL_MS;
};

export const startChatSseHeartbeat = (res, { env = process.env } = {}) => {
  const intervalMs = getChatSseHeartbeatIntervalMs(env);
  const timer = setInterval(() => {
    if (res?.writableEnded) return;
    res?.write?.(formatChatSseHeartbeat());
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
};
