import { Router } from "express";
import { z } from "zod";
import { recordUsage } from "../services/meter.service.js";

const router = Router();

const generateSchema = z.object({
  usageType: z.enum(["api_call", "ai_token"]).default("ai_token"),

  quantity: z.number().int().positive().optional(),

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

  const data = parsed.data;

  let usageType = data.usageType;
  let quantity = data.quantity;

  if (usageType === "api_call") {
    quantity = quantity ?? 1;
  }

  if (usageType === "ai_token") {
    quantity =
      data.quantity ??
      (data.inputTokens +
        data.outputTokens +
        data.reasoningTokens);
  }

  if (!quantity || quantity <= 0) {
    return res.status(400).json({
      error: "Quantity must be a positive integer",
    });
  }

  try {
    const result = await recordUsage({
      tenantId,
      usageType,
      quantity,
      idempotencyKey,

      inputTokens:
        usageType === "ai_token" ? data.inputTokens : null,

      cachedInputTokens:
        usageType === "ai_token"
          ? data.cachedInputTokens
          : null,

      outputTokens:
        usageType === "ai_token" ? data.outputTokens : null,

      reasoningTokens:
        usageType === "ai_token"
          ? data.reasoningTokens
          : null,
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