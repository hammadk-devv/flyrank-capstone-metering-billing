import { describe, expect, it } from "vitest";
import pool from "../src/db/pool.js";
import { recordUsage } from "../src/services/meter.service.js";

const TENANT_ID = "00000000-0000-4000-8000-000000000001";

describe("recordUsage", () => {
  it("records usage exactly once for the same idempotency key", async () => {
    const key = `test-idempotency-${Date.now()}`;

    const first = await recordUsage({
      tenantId: TENANT_ID,
      usageType: "ai_token",
      quantity: 100,
      idempotencyKey: key,
      inputTokens: 50,
      cachedInputTokens: 10,
      outputTokens: 40,
      reasoningTokens: 10,
    });

    const second = await recordUsage({
      tenantId: TENANT_ID,
      usageType: "ai_token",
      quantity: 100,
      idempotencyKey: key,
      inputTokens: 50,
      cachedInputTokens: 10,
      outputTokens: 40,
      reasoningTokens: 10,
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.event.id).toBe(first.event.id);

    const result = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM usage_events
        WHERE tenant_id = $1
          AND idempotency_key = $2;
      `,
      [TENANT_ID, key],
    );

    expect(result.rows[0].count).toBe(1);
  });

  it("rejects usage when the monthly quota is exceeded", async () => {
    const key = `test-quota-${Date.now()}`;

    await expect(
      recordUsage({
        tenantId: TENANT_ID,
        usageType: "ai_token",
        quantity: 10000000,
        idempotencyKey: key,
        inputTokens: 10000000,
      }),
    ).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
    });
  });
});