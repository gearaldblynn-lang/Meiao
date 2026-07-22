# 梅奥密钥包与 Git 历史净化设计

## 目标

让公开 GitHub 仓库只包含程序、空配置模板和安全导入工具；真实凭据放在仓库外的机器可读密钥包中。朋友克隆仓库后，可以让 AI 或本人执行一条命令，将密钥包安全导入本地 `.env.server`。

同时必须处置已经进入公开仓库且仍在云上使用的 `OPENAI_COMPATIBLE_API_KEY`：轮换密钥、清理所有 Git 分支与标签的历史内容，并增加自动门禁，避免再次提交真实凭据。

## 已确认事实

- GitHub 仓库当前公开，默认分支为 `main`。
- 一枚真实 `OPENAI_COMPATIBLE_API_KEY` 曾进入已跟踪文档，并与云上当前值一致；密钥值不得在日志、文档、命令输出或修复记录中再次出现。
- `.env.server` 已被 Git 忽略，`.env.server.example` 只保存空值和示例值。
- 云上生产 `.env.server` 还包含数据库、管理员、COS、素材访问和 provider 等不同权限域，不能把整个生产文件原样交给朋友。
- 朋友需要机器可读的独立密钥包，并认可共享可产生费用的 provider 凭据。

## 安全边界

### 允许进入朋友密钥包

密钥包只允许下列服务配置族中实际存在且非空的键：

- KIE：`KIE_API_KEY`、`MEIAO_KIE_API_KEY`、`KIE_CHAT_MODEL`
- APIports：`APIPORTS_API_KEY`、`MEIAO_APIPORTS_API_KEY`、`APIPORTS_BASE_URL`
- MaxForAI：`MAXFORAI_API_KEY`、`MAXFORAI_BASE_URL`、`MAXFORAI_VIDEO_API_KEY`、`MAXFORAI_VIDEO_BASE_URL`
- OpenAI Compatible：`OPENAI_COMPATIBLE_API_KEY`、`OPENAI_COMPATIBLE_BASE_URL`、`OPENAI_COMPATIBLE_MODELS`
- Ark 与其他模型渠道：`ARK_API_KEY`、`MEIAO_SPIDER_API_KEY`、`MEIAO_SPIDER_GATEWAY_URL`
- Golden 去字幕：`GOLDEN_SUBTITLE_API_TOKEN`、`MEIAO_SUBTITLE_REMOVAL_BASE_URL`
- Gemini 视频与托管图片 COS：`MEIAO_COS_SECRET_ID`、`MEIAO_COS_SECRET_KEY`、`MEIAO_COS_BUCKET`、`MEIAO_COS_REGION`、`MEIAO_IMAGE_COS_SECRET_ID`、`MEIAO_IMAGE_COS_SECRET_KEY`、`MEIAO_IMAGE_COS_BUCKET`、`MEIAO_IMAGE_COS_REGION`

COS 凭据属于高权限存储凭据。导入器必须在导入摘要中单独提示其风险，但不能打印值。长期方案应给朋友使用独立的最小权限 CAM 子账号；本次包只按用户明确授权导入现有配置。

### 永远禁止进入朋友密钥包

- 生产数据库地址、用户名、密码和库名
- SSH 私钥、服务器登录信息和 GitHub 凭据
- 生产管理员密码、会话密钥和账号数据
- `MEIAO_MANAGED_ASSET_ACCESS_SECRET` 及其 previous secret
- 任何没有进入明确 allowlist 的环境变量

朋友本地的数据库密码、管理员密码和素材访问 secret 由本地配置流程生成或由朋友自行设置，不从生产环境复制。

## 方案结构

### 1. 公开仓库中的一键导入器

新增 `scripts/import-secret-bundle.mjs`，并在 `package.json` 暴露：

```bash
npm run secrets:import -- /absolute/path/.env.meiao.friend
```

导入器负责：

1. 读取仓库外的 `.env.meiao.friend`。
2. 按固定 allowlist 校验键；遇到数据库、SSH、管理员或未知键立即失败，不做部分写入。
3. 要求密钥包至少包含一个 provider 凭据；逐项校验所有已提供的敏感值不为空，拒绝示例值、占位值和明显的截断值。未提供的能力只记录为缺失，不擅自补默认密钥。
4. 以 `.env.server.example` 为基础，合并朋友本地已有 `.env.server` 和密钥包中的允许项。
5. 覆盖前创建不含于 Git 的时间戳备份；使用临时文件加原子 rename 写入 `.env.server`。
6. 在支持 POSIX 权限的平台把目标文件设为 `0600`。
7. 输出已导入的变量名、缺失能力和下一步命令，但永不输出变量值、哈希或可逆摘要。

默认不覆盖已有的非空敏感值；用户显式传入 `--force` 才允许覆盖。导入失败时原文件保持不变。

### 2. 仓库外的机器可读密钥包

密钥包文件名固定为 `.env.meiao.friend`，格式为标准 dotenv：

```dotenv
KIE_API_KEY=<private-value>
MAXFORAI_API_KEY=<private-value>
```

