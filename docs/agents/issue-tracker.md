# Issue tracker: Local Markdown

梅奥项目的真实工作流是：云上环境承载主要应用，本地环境用于开发、测试、排障和备份，GitHub 用作版本存储和备份。

因此，本项目默认不把 GitHub Issues 当作任务中枢。需要沉淀 PRD、拆票、排障记录、验收记录时，优先写本地 Markdown。

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The PRD is `.scratch/<feature-slug>/PRD.md`
- Implementation issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is recorded as a `Status:` line near the top of each issue file
- Comments and conversation history append to the bottom under `## Comments`

## Status Vocabulary

Use the canonical labels from `docs/agents/triage-labels.md`:

- `needs-triage`
- `needs-info`
- `ready-for-agent`
- `ready-for-human`
- `wontfix`

## When A Skill Says "Publish To The Issue Tracker"

Create or update files under `.scratch/<feature-slug>/`. Do not create GitHub issues unless the user explicitly asks.

## When A Skill Says "Fetch The Relevant Ticket"

Read the referenced Markdown file. The user will normally pass a path under `.scratch/`, `docs/superpowers/`, or `docs/`.

## Cloud/Local/GitHub Authority

When investigating behavior, do not infer cloud behavior from GitHub alone.

Check in this order:

1. User's stated environment: cloud, local dev, local backup, or GitHub.
2. Local working tree and current `git status`.
3. Running local services: `npm run doctor`, `http://localhost:3000`, `http://127.0.0.1:3100/api/health`.
4. Tencent Cloud server state, when the task is about production behavior.
5. GitHub remote, only for stored versions and comparison.
