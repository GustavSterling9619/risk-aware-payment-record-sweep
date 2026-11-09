import { z } from "zod";

export const paymentEventSchema = z.object({
  paymentId: z.string().min(1),
  objectKey: z.string().min(1),
  occurredAt: z.iso.datetime(),
  state: z.enum(["settled", "refunded", "disputed"]),
  riskLevel: z.enum(["low", "high"]),
  legalHold: z.boolean()
});

export type PaymentEvent = z.infer<typeof paymentEventSchema>;

export type CleanupNotice = {
  paymentId: string;
  objectKey: string;
  action: "delete" | "retain";
  reason: "stale-low-risk" | "recent" | "risk-review" | "legal-hold" | "open-dispute";
};

export type CleanupDecision = {
  cutoff: string;
  deleteKeys: string[];
  notices: CleanupNotice[];
};

export function decidePaymentCleanup(
  events: PaymentEvent[],
  now: Date,
  retentionDays: number
): CleanupDecision {
  const cutoffDate = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1_000);
  const notices = events.map((event): CleanupNotice => {
    if (event.legalHold) return notice(event, "retain", "legal-hold");
    if (event.state === "disputed") return notice(event, "retain", "open-dispute");
    if (event.riskLevel === "high") return notice(event, "retain", "risk-review");
    if (new Date(event.occurredAt) >= cutoffDate) return notice(event, "retain", "recent");
    return notice(event, "delete", "stale-low-risk");
  });

  return {
    cutoff: cutoffDate.toISOString(),
    deleteKeys: notices.filter((item) => item.action === "delete").map((item) => item.objectKey),
    notices
  };
}

function notice(
  event: PaymentEvent,
  action: CleanupNotice["action"],
  reason: CleanupNotice["reason"]
): CleanupNotice {
  return { paymentId: event.paymentId, objectKey: event.objectKey, action, reason };
}
