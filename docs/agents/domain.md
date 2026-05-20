# Domain Docs

梅奥项目是单上下文项目。Agent 进入项目后，先读项目入口文档，再按任务范围读相关模块文档。

## Before Exploring

Read these first:

- `AGENTS.md`
- `项目交接上下文.md`
- `docs/project-overview.md`
- `CONTEXT.md`
- `docs/agents/repeated-issues.md`

Then read task-specific docs:

- Prompt changes: `docs/prompt-rtcfe-migration-map.md`
- One-click generation: `docs/one-click-prompt-code-boundary-guide.md`, `docs/one-click-first-main-prompt-requirements.md`
- Deployment: `docs/tencent-cloud-deploy.md`, `docs/release-and-handoff.md`
- Queue/provider issues: `docs/server-queue-acceptance.md`, related server tests
- Architecture decisions: relevant files under `docs/adr/`, if present

## Use Project Vocabulary

When writing plans, issues, tests, commit notes, or architecture reviews, use the terms from `CONTEXT.md`.

If a term is unclear, pause and clarify it instead of inventing synonyms. Stable vocabulary matters because this project has many similar concepts: first image, main image, detail page, SKU, product retouch, buyer show, short video, and Xiaohongshu cover are different workflows.

## Environment Rule

Always name the target environment:

- Cloud production: Tencent Cloud `/www/wwwroot/meiao-internal`
- Local development: this repo, usually `npm run local`
- Local backup/version folder: a saved copy under `版本管理`
- GitHub: version storage and comparison only

Do not say a fix is complete for cloud production unless cloud state has been checked or the user only asked for local work.
