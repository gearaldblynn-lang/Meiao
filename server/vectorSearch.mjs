export const cosineSimilarity = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const x = Number(a[index]) || 0;
    const y = Number(b[index]) || 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

export const rankChunksByVector = (queryVec, chunks, policy = {}) => {
  const topK = Number(policy.topK || 3);
  const maxChunks = Number(policy.maxChunks || 5);
  const maxContextChars = Number(policy.maxContextChars || 2400);
  const minSimilarity = Number(policy.minSimilarity || 0);

  const scoredChunks = (Array.isArray(chunks) ? chunks : [])
    .filter((chunk) => Array.isArray(chunk?.embedding) && chunk.embedding.length > 0)
    .map((chunk) => ({ ...chunk, score: cosineSimilarity(queryVec, chunk.embedding) }))
    .filter((chunk) => chunk.score >= minSimilarity)
    .sort((a, b) => b.score - a.score || Number(a.chunkIndex || 0) - Number(b.chunkIndex || 0));

  const selected = [];
  let totalChars = 0;
  for (const chunk of scoredChunks) {
    if (selected.length >= topK || selected.length >= maxChunks) break;
    const content = String(chunk.content || '');
    if (!content) continue;
    if (totalChars + content.length > maxContextChars) break;
    selected.push(chunk);
    totalChars += content.length;
  }
  return selected;
};
