const normalizeIdentity = (value) => String(value || '').trim();

const normalizePositiveTimestamp = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const MAX_PRODUCT_RESTORE_EVENT_TIMESTAMP = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

const normalizeEventTimestamp = (value) => {
  const parsed = Number(value);
  return (
    Number.isSafeInteger(parsed)
    && parsed > 0
    && parsed <= MAX_PRODUCT_RESTORE_EVENT_TIMESTAMP
  ) ? parsed : undefined;
};

const normalizeEventId = (value) => normalizeIdentity(value).slice(0, 200);

const normalizeCausalGeneration = (value) => {
  const normalized = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d{0,79})$/.test(normalized)) return undefined;
  return BigInt(normalized).toString();
};

const cloneCausalPosition = (event) => {
  const epoch = normalizeEventId(event?.causalEpoch);
  const generation = normalizeCausalGeneration(event?.causalGeneration);
  return epoch && generation !== undefined ? { epoch, generation } : undefined;
};

const incrementCausalGeneration = (generation) => (
  (BigInt(normalizeCausalGeneration(generation) || '0') + 1n).toString()
);

const compareCausalPositions = (left, right) => {
  if (!left || !right || left.epoch !== right.epoch) return undefined;
  const leftGeneration = BigInt(left.generation);
  const rightGeneration = BigInt(right.generation);
  if (leftGeneration === rightGeneration) return 0;
  return leftGeneration > rightGeneration ? 1 : -1;
};

const createEventId = (kind) => {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return `${kind}:${randomUuid}`;
  return `${kind}:${Date.now()}:${Math.random().toString(36).slice(2, 14)}`;
};

const nextEventTimestamp = (requested, ...previousValues) => {
  const safeNow = normalizeEventTimestamp(Date.now()) || 1;
  const base = normalizeEventTimestamp(requested) || safeNow;
  const safePrevious = previousValues
    .map(normalizeEventTimestamp)
    .filter((value) => value !== undefined);
  if (safePrevious.length === 0) return base;
  const latestPrevious = Math.max(...safePrevious);
  const incremented = latestPrevious < Number.MAX_SAFE_INTEGER
    ? latestPrevious + 1
    : undefined;
  const candidate = Math.max(base, normalizeEventTimestamp(incremented) || base);
  return normalizeEventTimestamp(candidate) || safeNow;
};

const sortedIdentities = (values) => Array.from(values).filter(Boolean).sort();

export const cloneProductRestoreCancellationMarker = (marker) => {
  const cancelledAt = normalizeEventTimestamp(marker?.cancelledAt);
  if (
    marker?.version !== 1
    || marker?.status !== 'cancelled'
    || marker?.reason !== 'user_requested'
    || cancelledAt === undefined
  ) return undefined;
  const eventId = normalizeEventId(marker?.eventId);
  const supersedesEventId = normalizeEventId(marker?.supersedesEventId);
  const causalPosition = cloneCausalPosition(marker);
  return {
    version: 1,
    status: 'cancelled',
    reason: 'user_requested',
    cancelledAt,
    jobIds: sortedIdentities(new Set((marker.jobIds || []).map(normalizeIdentity))),
    ...(eventId ? { eventId } : {}),
    ...(supersedesEventId ? { supersedesEventId } : {}),
    ...(causalPosition ? {
      causalEpoch: causalPosition.epoch,
      causalGeneration: causalPosition.generation,
    } : {}),
  };
};

export const cloneProductRestoreCancellationReset = (reset) => {
  const resetAt = normalizeEventTimestamp(reset?.resetAt);
  if (
    reset?.version !== 1
    || reset?.status !== 'retry_reset'
    || reset?.reason !== 'explicit_retry'
    || resetAt === undefined
  ) return undefined;
  const priorCancelledAt = normalizeEventTimestamp(reset?.priorCancelledAt);
  const eventId = normalizeEventId(reset?.eventId);
  const supersedesEventId = normalizeEventId(reset?.supersedesEventId);
  const causalPosition = cloneCausalPosition(reset);
  return {
    version: 1,
    status: 'retry_reset',
    reason: 'explicit_retry',
    resetAt,
    ...(priorCancelledAt !== undefined ? { priorCancelledAt } : {}),
    ...(eventId ? { eventId } : {}),
    ...(supersedesEventId ? { supersedesEventId } : {}),
    ...(causalPosition ? {
      causalEpoch: causalPosition.epoch,
      causalGeneration: causalPosition.generation,
    } : {}),
  };
};

const cancellationEventIdentity = (marker) => {
  const normalized = cloneProductRestoreCancellationMarker(marker);
  if (!normalized) return '';
  return normalized.eventId || `product_restore_cancelled:${normalized.cancelledAt}`;
};

