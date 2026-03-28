import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./arkService.ts', import.meta.url), 'utf8');

test('generateMarketingSchemes prompt enforces structured copy layout template', () => {
  assert.match(source, /文案内容排版格式模板/);
  assert.match(source, /文案类型\(字号，字体，字重，位置，色值\):"文案xxx"/);
  assert.match(source, /必须使用“文案类型\(字号，字体，字重，位置，色值\):"文案内容"”的逐行格式输出/);
  assert.match(source, /禁止把“文案内容排版”写成一整段解释/);
});
