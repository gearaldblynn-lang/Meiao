# 第3期：知识库 RAG（向量语义检索）— 设计规格

> 日期：2026-06-16
> 前置：第1期对话内核 ✅、第2期生图工具调用 ✅（含本地/MySQL 双 handler 修复）
> 目标：**一个成熟可用、能调知识库、对话体验像 GPT 的智能体**——把现有"关键词检索"升级为豆包 embedding 的**纯向量语义检索**，并优化分块质量。
> 范围：embedding provider + 知识块向量化 + 向量检索 + 分块优化 + 降级。不碰状态对账、不推翻知识库 CRUD/绑定。

---

## 0. 红线

- **禁碰**：`server/appStateMerge.mjs`、`src/adapters/shellPersistence.ts`（状态对账）
- **禁推翻**：知识库 CRUD、文档绑定、`MODULE_INTERFACES`、`runAgenticRetrievalLoop` 框架——只升级"检索"和"分块"两个内核
- **双 handler 同步**（根因 #7 教训）：凡改 chat/检索逻辑，MySQL 模式（`createDbChatReply` / `getDb*`）和本地 JSON 模式（9529 handler / `getLocal*`）两套必须同步改，plan 验收要求两种 mode 都测
- **embedding key 不进 git**：`DOUBAO_EMBEDDING_API_KEY` 走 `.env.server`，`.env.server.example` 只留注释

---

## 1. 现状（已验证，2026-06-16 读码 + 探针确认）

### 已有（不重做）
- 知识库 CRUD、文档上传、智能体绑定知识库（`agent_version_knowledge_bases`）
- 文档分块 `chunkKnowledgeText`（策略 general/rule/sop/faq/case）
- 知识块表 `knowledge_chunks` **已有 `embedding_json LONGTEXT NULL` 字段**（当前写入 null，没用上）
- 检索 `searchKnowledgeChunks`（**纯关键词** `includes` 匹配 + 来源权重）
- 智能体多轮检索循环 `runAgenticRetrievalLoop`（模型用 `[SEARCH: xxx]` 标记触发检索）

### 缺口（第3期补）
1. 没有 embedding provider（不调任何向量接口）
2. `embedding_json` 写入恒为 null
3. 检索是关键词匹配，不理解语义（"怎么退货"匹配不到"退换货流程"）
4. 分块无重叠（`splitChunkByLength` 硬切），跨边界语义被劈断；块偏小（320~680 字符）

### 地基（探针验证）
- 火山方舟豆包 `doubao-embedding-vision-251215`
- 端点：`https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal`
- 维度：**2048**；纯文本输入 `{type:'text', text:'...'}` 可用；usage 正常返回

---

## 2. 核心决策（业主拍板）

| 决策点 | 选择 |
|--------|------|
| 向量来源 | 火山方舟豆包 `doubao-embedding-vision-251215`（2048 维） |
| 向量存储 | 存现有库（MySQL `embedding_json` / 本地 JSON），**应用层算余弦相似度**，不引入向量数据库 |
| 检索策略 | **纯向量**（不做关键词+向量混合） |
| 旧知识块 | **只对新上传的算向量**，旧块不回填，自然随重新上传更新 |
| 分块 | 授权优化：加重叠 + 句子边界切 + 调大小 |

---

## 3. 架构设计

### 3.1 数据流

```
【离线：文档上传 → 分块 → 向量化】
文档上传
  → chunkKnowledgeText（优化后：重叠+句子边界）
  → 每块调 embedDocumentChunks（豆包 embedding，批量）
  → 存 content + embedding_json(2048 维数组 JSON) 进 knowledge_chunks

【在线：用户提问 → 向量检索】
用户提问（或 runAgenticRetrievalLoop 的 [SEARCH: xxx]）
  → embedQuery（豆包 embedding 算 query 向量）
  → 取该智能体绑定知识库的所有块（带 embedding）
  → 应用层算余弦相似度 → 按分排序 → topK / maxChunks / maxContextChars 截断
  → 喂给模型
  → embedding 服务不可用 → 降级回关键词 searchKnowledgeChunks
```

### 3.2 模块划分（新建/改）

| 文件 | 职责 | 新建/改 |
|------|------|---------|
| `server/embeddingProvider.mjs` | 豆包 embedding 调用：单条/批量、超时、错误。可插拔（豆包是首个实现） | 新建 |
| `server/embeddingProvider.test.mjs` | provider 单测（mock fetch） | 新建 |
| `server/vectorSearch.mjs` | 余弦相似度 + 向量检索排序（纯函数，可测） | 新建 |
| `server/vectorSearch.test.mjs` | 余弦/排序/截断测试 | 新建 |
| `src/modules/AgentCenter/agentCenterUtils.mjs` | `chunkKnowledgeText` 加重叠+句子边界；块大小上调 | 改 |
| `server/index.mjs` | 上传分块时填 embedding；检索接 embedQuery+vectorSearch，降级回关键词。**MySQL + 本地两个 handler 同步** | 改 |
| `.env.server.example` | 豆包 embedding env 注释 | 改 |

### 3.3 可插拔（复用第2期 provider 模式）

```js
// embeddingProvider.mjs 对外暴露统一接口
export const embedTexts = async (texts, env) => [...]  // 返回每条文本的 2048 维向量
// 内部按 env.EMBEDDING_PROVIDER 分发（当前只有 'doubao'）
// 将来换服务只改这个文件，vectorSearch 和检索逻辑不动
```