const resetEventIdentity = (reset) => {
  const normalized = cloneProductRestoreCancellationReset(reset);
  if (!normalized) return '';
  return normalized.eventId || `product_restore_retry_reset:${normalized.resetAt}`;
};

const deterministicIdentity = (...values) => values
  .map(normalizeIdentity)
  .filter(Boolean)
  .sort()[0] || '';

const buildCancellationEventGraph = (events) => {
  const byId = new Map(events.map((event) => [event.id, event]));
  const positions = new Map();
  const resolvePosition = (event, visited = new Set()) => {
    if (!event) return undefined;
    if (positions.has(event.id)) return positions.get(event.id);
    const stored = cloneCausalPosition(event.value);
    if (stored) {
      positions.set(event.id, stored);
      return stored;
    }
    const supersededId = normalizeEventId(event.value?.supersedesEventId);
    if (supersededId && !visited.has(event.id)) {
      const nextVisited = new Set(visited).add(event.id);
      const parent = byId.get(supersededId);
      const parentPosition = parent && !nextVisited.has(parent.id)
        ? resolvePosition(parent, nextVisited)
        : undefined;
      const inherited = parentPosition
        ? {
            epoch: parentPosition.epoch,
            generation: incrementCausalGeneration(parentPosition.generation),
          }
        : { epoch: supersededId, generation: '1' };
      positions.set(event.id, inherited);
      return inherited;
    }
    const root = { epoch: event.id, generation: '0' };
    positions.set(event.id, root);
    return root;
  };
  return { byId, resolvePosition };
};

const buildContextCancellationEvents = (marker, reset) => [
  marker ? { kind: 'cancelled', value: marker, id: cancellationEventIdentity(marker) } : undefined,
  reset ? { kind: 'retry_reset', value: reset, id: resetEventIdentity(reset) } : undefined,
].filter(Boolean);

const mergeCancellationMarkers = (existing, incoming) => {
  const current = cloneProductRestoreCancellationMarker(existing);
  const next = cloneProductRestoreCancellationMarker(incoming);
  if (!current) return next;
  if (!next) return current;
  if (cancellationEventIdentity(current) === cancellationEventIdentity(next)) {
    return {
      ...current,
      jobIds: sortedIdentities(new Set([...current.jobIds, ...next.jobIds])),
    };
  }
  if (current.cancelledAt > next.cancelledAt) return current;
  if (next.cancelledAt > current.cancelledAt) return next;
  return cancellationEventIdentity(current) >= cancellationEventIdentity(next) ? current : next;
};

const mergeCancellationResets = (existing, incoming) => {
  const current = cloneProductRestoreCancellationReset(existing);
  const next = cloneProductRestoreCancellationReset(incoming);
  if (!current) return next;
  if (!next) return current;
  if (resetEventIdentity(current) === resetEventIdentity(next)) {
    const priorCancelledAt = Math.max(
      Number(current.priorCancelledAt || 0),
      Number(next.priorCancelledAt || 0),
    );
    return {
      ...current,
      ...(priorCancelledAt > 0 ? { priorCancelledAt } : {}),
    };
  }
  if (current.resetAt > next.resetAt) return current;
  if (next.resetAt > current.resetAt) return next;
  return resetEventIdentity(current) >= resetEventIdentity(next) ? current : next;
};

const mergeCancellationEvents = (existingContext, incomingContext) => {
  const rawEvents = [
    { kind: 'cancelled', value: cloneProductRestoreCancellationMarker(existingContext?.productRestoreCancellation) },
    { kind: 'retry_reset', value: cloneProductRestoreCancellationReset(existingContext?.productRestoreCancellationReset) },
    { kind: 'cancelled', value: cloneProductRestoreCancellationMarker(incomingContext?.productRestoreCancellation) },
    { kind: 'retry_reset', value: cloneProductRestoreCancellationReset(incomingContext?.productRestoreCancellationReset) },
  ].filter((event) => event.value);
  const byId = new Map();
  for (const event of rawEvents) {
    const id = event.kind === 'cancelled'
      ? cancellationEventIdentity(event.value)
      : resetEventIdentity(event.value);
    const previous = byId.get(id);
    if (!previous) {
      byId.set(id, { ...event, id });
      continue;
    }
    byId.set(id, {
      ...event,
      id,
      value: event.kind === 'cancelled'
        ? mergeCancellationMarkers(previous.value, event.value)
        : mergeCancellationResets(previous.value, event.value),
    });
  }
  const events = Array.from(byId.values());
  const graph = buildCancellationEventGraph(events);
  const reaches = (candidate, target) => {
    const visited = new Set();
    let nextId = normalizeEventId(candidate?.value?.supersedesEventId);
    while (nextId && !visited.has(nextId)) {
      if (nextId === target.id) return true;
      visited.add(nextId);
      nextId = normalizeEventId(byId.get(nextId)?.value?.supersedesEventId);
    }
    return false;
  };
  const choose = (kind) => events.filter((event) => event.kind === kind).reduce((selected, candidate) => {
    if (!selected) return candidate;
    if (reaches(candidate, selected)) return candidate;
    if (reaches(selected, candidate)) return selected;
    const causalOrder = compareCausalPositions(
      graph.resolvePosition(candidate),
      graph.resolvePosition(selected),
    );
    if (causalOrder !== undefined && causalOrder !== 0) {
      return causalOrder > 0 ? candidate : selected;
    }
    const selectedAt = kind === 'cancelled' ? selected.value.cancelledAt : selected.value.resetAt;
    const candidateAt = kind === 'cancelled' ? candidate.value.cancelledAt : candidate.value.resetAt;
    if (candidateAt !== selectedAt) return candidateAt > selectedAt ? candidate : selected;
    return candidate.id > selected.id ? candidate : selected;
  }, undefined);
  return {
    marker: choose('cancelled')?.value,
    reset: choose('retry_reset')?.value,
  };
};

