let activeHeavyProcesses = 0;
const heavyProcessQueue = [];

const abortError = () => Object.assign(
  new Error('voiceover heavy process cancelled'),
  { name: 'AbortError', code: 'request_cancelled', cancelled: true },
);

const pumpQueue = () => {
  while (heavyProcessQueue.length > 0) {
    const entry = heavyProcessQueue[0];
    if (entry.signal?.aborted) {
      entry.abort();
      continue;
    }
    if (activeHeavyProcesses >= entry.limit) return;
    heavyProcessQueue.shift();
    entry.settled = true;
    entry.signal?.removeEventListener('abort', entry.abort);
    activeHeavyProcesses += 1;
    let released = false;
    entry.resolve(() => {
      if (released) return;
      released = true;
      activeHeavyProcesses = Math.max(0, activeHeavyProcesses - 1);
      pumpQueue();
    });
  }
};

export async function acquireVoiceoverHeavyProcessPermit(signal, limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 2) {
    throw new TypeError('voiceover heavy process limit must be an integer from 1 to 2');
  }
  return new Promise((resolve, reject) => {
    const entry = {
      signal,
      limit,
      resolve,
      reject,
      settled: false,
    };
    entry.abort = () => {
      if (entry.settled) return;
      entry.settled = true;
      const index = heavyProcessQueue.indexOf(entry);
      if (index >= 0) heavyProcessQueue.splice(index, 1);
      entry.signal?.removeEventListener('abort', entry.abort);
      reject(abortError());
      pumpQueue();
    };
    if (signal?.aborted) {
      entry.abort();
      return;
    }
    signal?.addEventListener('abort', entry.abort, { once: true });
    heavyProcessQueue.push(entry);
    pumpQueue();
  });
}
