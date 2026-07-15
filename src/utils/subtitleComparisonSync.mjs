const finiteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * @param {{ masterTime: number, followerTime: number, thresholdSeconds?: number }} input
 * @returns {number | null}
 */
export function getComparisonDriftCorrection({
  masterTime,
  followerTime,
  thresholdSeconds = 0.12,
} = {}) {
  const master = finiteNumber(masterTime);
  const follower = finiteNumber(followerTime);
  const threshold = Math.max(0, finiteNumber(thresholdSeconds, 0.12));
  return Math.abs(master - follower) <= threshold + Number.EPSILON * 10
    ? null
    : master;
}

const streamNeedsBuffer = (stream = {}, minBufferSeconds = 3) => {
  if (stream.visible === false || stream.ended === true || stream.failed === true) return false;
  const readyState = finiteNumber(stream.readyState);
  if (readyState < 3) return true;
  const remainingSeconds = Number.isFinite(Number(stream.remainingSeconds))
    ? Math.max(0, Number(stream.remainingSeconds))
    : Number.POSITIVE_INFINITY;
  if (remainingSeconds <= 0.05) return false;
  const target = Math.min(Math.max(0, minBufferSeconds), remainingSeconds);
  return finiteNumber(stream.bufferedAheadSeconds) + 0.01 < target;
};

/**
 * @param {{
 *   playIntent?: boolean,
 *   minBufferSeconds?: number,
 *   source?: object,
 *   result?: object,
 * }} input
 */
export function shouldPauseForComparisonBuffer({
  playIntent = false,
  minBufferSeconds = 3,
  source = {},
  result = {},
} = {}) {
  if (!playIntent) return false;
  const minimum = Math.max(0, finiteNumber(minBufferSeconds, 3));
  return streamNeedsBuffer(source, minimum) || streamNeedsBuffer(result, minimum);
}