---

## 4. 分块优化（治"分太散"）

### 4.1 现状问题
- `splitChunkByLength` 按字数**硬切**，无重叠 → 跨边界语义被劈断（检索召回半句）
- 块偏小（320~680 字符），低于向量检索甜区（约 500~1000 字符）
- 长文本无空行时退化成纯字数切

### 4.2 优化（保留策略框架，只改"切"的算法）
1. **块间重叠**：相邻块重叠约 15%（默认 ~120 字符），跨边界语义不丢
2. **块大小上调**：默认 maxChunkChars 提到约 700~800（各策略按比例上调，rule/faq 类保持偏小因为天然短）
3. **句子边界切**：在 `。！？!?\n` 附近断句，不在词中间硬劈；找不到边界才回退字数切
4. 策略分类（general/rule/sop/faq/case）保留不变

### 4.3 生效范围
- 新分块算法**只对新上传文档生效**（与"只算新上传"决策一致）
- 旧块保持原样，重新上传该文档时才用新算法

---

## 5. 向量检索（纯向量）

### 5.1 余弦相似度（`vectorSearch.mjs` 纯函数）
```js
export const cosineSimilarity = (a, b) => { /* 点积 / (模a*模b) */ };
export const rankChunksByVector = (queryVec, chunks, { topK, maxChunks, maxContextChars, minSimilarity }) => {
  // 对每个有 embedding 的 chunk 算 cosine，按分排序，按 topK/maxChunks/maxContextChars 截断
  // 没有 embedding 的 chunk（旧块）跳过或降级走关键词（见 5.3）
};
```

### 5.2 检索流程接入
- `searchKnowledgeChunks`（关键词）保留，新增 `searchKnowledgeChunksByVector(query, chunks, policy, env)`：
  1. `embedQuery = await embedTexts([query], env)`
  2. `rankChunksByVector(embedQuery, chunks, policy)`
- `runAgenticRetrievalLoop` 和首轮检索改调向量版

### 5.3 降级（不阻断对话）
- embedding 服务报错/超时 → 捕获 → 降级回 `searchKnowledgeChunks`（关键词），并 log 告警
- 块没有 embedding（旧块，embedding_json 为 null）→ 该块走关键词兜底参与排序（保证旧库不失效）

### 5.4 相似度阈值
- `retrievalPolicy.similarityThreshold` 复用，但语义变了：向量检索下是余弦相似度阈值（0~1，默认建议 0.3，env 可调 `EMBEDDING_MIN_SIMILARITY`）
- 阈值做成保守默认 + env（根因纪律：阈值类参数 env+保守默认）

---

## 6. 成本与缓存

- **批量 embedding**：上传一篇文档的多个块，一次请求批量算（豆包 input 支持数组），减少请求数
- **query 缓存**：同一 query 文本短期缓存向量（内存 LRU，TTL 几分钟），避免重复对话重复算
- **token 成本**：embedding 比对话便宜得多；usage 已确认返回，记入现有计费/日志

---

## 7. 环境变量

```bash
# ── 知识库 RAG embedding（第3期）────────────────
# EMBEDDING_PROVIDER=doubao
# DOUBAO_EMBEDDING_API_KEY=ark-xxxx              # 火山方舟 API Key
# DOUBAO_EMBEDDING_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
# DOUBAO_EMBEDDING_MODEL=doubao-embedding-vision-251215
# EMBEDDING_MIN_SIMILARITY=0.3                   # 余弦相似度阈值，保守默认
# EMBEDDING_TIMEOUT_MS=30000
```

---

## 8. 测试策略

- `embeddingProvider.test.mjs`：mock fetch 验证请求格式（doubao multimodal 端点 + `{type:text}` 输入）、批量、超时、错误降级
- `vectorSearch.test.mjs`：余弦相似度数学正确性、排序、topK/maxContextChars 截断、无 embedding 块跳过
- `agentCenterUtils.mjs` 分块测试：重叠存在、句子边界切、块大小、旧测试不回归
- `index.mjs` 集成：检索走向量 + embedding 挂了降级关键词 + 旧块（无向量）兜底——**MySQL 和本地两种 mode 都测**（根因 #7）
- 收尾：后端全量 + 前端全量 + lint + build

---

## 9. 显式排除（不做）

- **不做混合检索**（业主选纯向量）——但保留关键词函数作降级
- **不回填旧块**（业主决定只算新上传）
- **不引入向量数据库**——应用层余弦，规模够用
- **不推翻分块策略框架**——只改切分算法
- **不做 rerank 重排模型**——纯向量 topK 够用，将来需要再说
- **不动 embedding 存储 schema**——`embedding_json` 字段已存在，直接填

---

## 10. 验收（业主视角"成熟可用"）

- 上传一篇知识文档 → 块带上了向量（`embedding_json` 非 null）
- 用不同措辞提问（"怎么退货" vs 文档里的"退换货流程"）→ 能召回正确知识块（关键词检索召回不到的，向量能召回）
- embedding 服务断开 → 对话不报错，自动降级关键词，结果仍可用
- 分块优化后，召回的知识块语义完整（不再是半句）
- MySQL 模式和本地 JSON 模式表现一致
