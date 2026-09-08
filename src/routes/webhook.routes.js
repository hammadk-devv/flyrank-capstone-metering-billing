import express from "express";
import { Router } from "express";
import stripe, { handleStripeEvent } from "../services/stripe.service.js";

const router = Router();

router.post(
  "/",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];

    if (!signature) {
      return res.status(400).json({
        error: "Stripe signature is required",
      });
    }

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (error) {
      console.error(
        "Stripe webhook signature verification failed:",
        error.message,
      );

      return res.status(400).json({
        error: "Invalid Stripe webhook signature",
      });
    }

    try {
      const result = await handleStripeEvent(event);

      return res.status(200).json({
        received: true,
        duplicate: result.duplicate,
        event_id: event.id,
        event_type: event.type,
      });
    } catch (error) {
      console.error("Stripe webhook processing failed:", error);

      return res.status(500).json({
        error: "Webhook processing failed",
      });
    }
  },
);

export default router;