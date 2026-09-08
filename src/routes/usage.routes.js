import { Router } from "express";
import pool from "../db/pool.js";

const router = Router();

router.get("/usage", async (req, res) => {
  const tenantId = req.header("X-Tenant-Id");

  if (!tenantId) {
    return res.status(400).json({
      error: "X-Tenant-Id header is required",
    });
  }

  try {
    const result = await pool.query(
      `
        SELECT
          p.name AS plan,
          p.api_call_limit,
          p.ai_token_limit,
          COALESCE(
            SUM(
              CASE
                WHEN ue.usage_type = 'api_call'
                THEN ue.quantity
                ELSE 0
              END
            ),
            0
          )::BIGINT AS api_calls_used,
          COALESCE(
            SUM(
              CASE
                WHEN ue.usage_type = 'ai_token'
                THEN ue.quantity
                ELSE 0
              END
            ),
            0
          )::BIGINT AS ai_tokens_used,
          COALESCE(SUM(ue.cost_micro_units), 0)::BIGINT AS cost_micro_units
        FROM subscriptions s
        JOIN plans p ON p.id = s.plan_id
        LEFT JOIN usage_events ue
          ON ue.tenant_id = s.tenant_id
          AND ue.created_at >= date_trunc('month', NOW())
        WHERE s.tenant_id = $1
        GROUP BY
          p.name,
          p.api_call_limit,
          p.ai_token_limit;
      `,
      [tenantId],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Tenant subscription not found",
      });
    }

    const row = result.rows[0];

    return res.json({
      plan: row.plan,
      period: {
        start: new Date(
          new Date().getFullYear(),
          new Date().getMonth(),
          1,
        ).toISOString(),
      },
      api_calls: {
        used: Number(row.api_calls_used),
        limit: Number(row.api_call_limit),
      },
      ai_tokens: {
        used: Number(row.ai_tokens_used),
        limit: Number(row.ai_token_limit),
      },
      cost: {
        micro_units: Number(row.cost_micro_units),
      },
    });
  } catch (error) {
    console.error("Usage request failed:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

export default router;