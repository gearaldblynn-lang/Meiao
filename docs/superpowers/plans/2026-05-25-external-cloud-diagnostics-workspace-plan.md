# External Cloud Diagnostics Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a usable external local diagnostics workspace that pulls Tencent Cloud logs, summarizes daily cloud errors, renders a local dashboard, and highlights issues that reappear after being marked fixed.

**Architecture:** The workspace is outside the business app at `/Users/feiyanglin/程序开发/电商视觉一键化/云上日志诊断看板`. It uses plain Node.js ESM scripts, local JSON files, Markdown reports, and a generated static HTML dashboard that can be opened directly from disk.

**Tech Stack:** Node.js built-ins only (`node:test`, `fs`, `path`, `crypto`, `child_process`), SSH to Tencent Cloud, remote Node/MySQL export through the cloud project's existing `mysql2` dependency.

---

### Task 1: Workspace Skeleton And Core Tests

**Files:**
- Create: `/Users/feiyanglin/程序开发/电商视觉一键化/云上日志诊断看板/package.json`
- Create: `/Users/feiyanglin/程序开发/电商视觉一键化/云上日志诊断看板/README.md`
- Create: `/Users/feiyanglin/程序开发/电商视觉一键化/云上日志诊断看板/tests/diagnostics.test.mjs`

- [ ] **Step 1: Create folders and package metadata.**
- [ ] **Step 2: Write failing tests for fingerprint grouping and fixed-after-reappeared detection.**
- [ ] **Step 3: Run `node --test tests/diagnostics.test.mjs` and confirm the missing module failure.**

### Task 2: Core Analyzer

**Files:**
- Create: `/Users/feiyanglin/程序开发/电商视觉一键化/云上日志诊断看板/scripts/lib/diagnostics-core.mjs`
- Create: `/Users/feiyanglin/程序开发/电商视觉一键化/云上日志诊断看板/scripts/analyze-daily.mjs`

- [ ] **Step 1: Implement date-window calculation, event extraction, message normalization, fingerprints, severity, category, and recurrence detection.**
- [ ] **Step 2: Run the diagnostics tests and confirm they pass.**
- [ ] **Step 3: Add CLI analysis from `raw/YYYY-MM-DD/` to `data/runs/YYYY-MM-DD.json`.**

### Task 3: Reports And Static Dashboard

**Files:**
- Create: `/Users/feiyanglin/程序开发/电商视觉一键化/云上日志诊断看板/scripts/generate-dashboard.mjs`
- Create generated output: `/Users/feiyanglin/程序开发/电商视觉一键化/云上日志诊断看板/dashboard/index.html`
- Create generated output: `/Users/feiyanglin/程序开发/电商视觉一键化/云上日志诊断看板/reports/YYYY-MM-DD-daily-report.md`

- [ ] **Step 1: Generate Markdown daily reports from run JSON.**
- [ ] **Step 2: Generate a self-contained static HTML dashboard with a dedicated "修复后复发重点关注" section.**
- [ ] **Step 3: Verify dashboard generation using fixture data.**

### Task 4: Cloud Pull And Daily Runner

**Files:**
- Create: `/Users/feiyanglin/程序开发/电商视觉一键化/云上日志诊断看板/config/cloud.json`
- Create: `/Users/feiyanglin/程序开发/电商视觉一键化/云上日志诊断看板/scripts/pull-cloud-logs.mjs`
- Create: `/Users/feiyanglin/程序开发/电商视觉一键化/云上日志诊断看板/scripts/run-daily.mjs`
- Create: `/Users/feiyanglin/程序开发/电商视觉一键化/云上日志诊断看板/scripts/mark-fixed.mjs`

- [ ] **Step 1: Add config for SSH host, key path, remote project path, and PM2 process name.**
- [ ] **Step 2: Implement remote pull into `raw/YYYY-MM-DD/`.**
- [ ] **Step 3: Implement one-command daily runner: pull, analyze, generate dashboard.**
- [ ] **Step 4: Implement mark-fixed script to record a fingerprint as fixed/deployed/closed so future reappearance is highlighted.**

### Task 5: Verification And Usage Notes

**Files:**
- Modify: `/Users/feiyanglin/程序开发/电商视觉一键化/云上日志诊断看板/README.md`

- [ ] **Step 1: Run `node --test`.**
- [ ] **Step 2: Run a fixture/sample daily analysis and dashboard generation.**
- [ ] **Step 3: Document daily usage, manual backfill, and fixed issue marking.**

