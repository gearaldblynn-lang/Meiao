const timestampLowerBound = new Date('2020-01-01T00:00:00Z').getTime();
const timestampUpperBound = new Date('2100-01-01T00:00:00Z').getTime();

const toFiniteTimestamp = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= timestampLowerBound && parsed <= timestampUpperBound ? parsed : 0;
};

const extractTimestampFromText = (value: unknown): number => {
  const matches = String(value || '').match(/\d{12,13}/g) || [];
  for (const match of matches) {
    const timestamp = toFiniteTimestamp(match);
    if (timestamp) return timestamp;
  }
  return 0;
};

const parseMonthDay = (value: unknown): number => {
  const text = String(value || '').trim();
  const match = text.match(/(\d{1,2})月(\d{1,2})日/) || text.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!match) return 0;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) return 0;
  const date = new Date();
  date.setMonth(month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const startOfDay = (timestamp: number): number => {
  if (!timestamp) return 0;
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

export interface CoercedCreatedAt {
  ms: number;
  precise: boolean;
}

// 读边界唯一判据:把任意历史形态的 createdAt 恢复成规范毫秒戳。
// precise=true 仅当来自真实完整时间戳(数字/字符串戳 或 id 内嵌戳);
// precise=false 表示只能靠年缺失字符串(MM-DD / X月Y日)或 updatedAt 恢复,排序时不得排在 precise 值之前。
export const coerceCreatedAtMs = (
  raw: unknown,
  ctx: { id?: unknown; updatedAt?: unknown } = {},
): CoercedCreatedAt => {
  const direct = toFiniteTimestamp(raw) || extractTimestampFromText(ctx.id);
  if (direct) return { ms: direct, precise: true };
  const fuzzy = parseMonthDay(raw) || parseMonthDay(ctx.id) || startOfDay(toFiniteTimestamp(ctx.updatedAt));
  return { ms: fuzzy, precise: false };
};
