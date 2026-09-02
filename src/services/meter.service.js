import pool from "../db/pool.js";

const USAGE_LIMIT_COLUMNS = {
  api_call: "api_call_limit",
  ai_token: "ai_token_limit",
};

export async function recordUsage({
  tenantId,
  usageType,
  quantity,
  idempotencyKey,
}) {
  const limitColumn = USAGE_LIMIT_COLUMNS[usageType];

  if (!limitColumn) {
    throw new Error("Unsupported usage type");
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive integer");
  }

  if (!idempotencyKey?.trim()) {
    throw new Error("Idempotency key is required");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingResult = await client.query(
      `
        SELECT
          id,
          tenant_id,
          usage_type,
          quantity,
          idempotency_key,
          created_at
        FROM usage_events
        WHERE tenant_id = $1
          AND idempotency_key = $2
        FOR UPDATE;
      `,
      [tenantId, idempotencyKey],
    );

    if (existingResult.rowCount > 0) {
      await client.query("COMMIT");

      return {
        event: existingResult.rows[0],
        duplicate: true,
      };
    }

    const subscriptionResult = await client.query(
      `
        SELECT
          s.tenant_id,
          s.plan_id,
          p.${limitColumn} AS usage_limit
        FROM subscriptions s
        JOIN plans p ON p.id = s.plan_id
        WHERE s.tenant_id = $1
          AND s.status IN ('active', 'trialing')
        FOR UPDATE OF s;
      `,
      [tenantId],
    );

    if (subscriptionResult.rowCount === 0) {
      throw new Error("Active subscription not found");
    }

    const { usage_limit: usageLimit } = subscriptionResult.rows[0];

    const usageResult = await client.query(
      `
        SELECT COALESCE(SUM(quantity), 0)::BIGINT AS current_usage
        FROM usage_events
        WHERE tenant_id = $1
          AND usage_type = $2
          AND created_at >= date_trunc('month', NOW());
      `,
      [tenantId, usageType],
    );

    const currentUsage = Number(usageResult.rows[0].current_usage);
    const limit = Number(usageLimit);

    if (currentUsage + quantity > limit) {
      const error = new Error("Usage quota exceeded");
      error.code = "QUOTA_EXCEEDED";
      error.currentUsage = currentUsage;
      error.requestedQuantity = quantity;
      error.limit = limit;
      throw error;
    }

    const insertResult = await client.query(
      `
        INSERT INTO usage_events (
          tenant_id,
          usage_type,
          quantity,
          idempotency_key
        )
        VALUES ($1, $2, $3, $4)
        RETURNING
          id,
          tenant_id,
          usage_type,
          quantity,
          idempotency_key,
          created_at;
      `,
      [tenantId, usageType, quantity, idempotencyKey],
    );

    await client.query("COMMIT");

    return {
      event: insertResult.rows[0],
      duplicate: false,
    };
  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "23505") {
      const duplicateResult = await client.query(
        `
          SELECT
            id,
            tenant_id,
            usage_type,
            quantity,
            idempotency_key,
            created_at
          FROM usage_events
          WHERE tenant_id = $1
            AND idempotency_key = $2;
        `,
        [tenantId, idempotencyKey],
      );

      if (duplicateResult.rowCount > 0) {
        return {
          event: duplicateResult.rows[0],
          duplicate: true,
        };
      }
    }

    throw error;
  } finally {
    client.release();
  }
}