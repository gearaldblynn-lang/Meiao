import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { embedTexts } from './embeddingProvider.mjs';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const env = {
  EMBEDDING_PROVIDER: 'doubao',
  DOUBAO_EMBEDDING_API_KEY: 'ark-test',
  DOUBAO_EMBEDDING_BASE_URL: 'https://ark.test/api/v3',
  DOUBAO_EMBEDDING_MODEL: 'doubao-embedding-vision-251215',
};

test('单条文本返回 2048 维向量（mock）', async () => {
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url, body: JSON.parse(init.body) };
    return new Response(
      JSON.stringify({ data: [{ embedding: new Array(2048).fill(0.1) }], usage: { total_tokens: 10 } }),
      { status: 200 }
    );
  };
  const out = await embedTexts(['你好'], env);
  assert.equal(out.length, 1);
  assert.equal(out[0].length, 2048);
  assert.match(captured.url, /\/embeddings\/multimodal$/);
  assert.equal(captured.body.input[0].type, 'text');
  assert.equal(captured.body.input[0].text, '你好');
});

test('批量文本逐条算（多次请求或一次批量都接受，返回顺序对齐）', async () => {
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const txt = body.input.find((item) => item.type === 'text')?.text || '';
    const v = txt === 'a' ? 0.1 : 0.2;
    return new Response(JSON.stringify({ data: [{ embedding: new Array(2048).fill(v) }] }), { status: 200 });
  };
  const out = await embedTexts(['a', 'b'], env);
  assert.equal(out.length, 2);
  assert.equal(out[0][0], 0.1);
  assert.equal(out[1][0], 0.2);
});

test('未配 key 抛错', async () => {
  await assert.rejects(embedTexts(['x'], {}), /API.?KEY|未配置/i);
});

test('HTTP 错误抛错（供上层降级捕获）', async () => {
  globalThis.fetch = async () => new Response('{"error":{"message":"boom"}}', { status: 500 });
  await assert.rejects(embedTexts(['x'], env), /embedding|500|boom/i);
});