实际文件只能生成在 Git 工作区外，权限设为 `0600`。生成过程从云上 `.env.server` 读取 allowlist 中的非空键，不读取或复制禁止项；命令与结果只打印键名和文件路径。

该文件是明文敏感文件，便于朋友的 AI 直接读取和导入。用户必须通过私密渠道发送，不能上传网盘公开链接、聊天群或 Git。朋友导入后应删除传输副本或存入自己的密码管理器。

### 3. AI 可读的安装契约

新增 `docs/friend-secret-setup.md`，使用确定性步骤说明：

1. 克隆默认 `main`。
2. 安装 Node 依赖。
3. 把收到的 `.env.meiao.friend` 保持在仓库外。
4. 执行 `npm run secrets:import -- <absolute-path>`。
5. 执行配置检查；缺少 MySQL、Temporal、FFmpeg 或本地管理员配置时，明确列出缺项。
6. 不得读取后把密钥复制进聊天、日志、Issue、提交信息或 Git 文件。

文档必须明确：密钥包只解决服务凭据导入，不负责安装 MySQL、Temporal 或 FFmpeg；完整本地运行仍需按现有项目文档准备基础设施。

## 已泄露密钥的轮换

历史净化前先完成 provider 密钥轮换：

1. 在 provider 后台创建新 key，不在终端或对话中输出。
2. 备份云上 `.env.server`，只替换 `OPENAI_COMPATIBLE_API_KEY`。
3. 正常重启服务并验证 `/api/health`、worker、模型连接测试和一条不产生付费任务的鉴权探针。
4. 确认新 key 生效后撤销旧 key。
5. 朋友密钥包只能写入新 key，禁止复制已公开的旧 key。

如果无法在 provider 后台创建和撤销 key，流程必须停在“待轮换”，不得生成最终朋友密钥包，也不得把旧 key 当作安全凭据继续分发。

## Git 当前树与完整历史净化

在独立镜像仓库中执行历史重写，避免把工作仓库的忽略文件或生产配置带入操作：

1. 当前文档中的真实值替换为 `sk-xxxx`。
2. 对所有本地与远端分支、所有标签执行精确 literal replacement；替换器从本地受限输入读取旧值，任何输出都只显示规则名和命中数量。
3. 用完整历史扫描验证旧 key 的 SHA-256 指纹命中数为 0，并运行常见 provider token、私钥头、credential URL 和高熵敏感赋值检测。
4. 先推送净化后的 `main` 与实际发布分支，再强制更新其余分支和标签；禁止使用会删除不相关分支的镜像推送参数。
5. 从 GitHub 重新克隆一份干净仓库，再次扫描全部 refs。
6. 原 Git 历史的提交哈希将全部改变；现有协作者必须重新克隆，不能把旧分支合并回新历史。

历史重写不能让已经被第三方复制的密钥恢复安全，因此它不能替代 provider 侧轮换。

## 防复发门禁

新增 `scripts/check-tracked-secrets.mjs` 及测试，并把 `npm run security:secrets` 接入 `npm run verify`。扫描范围为 Git 跟踪文件，至少覆盖：

- PEM 私钥头
- AWS、腾讯云、Google、GitHub、Slack 和常见 `sk-` token 形态
- 含凭据的数据库 URL
- `apiKey`、`secret`、`token`、`password` 等字段后的高熵字面量

测试专用 token 必须使用统一、明显不可用的占位格式，并在代码中按精确路径与精确值 allowlist；禁止用宽泛目录排除。真实候选出现时命令只报告文件、行号、规则和长度，不报告值。

`.gitignore` 继续覆盖 `.env`、`.env.*`，并新增密钥包的显式规则和注释。导入器启动时还要调用 `git check-ignore`；如果输入包位于仓库内且没有被忽略，必须拒绝继续。

## 错误处理与回滚

- 导入器：校验、备份或原子写入任一步失败都不改变原 `.env.server`。
- 云上 key 切换：保留受限备份；新 key 验证失败时恢复旧环境文件并重启，但由于旧 key 已公开，只允许短时回滚以恢复服务，随后必须继续轮换。
- Git 历史重写：推送前保存不含工作区密钥文件的本地引用清单和提交映射；不得制作可再次上传的含密钥 Git bundle。
- 强制推送失败时停止，不删除远端分支；修正权限或分支保护后从同一净化镜像继续。

## 验收标准

1. 云上使用新 `OPENAI_COMPATIBLE_API_KEY`，旧 key 已撤销。
2. 新克隆的 GitHub `main`、发布分支、其他远端分支和全部标签中，旧 key 指纹命中数为 0。
3. 当前跟踪文件和完整历史扫描没有未处置的真实凭据命中。
4. `npm run security:secrets`、导入器测试、`npm run verify` 全部通过。
5. `.env.meiao.friend` 位于仓库外、权限为 `0600`，只含 allowlist 键且不含禁止项。
6. 在干净克隆中执行一键导入后，`.env.server` 正确生成、备份和权限行为符合契约，终端输出没有密钥值。
7. 云上 API、worker 和已启用 provider 的非付费连接检查通过。
8. GitHub 默认分支仍为 `main`，朋友重新克隆后可按 `docs/friend-secret-setup.md` 完成配置。
