const clean = (value) => String(value ?? '').trim();
const list = (value) => (Array.isArray(value) ? value : []);

const tokenize = (query) => clean(query)
  .toLowerCase()
  .split(/[\s,，。；;、]+/)
  .map((item) => item.trim())
  .filter(Boolean)
  .flatMap((token) => {
    if (!/[\u4e00-\u9fff]/.test(token) || token.length <= 2) return [token];
    const grams = new Set([token]);
    for (const size of [2, 3, 4]) {
      for (let index = 0; index <= token.length - size; index += 1) {
        grams.add(token.slice(index, index + size));
      }
    }
    return Array.from(grams);
  });

const scoreChunk = (chunk = {}, tokens = []) => {
  const title = clean(chunk.title).toLowerCase();
  const content = clean(chunk.content || chunk.text).toLowerCase();
  return tokens.reduce((score, token) => {
    const titleHit = title.includes(token) ? 3 : 0;
    const contentHit = content.includes(token) ? 1 : 0;
    return score + titleHit + contentHit;
  }, 0);
};

const normalizeVector = (value) => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
};

const cosineSimilarity = (a = [], b = []) => {
  const length = Math.min(a.length, b.length);
  if (!length) return 0;
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
    aNorm += a[index] * a[index];
    bNorm += b[index] * b[index];
  }
  if (!aNorm || !bNorm) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
};

const toSearchResult = (chunk = {}, score = 0, extra = {}) => ({
  knowledgeBaseId: clean(chunk.knowledgeBaseId || chunk.datasetId || chunk.knowledge_base_id),
  documentId: clean(chunk.documentId || chunk.document_id),
  chunkId: clean(chunk.chunkId || chunk.id),
  chunkIndex: Number(chunk.chunkIndex ?? chunk.index ?? 0),
  title: clean(chunk.title || chunk.documentName),
  content: clean(chunk.content || chunk.text),
  score,
  sourceType: clean(chunk.sourceType || chunk.source_type || 'text'),
  ...extra,
});

export const searchSmartFactoryKnowledge = (query = '', chunks = [], options = {}) => {
  const tokens = tokenize(query);
  const datasetScope = new Set(list(options.datasets).map(clean).filter(Boolean));
  const topK = Number.parseInt(String(options.topK ?? options.limit ?? 5), 10);
  const limit = Number.isFinite(topK) && topK > 0 ? Math.min(20, topK) : 5;
  const similarityThreshold = Number(options.similarityThreshold ?? options.scoreThreshold ?? 1);
  const threshold = Number.isFinite(similarityThreshold) && similarityThreshold >= 0 ? similarityThreshold : 1;
  const scopedChunks = list(chunks)
    .filter((chunk) => {
      if (datasetScope.size === 0) return true;
      return datasetScope.has(clean(chunk.knowledgeBaseId || chunk.datasetId || chunk.knowledge_base_id));
    });
  const queryEmbedding = normalizeVector(options.queryEmbedding);
  const vectorCandidates = queryEmbedding.length
    ? scopedChunks
        .map((chunk) => ({ chunk, embedding: normalizeVector(chunk.embedding) }))
        .filter((item) => item.embedding.length)
    : [];
  if (vectorCandidates.length) {
    return vectorCandidates
      .map(({ chunk, embedding }) => toSearchResult(
        chunk,
        cosineSimilarity(queryEmbedding, embedding),
        { scoreType: 'vector' }
      ))
      .filter((chunk) => chunk.score >= threshold)
      .sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex)
      .slice(0, limit);
  }
  if (tokens.length === 0) return [];
  return scopedChunks
    .map((chunk) => toSearchResult(chunk, scoreChunk(chunk, tokens)))
    .filter((chunk) => chunk.score >= threshold)
    .sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex)
    .slice(0, limit);
};
