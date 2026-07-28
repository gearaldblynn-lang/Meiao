# Task 4 Report: 004/005 幂等数据导入器

## 状态

- 已实现 `scripts/import-virtual-model-library-data.mjs` 与 package script `import:virtual-model-library`。
- 默认和未指定模式时均为 dry-run；只有显式 `--local` / `--mysql` 才进入对应目标。
- 本任务没有运行真实 `--local` 或 `--mysql`，没有修改任何现有 data 文件。

## 安全合同

- 导入前交叉校验 `assets.sha256.json`、`checksums.sha256`、`catalog.csv` 和全部 80 个文件的存在性、大小、SHA-256；任一失败时目标零写。
- 001–003 只做稳定 ID 基线审计，不新增、不覆盖；同 ID 内容漂移输出 warning。004/005 只插入缺失稳定 ID；活动 code 同名异 ID fail closed。
- public URL 全部按目标 `--public-base-url` 重建为 `/api/assets/file/<id>/<encoded originalName>`，不沿用包中的 `127.0.0.1`。
- local 要求显式 target root 或 store/registry/assets 路径；写前创建时间戳备份，文件先 staging + checksum，目标同路径同 hash 跳过、不同 hash 拒绝；两份 JSON 使用临时文件原子 rename，失败恢复原内容并清理本次新文件。
- MySQL 使用现有 `mysql2` 和表名，在单 transaction 内插入 `virtual_models`、`virtual_model_versions`、`virtual_model_assets`、`stored_assets`；文件先隐藏 staging 并复验，事务失败 rollback 且清理本次目标文件/stage。
- CLI 不读取 `.env.server` 或环境变量中的数据库密码，也不打印连接参数；MySQL 目标必须显式传权限为 `0600`（或更严格）的 `--mysql-config-file`，避免把密码暴露在进程参数或 shell 历史中。

## TDD 证据

- RED：测试先落地后运行，按预期以 `ERR_MODULE_NOT_FOUND` 失败。
- GREEN：`node --test scripts/import-virtual-model-library-data.test.mjs`，11/11 通过。
- 覆盖：默认 dry-run、80 文件三清单校验、checksum 失败零写、活动 code 冲突、同 ID 不覆盖、001–003 漂移 warning、首次/二次 local、local JSON 回滚、URL 重写、MySQL commit/rollback。

## 验证

- `node --test scripts/import-virtual-model-library-data.test.mjs`：11 passed，0 failed。
- `npm run test:scripts`：23 个 scripts 测试文件通过。
- 真实包默认 dry-run：80 文件通过校验，摘要为新增 2 models、2 versions、16 relations、32 registry、32 files，warnings 为空。
- `npm run lint`：0 errors；656 个既有预算内 warnings（预算 660）。
- `npm run build`：通过；保留既有 translation/agent-center/video circular chunk warnings。
- `node --check scripts/import-virtual-model-library-data.mjs`、`git diff --check`：通过。
- Hermes Harness：bridge OK，无命中高风险重复问题门禁。

## 剩余关注

- 真实 local/MySQL 写入依用户红线未执行；正式导入前仍需先对目标路径/数据库和 `--public-base-url` 做 dry-run，核对机器摘要后再单独授权写入。
- MySQL 素材目录必须是服务实际读取的 `server/data/assets`（或等价部署路径）；导入器不会猜测生产路径。
