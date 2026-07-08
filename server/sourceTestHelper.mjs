// 共享测试辅助:从源码字符串中按标记边界切片。
// 用于 source-level 测试(读 .mjs 源码字符串并断言结构/不变量),
// 避免各测试文件各自实现 extractSlice/getSection 等同款 helper。
import assert from 'node:assert/strict';

/**
 * 从 source 字符串中取 [startMarker, endMarker) 之间的内容。
 * @param {string} source   - 要搜索的完整源码字符串
 * @param {string} startMarker - 起始标记(包含在切片内)
 * @param {string} endMarker   - 终止标记(不包含在切片内)
 * @returns {string} source.slice(start, end)
 */
export const getSection = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `sourceTestHelper.getSection: 找不到起始标记: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `sourceTestHelper.getSection: 找不到终止标记(或在起始之前): ${endMarker}`);
  return source.slice(start, end);
};
