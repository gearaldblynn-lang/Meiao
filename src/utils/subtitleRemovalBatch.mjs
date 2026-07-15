const boundedInteger = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

export const summarizeSubtitleRemovalBatch = (items = []) => ({
  totalCount: items.length,
  selectedCount: items.filter((item) => item?.selected).length,
  readySelectedCount: items.filter((item) => (
    item?.selected
    && item?.phase === 'ready'
    && Boolean(String(item?.draft?.sourceUrl || '').trim())
  )).length,
  errorCount: items.filter((item) => item?.phase === 'error').length,
  totalSelectedDurationSeconds: items
    .filter((item) => item?.selected)
    .reduce((sum, item) => sum + Math.max(0, Number(item?.draft?.durationSeconds || 0)), 0),
});

export const pickSubtitlePreparationItems = (items = [], activeIds = [], concurrency = 2) => {
  const activeCount = new Set(activeIds).size;
  const slots = Math.max(0, boundedInteger(concurrency, 2, 1, 4) - activeCount);
  if (slots === 0) return [];
  return items.filter((item) => item?.phase === 'queued').slice(0, slots);
};

const ACTIVE_PREPARATION_PHASES = new Set(['queued', 'uploading', 'analyzing', 'transcoding']);

export const resolveSubtitleRegionReminder = (items = [], candidateIds = []) => {
  const orderedIds = candidateIds.map((value) => String(value || '')).filter(Boolean);
  if (orderedIds.length === 0) return { settled: false, targetId: '' };

  const itemById = new Map(items.map((item) => [String(item?.clientItemId || ''), item]));
  const trackedItems = orderedIds.map((clientItemId) => itemById.get(clientItemId)).filter(Boolean);
  if (trackedItems.length < orderedIds.length) return { settled: false, targetId: '' };
  if (trackedItems.some((item) => ACTIVE_PREPARATION_PHASES.has(item?.phase))) {
    return { settled: false, targetId: '' };
  }

  const targetId = orderedIds.find((clientItemId) => {
    const item = itemById.get(clientItemId);
    return item?.phase === 'ready' && Boolean(String(item?.draft?.sourceUrl || '').trim());
  }) || '';
  return { settled: true, targetId };
};

export async function mapWithSubtitleConcurrency(items = [], concurrency = 2, worker) {
  if (!Array.isArray(items) || items.length === 0) return [];
  if (typeof worker !== 'function') throw new TypeError('worker 必须是函数');
  const results = new Array(items.length);
  const laneCount = Math.min(items.length, boundedInteger(concurrency, 2, 1, 4));
  let cursor = 0;
  const lane = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: laneCount }, () => lane()));
  return results;
}
