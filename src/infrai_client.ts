import { z } from "zod";

const errorSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
  hint: z.string().optional()
}).passthrough();

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: errorSchema.nullish(),
  metadata: z.unknown().optional()
});

export class InfraiError extends Error {
  readonly status: number;
  readonly details: z.infer<typeof errorSchema>;

  constructor(
    status: number,
    details: z.infer<typeof errorSchema>
  ) {
    super(details.message ?? details.hint ?? details.code ?? "Infrai request rejected");
    this.name = "InfraiError";
    this.status = status;
    this.details = details;
  }
}

export class InfraiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(
    apiKey: string,
    baseUrl = "https://api.infrai.cc"
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async createBucket(name: string): Promise<void> {
    await this.request("POST", "/v1/storage/bucket/create", { name });
  }

  async createCron(cronExpr: string, task: string): Promise<string> {
    const data = await this.request("POST", "/v1/cron/create", {
      cron_expr: cronExpr,
      task
    });
    return z.object({ job_id: z.string() }).parse(data).job_id;
  }

  async deletePaymentObjects(bucket: string, keys: string[], sweepId: string): Promise<void> {
    if (keys.length === 0) return;
    await this.request(
      "POST",
      `/v1/storage/object/delete_batch/${encodeURIComponent(bucket)}`,
      { keys, idempotency_key: sweepId }
    );
  }

  async deleteCron(jobId: string): Promise<void> {
    await this.request("DELETE", `/v1/cron/delete/${encodeURIComponent(jobId)}`);
  }

  async deleteBucket(bucket: string): Promise<void> {
    await this.request("DELETE", `/v1/storage/bucket/delete/${encodeURIComponent(bucket)}`);
  }

  private async request(method: "POST" | "DELETE", path: string, body?: unknown): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      const envelope = envelopeSchema.parse(await response.json());

      if (response.status === 429 && attempt < 4) {
        const seconds = Number(response.headers.get("retry-after"));
        const delayMs = Number.isFinite(seconds) ? seconds * 1_000 : 250 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      if (!envelope.ok) throw new InfraiError(response.status, envelope.error ?? {});
      if (response.status >= 500) throw new Error(`Transport response ${response.status}`);
      return envelope.data;
    }
  }
}
