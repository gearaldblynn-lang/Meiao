# 详情出海与去文案比例语义修正设计

**目标**

只修正 `详情出海` 与 `去除文案` 两个子模式的比例与导出语义，不改变主图出海逻辑。

## 现状问题

- 当前 `detail` 与 `remove_text` 虽然执行层已走 `aspectRatio: auto`，但 prompt 仍会追加：
  - `输出画布需自然保持与原图一致的纵横比例...`
  - `原图非1:1方图时严禁生成1:1方图`
- 这会把“自动匹配最接近模型支持比例”的逻辑，错误地又加了一层 prompt 约束。
- 用户预期是：
  - 生图阶段：只让模型自动选最接近的支持比例
  - 导出阶段：再做尺寸收口

## 目标语义

### 1. 详情出海

- 生图时：
  - 使用最接近模型支持的比例参数
  - 不再在 prompt 中写原图比例约束文案
- 导出时：
  - `custom`：宽度取 `config.targetWidth`，高度按原图比例等比缩放
  - `original`：输出宽高与原图完全一致

### 2. 去除文案

- 生图时：
  - 与详情出海一致，不再追加原图比例约束 prompt
- 导出时：
  - 与详情出海一致
  - `custom`：定宽等比
  - `original`：原图同宽高

### 3. 主图出海

- 保持现状，不改。

## 实施位置

- `services/kieAiService.ts`
  - 只对 `detail` / `remove_text` 禁用比例约束 prompt 追加
- `modules/Translation/translationProcessingUtils.mjs`
  - 保持 `detail` / `remove_text` 的导出尺寸逻辑明确化
- `modules/Translation/translationProcessingUtils.test.mjs`
  - 增加详情与去文案导出规则测试

## 风险控制

- 不改 UI 字段
- 不改持久化结构
- 不改主图逻辑
- 只收缩 `detail` / `remove_text` 的 prompt 和导出语义

## 验证

1. 详情出海生图 prompt 不再包含原图比例约束文案
2. 去除文案生图 prompt 不再包含原图比例约束文案
3. 详情出海 `custom` 导出宽度固定，高度等比
4. 去除文案 `custom` 导出宽度固定，高度等比
5. 两者 `original` 导出宽高与原图一致
6. 主图出海行为不变
