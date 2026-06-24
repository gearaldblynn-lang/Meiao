# Account Credit Limits Design

## Goal

Build account-level credit limits for external testing accounts while keeping company accounts unlimited. Every generation path must be blocked when a limited account has no available credit, and successful work must settle against real KIE/provider `creditsConsumed` whenever that value is available.

## Product Rules

- Admins can mark an account as unlimited or limited.
- Unlimited accounts are never blocked by credits, but their real consumption is still recorded in logs and usage stats.
- Limited accounts have three visible numbers: balance, frozen credits, and lifetime consumed credits.
- Available credits are `balance - frozen`.
- Starting a generation reserves an estimated amount before the request enters the expensive provider path.
- Successful generation settles by real `creditsConsumed` from KIE/provider. If the provider does not return a valid value, the reserved estimate is used as the fallback settlement.
- Failed, cancelled, interrupted, or never-submitted work releases reserved credits.
- If real consumption is higher than the reserved estimate, the extra amount is deducted during settlement. The current task is allowed to finish; the balance can reach zero, and a ledger entry records the overage.
- If available credits are lower than the estimated reservation, the request is rejected with a clear `account_credit_insufficient` error before provider submission.
- Smart-agent image generation is part of the same system. Limited accounts with insufficient credits cannot use agent image generation; regular text chat should not consume image-generation credits unless a tool call actually generates images.

## Scope

Covered:
- Internal job queue submissions through `POST /api/jobs`.
- MySQL and local JSON job execution completion/failure/cancel paths.
- Smart-agent image generation in both MySQL chat handler and local JSON chat handler.
- Account management UI for creating/editing limited and unlimited accounts.
- User API types, current-user refresh, admin account list, logs, and usage diagnostics.
- Schema migration for MySQL and normalization for existing local JSON users.

Not covered:
- Public payment processing.
- Organization billing plans.
- Per-model pricing configuration UI.
- Retroactive billing migration for old jobs.

## Architecture

Create a small server-side credit ledger helper that owns normalization, reservation, release, and settlement. The existing job queue and agent chat handlers call that helper instead of duplicating arithmetic in route handlers.

For MySQL, credit state lives on `users` for fast account list display, with immutable entries in a new `account_credit_ledger` table for audit. For local JSON mode, the same shape is stored in each user object plus `accountCreditLedger` in `server/data/internal-store.json`.

The system uses optimistic fixed estimates at submission time and exact real consumption at terminal time. Estimates are conservative enough to stop uncontrolled external testing, while the final cost still follows provider truth.

## Data Model

User fields:
- `creditLimitMode`: `'unlimited' | 'limited'`
- `creditBalance`: number, non-negative decimal
- `creditReserved`: number, non-negative decimal
- `creditConsumed`: number, non-negative decimal lifetime total

Ledger entry fields:
- `id`
- `userId`
- `jobId` or `requestId`
- `module`
- `taskType`
- `provider`
- `action`: `reserve | release | settle | adjust`
- `amount`
- `balanceAfter`
- `reservedAfter`
- `reason`
- `meta`
- `createdAt`

MySQL columns:
- `users.credit_limit_mode VARCHAR(20) NOT NULL DEFAULT 'unlimited'`
- `users.credit_balance DECIMAL(12,2) NOT NULL DEFAULT 0`
- `users.credit_reserved DECIMAL(12,2) NOT NULL DEFAULT 0`
- `users.credit_consumed DECIMAL(12,2) NOT NULL DEFAULT 0`

MySQL table:
- `account_credit_ledger` with indexes on `user_id`, `job_id`, and `created_at`.

## Reservation Estimates

Estimates are centralized and intentionally simple:
- `kie_image`, `gpt_image`, `apiports_image`: estimate by requested output count, default 3 credits per image.
- `kie_chat` and analysis/planning tasks: default 1 credit.
- video tasks: default 5 credits.
- unknown provider generation task: default 1 credit.
- upload and internal maintenance tasks: 0 credits.

Estimates use payload hints such as `outputCount`, `imageCount`, `count`, `tasks.length`, or prompt plan counts when present. The helper clamps to at least 1 for generation tasks and supports environment overrides later without changing route logic.

## Job Queue Flow

1. User submits `POST /api/jobs`.
2. Server builds the scrubbed job payload.
3. Server checks whether a reusable active job already exists. Deduped jobs do not reserve again.
4. Server estimates required credits.
5. Limited accounts reserve credits atomically.
6. Job record is created with `creditReservation` metadata in payload or result-safe metadata.
7. On success, terminal job code settles reserved credits with `result.creditsConsumed` if valid, otherwise the reserved estimate.
8. On failure, cancellation, stale recovery, or retry exhaustion, terminal code releases remaining reserved credits.
9. Retries of the same job do not reserve again.

## Agent Image Flow

Agent chat can generate images without going through `/api/jobs`, so it gets an explicit reservation:

1. Before running the image-generation path, reserve an agent image estimate.
2. If the account lacks available credits, reject with `account_credit_insufficient`.
3. During tool execution, collect `creditsConsumed` from generated image results.
4. On successful assistant image response, settle with the sum of real image credits.
5. On provider/tool failure or cancellation, release reservation.
6. Non-image text chat is not blocked by this image-generation reservation.

Both MySQL and local JSON chat handlers must call the same policy helper. This avoids repeating the historical bug where MySQL and local handlers drift.

## API and UI

API:
- `AuthUser` includes `creditLimitMode`, `creditBalance`, `creditReserved`, `creditConsumed`, and computed `creditAvailable`.
- `POST /api/users` accepts initial credit mode and balance.
- `PATCH /api/users/:id` accepts credit mode and balance adjustments.
- The current user returned by login/me includes credit fields so normal users can see whether the account is limited.

UI:
- New account form includes an account credit mode selector.
- Limited accounts show an initial credit input.
- Account list shows credit state in one compact line.
- Expanded account controls allow switching limited/unlimited and setting balance.
- Staff read-only account panel shows available credits when limited.
- Insufficient-credit errors are shown as actionable messages, not generic failures.

## Logging and Diagnostics

- Every reserve, release, settle, and admin adjustment writes an account log entry with target user and amounts.
- Job logs include `creditReservationId`, `creditReserved`, `creditsSettled`, and `creditSettlementSource`.
- Usage stats continue to use existing `creditsConsumed` behavior for successful provider work.
- Ledger rows are retained with account data. Deleting a user deletes that user's ledger rows together with their other user data.

## Error Handling

- Insufficient credit uses code `account_credit_insufficient` and HTTP 402.
- The response message includes available and required credits.
- Credit helper failures before provider submission fail closed for limited accounts.
- Credit settlement failures after provider success are logged as errors but do not hide completed provider results; an admin can reconcile from ledger and job metadata.

## Tests

Server utility tests:
- Unlimited users do not reserve or block.
- Limited users reserve only when available credits are sufficient.
- Settlement uses real `creditsConsumed` over the estimate.
- Failure releases reserved credits.
- Over-estimate returns the difference.
- Under-estimate deducts the extra and clamps available credits at zero.

Route/source tests:
- MySQL and local `/api/jobs` paths both call reservation before creating a job.
- MySQL and local terminal paths both settle/release.
- MySQL and local agent chat paths both reserve for image generation.
- User API exposes credit fields.

Frontend tests:
- Account management renders credit fields and submits them in create/update payloads.
- Credit display formats unlimited and limited accounts correctly.

## Rollout

Existing users default to unlimited so no internal account is blocked on deploy. Admins can opt external testing users into limited mode and set their credit balance after the schema migration is live.
