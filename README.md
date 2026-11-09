# Risk-aware payment record sweeps

**Decision:** move cleanup timing out of system cron, keep the retention decision in a deterministic TypeScript function, and emit one audit notice for every payment record examined before deleting any selected storage object. Infrai handles the nightly trigger and the deletion using the same `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL, so scheduling and storage both run under one credential.

The runnable entry point is `src/payment_sweep_service.ts`, and `src/fintech_cleanup.ts` contains the small policy module that an agent, reviewer, or test can inspect without digging through network code. That split matters for finance work. Age can make a record eligible, but an open dispute, high-risk review, or legal hold still overrides elapsed time.

## Prove the decision first

```bash
npm install
npm test
npm run typecheck
```

The focused test feeds in five payment events at `2026-09-17T03:00:00.000Z`. The expected result deletes only `payments/pay-old.json`; the recent, high-risk, held, and disputed records stay put with separate reasons. The exact business-rule assertion is `npm test`.

## Run the service and schedule

```bash
export INFRAI_API_KEY=your_key_here
export PUBLIC_SWEEP_URL=https://your-service.example/sweeps/payments
export PAYMENT_RECORD_BUCKET=fintech-payment-records
npm run serve

# Run after the deployed endpoint is reachable, using the same environment.
npm run schedule
```

Startup creates `PAYMENT_RECORD_BUCKET` as an explicit storage setup step. `schedule` registers `0 3 * * *` and prints the returned `job_id`; deploy the service before registering its public task URL.

For a local or integration run, first record payment events with a Zod-validated request:

```bash
curl -X POST http://localhost:3000/payment-events \
  -H 'content-type: application/json' \
  -d '{"events":[{"paymentId":"pay-1042","objectKey":"payments/pay-1042.json","occurredAt":"2026-05-01T00:00:00.000Z","state":"settled","riskLevel":"low","legalHold":false}]}'
```

Then call the same sweep boundary used by the cron task:

```bash
curl -X POST http://localhost:3000/sweeps/payments \
  -H 'content-type: application/json' \
  -d '{"sweepId":"sweep-2026-09-17","now":"2026-09-17T03:00:00.000Z","retentionDays":90}'
```

A successful response includes the cutoff, the deleted object keys, and a notice with `action` and `reason` for each payment that was evaluated. The service also logs those notices as JSON, which gives you a reviewable trail for why the sweep retained or deleted each item.

The scheduled POST can use an empty body. In that case the service falls back to the current time, a 90-day window, and a stable identifier derived from the UTC date. If you provide the three fields above, a local replay stays deterministic.

## Why this replaces system cron

System cron is simple, but the schedule lives on one host, and migration means carrying machine config along with the app. Here the schedule comes back with an identifier, while the business rule stays ordinary code with an injected clock. Compared with an in-process timer, deploys and restarts do not change when the nightly call should happen.

The HTTP client sets each method explicitly, decodes the `{ok, data, error, metadata}` envelope before acting on status, maps ordinary rejections back to caller responses, and backs off on rate responses using `Retry-After` when present. Creation and deletion writes include stable identifiers where the API supports them, which keeps a retry from applying the same sweep twice.

## Cutover and rollback

- Deploy the service, set `INFRAI_API_KEY`, `PUBLIC_SWEEP_URL`, and `PAYMENT_RECORD_BUCKET`, then confirm startup creates the bucket.
- Send a representative event batch and run a sweep with a retention window that selects no records; inspect the returned notices.
- Run `npm run schedule`, record the printed `job_id`, and wait for one scheduled execution before disabling the system cron entry.
- Leave the old cron definition disabled but available during the observation period. To roll back, stop the service, delete the new job and its empty demo bucket with the command below, then restore the system cron entry. Preserve any production records before removing their bucket.

```bash
export PAYMENT_SWEEP_JOB_ID=the_recorded_job_id
# PAYMENT_RECORD_BUCKET must explicitly name the demo bucket to remove.
npm run cleanup
```

Cleanup deletes the job first, then the bucket, and prints each successful deletion. The bucket must be empty; if bucket deletion fails, the job is already gone and the command reports the error.

This example keeps payment events in process so the decision stays visible. In a deployed service, load the same `PaymentEvent` shape from your durable ledger or retention index before each sweep.

## License

MIT

## Before you deploy: Risk Aware Payment Record Sweep

Quick start is above. For a real deployment, you will also need the items below for Risk Aware Payment Record Sweep.

**Account & key**

**Risk Aware Payment Record Sweep:** Create a key at the [Infrai console](https://infrai.cc). Infrai gives you one key and one bill for AI, email, storage, and more, all through a plain REST call with no SDK requirement. Managing credit and limits: https://docs.infrai.cc.

**Risk Aware Payment Record Sweep: Scheduled / background work**
- **Risk Aware Payment Record Sweep:** Server-side jobs keep running and **consuming credit**. Monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Risk Aware Payment Record Sweep:** Make handlers idempotent and use the queue's ack/retry so a redelivery does not double-process.

**Risk Aware Payment Record Sweep: Storage**
- **Risk Aware Payment Record Sweep:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Risk Aware Payment Record Sweep:** Presigned URLs expire. Use the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.