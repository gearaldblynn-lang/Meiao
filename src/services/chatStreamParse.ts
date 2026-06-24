export type ChatStreamEvent =
  | { type: 'thinking'; round?: number }
  | { type: 'retrieved'; round?: number; queries?: string[]; chunkCount?: number; docTitles?: string[] }
  | { type: 'streaming'; delta: string }
  | { type: 'compressed'; foldedRounds: number }
  | { type: 'tool_calling'; tool?: string; args?: Record<string, unknown> }
  | { type: 'searching_knowledge'; query?: string }
  | { type: 'image_generating'; model?: string; phase?: string }
  | { type: 'image_validating'; imageUrl?: string; attempt?: number }
  | { type: 'image_validation_failed'; imageUrl?: string; attempt?: number; issues?: string[] }
  | { type: 'image_regenerating'; attempt?: number }
  | { type: 'image_ready'; imageUrl?: string; imagePlan?: unknown }
  | { type: 'done'; assistantMessage?: unknown; usage?: unknown }
  | { type: 'error'; message?: string; code?: string };

export const parseChatSseChunk = (
  chunk: string,
  opts?: { withRest?: boolean },
): ChatStreamEvent[] | { events: ChatStreamEvent[]; rest: string } => {
  const parts = chunk.split('\n\n');
  const rest = parts.pop() ?? '';
  const events: ChatStreamEvent[] = [];
  for (const part of parts) {
    const line = part.trim();
    if (!line.startsWith('data:')) continue;
    try {
      events.push(JSON.parse(line.replace(/^data:\s*/, '')));
    } catch {
      // 跳过坏行，下一块到达时继续解析。
    }
  }
  return opts?.withRest ? { events, rest } : events;
};
