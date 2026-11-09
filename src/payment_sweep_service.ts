import { createServer, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { decidePaymentCleanup, paymentEventSchema, type PaymentEvent } from "./fintech_cleanup.js";
import { InfraiClient, InfraiError } from "./infrai_client.js";

const ingestSchema = z.object({ events: z.array(paymentEventSchema).min(1).max(1_000) });
const sweepSchema = z.object({
  sweepId: z.string().min(1).optional(),
  now: z.iso.datetime().optional(),
  retentionDays: z.number().int().positive().max(3_650).default(90)
});

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY");

const bucket = process.env.PAYMENT_RECORD_BUCKET ?? "fintech-payment-records";
const client = new InfraiClient(apiKey);
const events = new Map<string, PaymentEvent>();

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "schedule") return schedule();
  if (command === "serve") return serve();
  if (command === "cleanup") return cleanup();
  throw new Error("Use the serve, schedule, or cleanup command");
}

async function schedule(): Promise<void> {
  const task = z.url().parse(process.env.PUBLIC_SWEEP_URL);
  const jobId = await client.createCron("0 3 * * *", task);
  console.log(JSON.stringify({ scheduled: true, jobId, task }));
}

async function cleanup(): Promise<void> {
  const jobId = z.string().min(1).parse(process.env.PAYMENT_SWEEP_JOB_ID);
  const cleanupBucket = z.string().min(1).parse(process.env.PAYMENT_RECORD_BUCKET);
  await client.deleteCron(jobId);
  console.log(JSON.stringify({ deletedJobId: jobId }));
  await client.deleteBucket(cleanupBucket);
  console.log(JSON.stringify({ deletedBucket: cleanupBucket }));
}

async function serve(): Promise<void> {
  await client.createBucket(bucket);
  const port = Number(process.env.PORT ?? 3000);
  createServer(async (request, response) => {
    try {
      if (request.method === "POST" && request.url === "/payment-events") {
        const input = ingestSchema.parse(await readJson(request));
        for (const event of input.events) events.set(event.paymentId, event);
        return json(response, 202, { accepted: input.events.length, stored: events.size });
      }
      if (request.method === "POST" && request.url === "/sweeps/payments") {
        const input = sweepSchema.parse(await readJson(request));
        const now = input.now ? new Date(input.now) : new Date();
        const sweepId = input.sweepId ?? `payment-sweep-${now.toISOString().slice(0, 10)}`;
        const decision = decidePaymentCleanup([...events.values()], now, input.retentionDays);
        for (const notice of decision.notices) {
          console.log(JSON.stringify({ sweepId, ...notice }));
        }
        await client.deletePaymentObjects(bucket, decision.deleteKeys, sweepId);
        for (const notice of decision.notices) {
          if (notice.action === "delete") events.delete(notice.paymentId);
        }
        return json(response, 200, { sweepId, ...decision });
      }
      return json(response, 404, { error: "route not found" });
    } catch (error) {
      if (error instanceof z.ZodError) return json(response, 400, { error: "invalid request", issues: error.issues });
      if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
        return json(response, error.status, { error: error.details });
      }
      console.error(error);
      return json(response, 503, { error: "request could not be completed", requestId: randomUUID() });
    }
  }).listen(port, () => console.log(`payment sweep listening on ${port}`));
}

async function readJson(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length === 0 ? {} : JSON.parse(text);
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

await main();
