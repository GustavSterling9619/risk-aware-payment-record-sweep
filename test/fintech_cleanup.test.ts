import assert from "node:assert/strict";
import test from "node:test";
import { decidePaymentCleanup, type PaymentEvent } from "../src/fintech_cleanup.js";

test("deletes only stale low-risk payment records without a hold or dispute", () => {
  const events: PaymentEvent[] = [
    payment("pay-old", "2026-06-01T00:00:00.000Z"),
    payment("pay-recent", "2026-09-10T00:00:00.000Z"),
    payment("pay-risk", "2026-05-01T00:00:00.000Z", { riskLevel: "high" }),
    payment("pay-held", "2026-04-01T00:00:00.000Z", { legalHold: true }),
    payment("pay-disputed", "2026-03-01T00:00:00.000Z", { state: "disputed" })
  ];

  const result = decidePaymentCleanup(events, new Date("2026-09-17T03:00:00.000Z"), 90);

  assert.deepEqual(result.deleteKeys, ["payments/pay-old.json"]);
  assert.deepEqual(
    result.notices.map(({ paymentId, action, reason }) => ({ paymentId, action, reason })),
    [
      { paymentId: "pay-old", action: "delete", reason: "stale-low-risk" },
      { paymentId: "pay-recent", action: "retain", reason: "recent" },
      { paymentId: "pay-risk", action: "retain", reason: "risk-review" },
      { paymentId: "pay-held", action: "retain", reason: "legal-hold" },
      { paymentId: "pay-disputed", action: "retain", reason: "open-dispute" }
    ]
  );
});

function payment(
  paymentId: string,
  occurredAt: string,
  overrides: Partial<PaymentEvent> = {}
): PaymentEvent {
  return {
    paymentId,
    objectKey: `payments/${paymentId}.json`,
    occurredAt,
    state: "settled",
    riskLevel: "low",
    legalHold: false,
    ...overrides
  };
}
