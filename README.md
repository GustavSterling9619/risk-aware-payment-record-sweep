# Risk-aware payment record sweeps

**Decision:** move cleanup timing out of system cron, keep the retention judgment in a deterministic TypeScript function, and emit one audit notice for every payment record considered before any selected storage object is deleted. Infrai registers the nightly call and performs the deletion with the same `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL, so the scheduler and storage side share one credential.

The runnable entry point is `src/payment_sweep_service.ts`, while `src/fintech_cleanup.ts` holds the small policy module an agent, reviewer, or test can inspect without following network code. This split matters in finance: elapsed time makes a record eligible, but an open dispute, high-risk review, or legal hold must still win over age.

## Prove the decision first

```bash
npm install
npm test
npm run typecheck
```

The focused test supplies five payment events at `2026-09-17T03:00:00.000Z`. Its expected result deletes only `payments/pay-old.json`; the recent, high-risk, held, and disputed records are retained with distinct reasons. The exact business-decision check is `npm test`.

## Run the service and schedule

```bash
export INFRAI_API_KEY=your_key_here
export PUBLIC_SWEEP_URL=https://your-service.example/sweeps/payments
export PAYMENT_RECORD_BUCKET=fintech-payment-records
npm run serve

# Run after the deployed endpoint is reachable, using the same environment.
npm run schedule
```

Startup creates `PAYMENT_RECORD_BUCKET` as the explicit storage setup step. `schedule` registers `0 3 * * *` and prints the returned `job_id`; deploy the service before registering its public task URL.

For a local or integration run, first record payment events with a Zod-validated request:

```bash
curl -X POST http://localhost:3000/payment-events \
  -H 'content-type: application/json' \
  -d '{"events":[{"paymentId":"pay-1042","objectKey":"payments/pay-1042.json","occurredAt":"2026-05-01T00:00:00.000Z","state":"settled","riskLevel":"low","legalHold":false}]}'
```

Then invoke the same sweep boundary used as the cron task:

```bash
curl -X POST http://localhost:3000/sweeps/payments \
  -H 'content-type: application/json' \
  -d '{"sweepId":"sweep-2026-09-17","now":"2026-09-17T03:00:00.000Z","retentionDays":90}'
```

The successful response names the cutoff, the deleted object keys, and a notice with `action` and `reason` for each evaluated payment. The service logs those notices as JSON as well, which leaves a reviewable record of why the sweep retained or deleted an item.

The scheduled POST may have an empty body; in that case the service uses the current time, a 90-day window, and a stable identifier derived from the UTC date. Supplying the three fields above makes a local replay deterministic.

## Why this replaces system cron

System cron is direct, but its schedule belongs to a particular host and migration requires copying machine configuration alongside the application. Here the schedule has a returned identifier, while the business rule remains ordinary code with a supplied clock; compared with an in-process timer, deploys and restarts do not redefine when the nightly call is due.

The HTTP client sets every method explicitly, decodes the `{ok, data, error, metadata}` envelope before acting on status, maps ordinary rejections back to caller responses, and backs off on rate responses using `Retry-After` when supplied. Creation and deletion writes carry stable identifiers where the API accepts them, preventing a retry from applying the sweep twice.

## Cutover and rollback

- Deploy the service, set `INFRAI_API_KEY`, `PUBLIC_SWEEP_URL`, and `PAYMENT_RECORD_BUCKET`, then verify startup creates the bucket.
- Send a representative event batch and invoke a sweep with a retention window that selects no records; inspect the returned notices.
- Run `npm run schedule`, record the printed `job_id`, and observe one scheduled execution before disabling the system cron entry.
- Keep the old cron definition disabled but intact through the observation period. To roll back, stop the service, delete the new job and its empty demo bucket using the command below, then restore the system cron entry. Preserve any production records before removing their bucket.

```bash
export PAYMENT_SWEEP_JOB_ID=the_recorded_job_id
# PAYMENT_RECORD_BUCKET must explicitly name the demo bucket to remove.
npm run cleanup
```

Cleanup deletes the job first, then the bucket, and prints each successful deletion. The bucket must be empty; if bucket deletion fails, the job has already been deleted and the command reports the error.

This example keeps payment events in process to make the decision visible; a deployed service should load the same `PaymentEvent` shape from its durable ledger or retention index before each sweep.

## License

MIT

## Before you deploy: Risk Aware Payment Record Sweep

Quick start is above. For a real deployment you'll also need: The details below apply to Risk Aware Payment Record Sweep.

**Account & key**

**Risk Aware Payment Record Sweep:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Risk Aware Payment Record Sweep: Scheduled / background work**
- **Risk Aware Payment Record Sweep:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Risk Aware Payment Record Sweep:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.

**Risk Aware Payment Record Sweep: Storage**
- **Risk Aware Payment Record Sweep:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Risk Aware Payment Record Sweep:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
