export const formatChatSseEvent = (type, payload = {}) =>
  `data: ${JSON.stringify({ type, ...payload })}\n\n`;
