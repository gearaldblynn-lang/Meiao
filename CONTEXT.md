# Project Context

This file defines the domain language for 梅奥 AI. Keep it as a glossary, not an implementation spec.

## 梅奥 AI

An internal ecommerce visual production tool for company users. It is not a public SaaS product. The main application runs on Tencent Cloud; local copies are used for development, testing, debugging, and backups.

## 一键主详

The workflow that generates ecommerce product visual assets across first image, main image, detail page, and SKU outputs. These sub-workflows are related, but each has separate prompt, parsing, and acceptance constraints.

## 首图

The first product image workflow inside 一键主详. It is not interchangeable with 主图 or 详情.

## 主图

The main product image workflow inside 一键主详. It is related to 首图 but has its own prompt and output expectations.

## 详情

The detail page workflow inside 一键主详. It usually has a stronger relationship to product selling points, layout, and multi-section presentation than single-image workflows.

## SKU

The SKU visual/text workflow inside 一键主详. Changes to SKU generation must preserve SKU-specific parsing and field requirements.

## Provider 网关

The server-side integration layer that routes model/provider calls such as KIE, Veo, Responses, and GPT Image. Provider behavior should be investigated through server logs, gateway tests, and request/response contracts.

## 任务队列

The asynchronous job flow that runs long model or asset operations. Queue issues should be debugged with deterministic local loops where possible, then checked against cloud logs when the symptom is production-only.

## 素材

User-uploaded or generated assets used by workflows. Asset changes must consider upload limits, references, cleanup, generated previews, and cloud/local path differences.

## 云上环境

The Tencent Cloud production-like internal deployment under `/www/wwwroot/meiao-internal`. This is the primary application environment for real use.

## 本地开发环境

The local repo used for implementation, testing, diagnosis, and backup verification. Local success does not automatically mean cloud success.

## GitHub 版本仓库

The remote repository used for version storage and comparison. It is not the default task tracker and is not proof of the running cloud state.