export const createProductRestoreCancellationReset = (generationContext, now = Date.now()) => {
  const marker = cloneProductRestoreCancellationMarker(
    generationContext?.productRestoreCancellation,
  );
  const previousReset = cloneProductRestoreCancellationReset(
    generationContext?.productRestoreCancellationReset,
  );
  const resetAt = nextEventTimestamp(now, marker?.cancelledAt, previousReset?.resetAt);
  const contextEvents = buildContextCancellationEvents(marker, previousReset);
  const graph = buildCancellationEventGraph(contextEvents);
  const predecessor = hasEffectiveProductRestoreCancellation(generationContext)
    ? contextEvents.find((event) => event.kind === 'cancelled')
    : contextEvents.find((event) => event.kind === 'retry_reset')
      || contextEvents.find((event) => event.kind === 'cancelled');
  const predecessorPosition = graph.resolvePosition(predecessor);
  return {
    version: 1,
    status: 'retry_reset',
    reason: 'explicit_retry',
    resetAt,
    eventId: createEventId('product_restore_retry_reset'),
    ...(predecessorPosition ? {
      causalEpoch: predecessorPosition.epoch,
      causalGeneration: incrementCausalGeneration(predecessorPosition.generation),
    } : {}),
    ...(marker ? { supersedesEventId: cancellationEventIdentity(marker) } : {}),
    ...((marker?.cancelledAt || previousReset?.priorCancelledAt)
      ? { priorCancelledAt: marker?.cancelledAt || previousReset.priorCancelledAt }
      : {}),
  };
};

export const createProductRestoreCancellationMarker = (
  generationContext,
  { cancelledAt = Date.now(), jobIds = [] } = {},
) => {
  const existingMarker = cloneProductRestoreCancellationMarker(
    generationContext?.productRestoreCancellation,
  );
  const existingReset = cloneProductRestoreCancellationReset(
    generationContext?.productRestoreCancellationReset,
  );
  if (hasEffectiveProductRestoreCancellation(generationContext) && existingMarker) {
    return {
      ...existingMarker,
      jobIds: sortedIdentities(new Set([...existingMarker.jobIds, ...jobIds.map(normalizeIdentity)])),
    };
  }
  const eventTimestamp = nextEventTimestamp(cancelledAt, existingReset?.resetAt);
  const contextEvents = buildContextCancellationEvents(existingMarker, existingReset);
  const graph = buildCancellationEventGraph(contextEvents);
  const resetEvent = contextEvents.find((event) => event.kind === 'retry_reset');
  const resetPosition = graph.resolvePosition(resetEvent);
  const rootEpoch = `product_restore_cancelled:${eventTimestamp}`;
  return {
    version: 1,
    status: 'cancelled',
    reason: 'user_requested',
    cancelledAt: eventTimestamp,
    jobIds: sortedIdentities(new Set(jobIds.map(normalizeIdentity))),
    causalEpoch: resetPosition?.epoch || rootEpoch,
    causalGeneration: resetPosition
      ? incrementCausalGeneration(resetPosition.generation)
      : '0',
    ...(existingReset
      ? {
          eventId: createEventId('product_restore_cancelled'),
          supersedesEventId: resetEventIdentity(existingReset),
        }
      : {}),
  };
};

