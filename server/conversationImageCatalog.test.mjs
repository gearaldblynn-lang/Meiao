import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionImageCatalog, formatCatalogForPrompt, isUrlInCatalog } from './conversationImageCatalog.mjs';

const priorMessages = [
  { role: 'user', attachments: [{ kind: 'image', url: 'https://a/p.jpg', name: '产品图.jpg' }] },
  { role: 'assistant', content: '已生成', metadata: { imageUrl: 'https://a/g1.png', imagePlan: { inputImageUrls: ['https://a/p.jpg'] } } },
];

test('用户上传与 AI 生成都进目录，来源正确', () => {
  const cat = buildSessionImageCatalog({ attachments: [], priorMessages });
  assert.equal(cat.length, 2);
  assert.equal(cat[0].source, 'user_upload');
  assert.equal(cat[1].source, 'ai_generated');
});

test('序号稳定且连续从 1 开始', () => {
  const cat = buildSessionImageCatalog({ attachments: [], priorMessages });
  assert.deepEqual(cat.map((i) => i.index), [1, 2]);
});

test('AI 生成图推导出 generatedFrom（基于哪张图）', () => {
  const cat = buildSessionImageCatalog({ attachments: [], priorMessages });
  assert.deepEqual(cat[1].generatedFrom, [1]);
});

test('最新 AI 生成图作为多轮修改的默认当前目标', () => {
  const cat = buildSessionImageCatalog({
    attachments: [],
    priorMessages: [
      ...priorMessages,
      { role: 'assistant', content: '第二版', attachments: [{ kind: 'image', url: 'https://a/g2.png', name: '第二版' }], metadata: { imagePlan: { inputImageUrls: ['https://a/g1.png'] } } },
    ],
  });
  const latest = cat.find((item) => item.url === 'https://a/g2.png');
  assert.equal(latest?.isCurrentFocus, true);
  assert.match(formatCatalogForPrompt(cat), /当前默认编辑图/);
  assert.match(formatCatalogForPrompt(cat), /这张\/上一张\/刚才那张\/继续修改/);
});

test('本轮新上传图排在最前', () => {
  const cat = buildSessionImageCatalog({
    attachments: [{ kind: 'image', url: 'https://a/new.jpg', name: '新图.jpg' }],
    priorMessages,
  });
  assert.equal(cat[0].url, 'https://a/new.jpg');
  assert.equal(cat[0].source, 'user_upload');
  assert.equal(cat[0].isCurrentFocus, true);
});

test('同一 URL 不重复进目录', () => {
  const dup = [
    { role: 'user', attachments: [{ kind: 'image', url: 'https://a/x.jpg', name: 'x' }] },
    { role: 'user', attachments: [{ kind: 'image', url: 'https://a/x.jpg', name: 'x' }] },
  ];
  const cat = buildSessionImageCatalog({ attachments: [], priorMessages: dup });
  assert.equal(cat.length, 1);
});

test('formatCatalogForPrompt 输出含图号、来源、URL', () => {
  const cat = buildSessionImageCatalog({ attachments: [], priorMessages });
  const text = formatCatalogForPrompt(cat);
  assert.match(text, /图1/);
  assert.match(text, /用户上传/);
  assert.match(text, /https:\/\/a\/p\.jpg/);
  assert.match(text, /AI生成/);
});

test('isUrlInCatalog 校验 URL 存在性', () => {
  const cat = buildSessionImageCatalog({ attachments: [], priorMessages });
  assert.equal(isUrlInCatalog(cat, 'https://a/p.jpg'), true);
  assert.equal(isUrlInCatalog(cat, 'https://a/不存在.png'), false);
});

test('空输入返回空目录，格式化返回空提示', () => {
  const cat = buildSessionImageCatalog({ attachments: [], priorMessages: [] });
  assert.deepEqual(cat, []);
  assert.match(formatCatalogForPrompt(cat), /没有可引用的图片|无/);
});
