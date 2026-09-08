import { Router } from "express";
import { z } from "zod";
import { recordUsage } from "../services/meter.service.js";

const router = Router();

const generateSchema = z.object({
  quantity: z.number().int().positive().default(1),
  inputTokens: z.number().int().nonnegative().default(0),
  cachedInputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  reasoningTokens: z.number().int().nonnegative().default(0),
});

router.post("/generate", async (req, res) => {
  const tenantId = req.header("X-Tenant-Id");
  const idempotencyKey = req.header("Idempotency-Key");

  if (!tenantId) {
    return res.status(400).json({
      error: "X-Tenant-Id header is required",
    });
  }

  if (!idempotencyKey) {
    return res.status(400).json({
      error: "Idempotency-Key header is required",
    });
  }

  const parsed = generateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
    });
  }

  try {
    const result = await recordUsage({
      tenantId,
      usageType: "ai_token",
      quantity:
        parsed.data.inputTokens +
        parsed.data.outputTokens +
        parsed.data.reasoningTokens,
      idempotencyKey,
      inputTokens: parsed.data.inputTokens,
      cachedInputTokens: parsed.data.cachedInputTokens,
      outputTokens: parsed.data.outputTokens,
      reasoningTokens: parsed.data.reasoningTokens,
    });

    return res.status(200).json({
      success: true,
      duplicate: result.duplicate,
      usage_event: result.event,
    });
  } catch (error) {
    if (error.code === "QUOTA_EXCEEDED") {
      return res.status(429).json({
        error: "Usage quota exceeded",
        current_usage: error.currentUsage,
        requested_quantity: error.requestedQuantity,
        limit: error.limit,
      });
    }

    if (error.message === "Active subscription not found") {
      return res.status(404).json({
        error: error.message,
      });
    }

    console.error("Generate request failed:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

export default router;