export const hasEffectiveProductRestoreCancellation = (generationContext) => {
  const marker = cloneProductRestoreCancellationMarker(
    generationContext?.productRestoreCancellation,
  );
  if (!marker) return false;
  const reset = cloneProductRestoreCancellationReset(
    generationContext?.productRestoreCancellationReset,
  );
  if (!reset) return true;
  const markerIdentity = cancellationEventIdentity(marker);
  const resetIdentity = resetEventIdentity(reset);
  if (marker.supersedesEventId === resetIdentity) return true;
  if (reset.supersedesEventId === markerIdentity) return false;
  const events = buildContextCancellationEvents(marker, reset);
  const graph = buildCancellationEventGraph(events);
  const causalOrder = compareCausalPositions(
    graph.resolvePosition(events.find((event) => event.kind === 'cancelled')),
    graph.resolvePosition(events.find((event) => event.kind === 'retry_reset')),
  );
  if (causalOrder !== undefined && causalOrder !== 0) return causalOrder > 0;
  return marker.cancelledAt >= reset.resetAt;
};

const STRICT_NON_NEGATIVE_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

const normalizeKnownCredits = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!STRICT_NON_NEGATIVE_DECIMAL.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const VALID_ATTEMPT_STATUSES = new Set([
  'running',
  'succeeded',
  'invalid',
  'failed',
  'cancelled',
]);

const ATTEMPT_STATUS_PRIORITY = {
  running: 0,
  failed: 1,
  cancelled: 2,
  invalid: 3,
  succeeded: 4,
};

const cloneAnalysisAttempt = (attempt) => {
  const jobId = normalizeIdentity(attempt?.jobId);
  if (!jobId) return undefined;
  const requestedStatus = normalizeIdentity(attempt?.status);
  const status = VALID_ATTEMPT_STATUSES.has(requestedStatus) ? requestedStatus : 'running';
  const timestamp = normalizePositiveTimestamp(attempt?.timestamp) || Date.now();
  const providerTaskId = normalizeIdentity(attempt?.providerTaskId);
  const model = normalizeIdentity(attempt?.model);
  const errorCode = normalizeIdentity(attempt?.errorCode);
  const creditsConsumed = normalizeKnownCredits(attempt?.creditsConsumed);
  return {
    jobId,
    ...(providerTaskId ? { providerTaskId } : {}),
    ...(model ? { model } : {}),
    status,
    ...(errorCode ? { errorCode } : {}),
    timestamp,
    ...(creditsConsumed !== undefined ? { creditsConsumed } : {}),
  };
};

export const mergeProductRestoreAnalysisAttemptsForStorage = (current, incoming) => {
  const merged = [];
  const byJobId = new Map();
  const source = [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]
    .map(cloneAnalysisAttempt)
    .filter(Boolean);
  for (const next of source) {
    const index = byJobId.get(next.jobId);
    if (index === undefined) {
      byJobId.set(next.jobId, merged.length);
      merged.push(next);
      continue;
    }
    const previous = merged[index];
    const status = ATTEMPT_STATUS_PRIORITY[next.status] >= ATTEMPT_STATUS_PRIORITY[previous.status]
      ? next.status
      : previous.status;
    const knownCredits = [previous.creditsConsumed, next.creditsConsumed]
      .filter((value) => value !== undefined);
    const providerTaskId = deterministicIdentity(previous.providerTaskId, next.providerTaskId);
    const model = deterministicIdentity(previous.model, next.model);
    const errorCode = deterministicIdentity(previous.errorCode, next.errorCode);
    merged[index] = {
      jobId: previous.jobId,
      ...(providerTaskId ? { providerTaskId } : {}),
      ...(model ? { model } : {}),
      status,
      ...(errorCode ? { errorCode } : {}),
      timestamp: Math.min(previous.timestamp, next.timestamp),
      ...(knownCredits.length > 0 ? { creditsConsumed: Math.max(...knownCredits) } : {}),
    };
  }
  return merged;
};

export const mergeProductRestoreGenerationContextForStorage = (existingContext, incomingContext) => {
  if (!existingContext && !incomingContext) return undefined;
  const merged = {
    ...(existingContext || {}),
    ...(incomingContext || {}),
  };
  const attempts = mergeProductRestoreAnalysisAttemptsForStorage(
    existingContext?.productRestoreAnalysisAttempts,
    incomingContext?.productRestoreAnalysisAttempts,
  );
  if (attempts.length > 0) merged.productRestoreAnalysisAttempts = attempts;
  else delete merged.productRestoreAnalysisAttempts;

  const { marker, reset } = mergeCancellationEvents(existingContext, incomingContext);
  if (marker) merged.productRestoreCancellation = marker;
  else delete merged.productRestoreCancellation;

  if (reset) merged.productRestoreCancellationReset = reset;
  else delete merged.productRestoreCancellationReset;
  return merged;
};
