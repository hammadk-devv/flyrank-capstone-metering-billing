import { Router } from "express";
import stripe from "../services/stripe.service.js";
import pool from "../db/pool.js";

const router = Router();

router.get("/billing/success", (_req, res) => {
  res.json({
    success: true,
    message: "Stripe Checkout completed successfully.",
  });
});

router.get("/billing/cancel", (_req, res) => {
  res.json({
    success: false,
    message: "Stripe Checkout was canceled.",
  });
});

router.post("/billing/checkout", async (req, res) => {
  const tenantId = req.header("X-Tenant-Id");

  if (!tenantId) {
    return res.status(400).json({
      error: "X-Tenant-Id header is required",
    });
  }

  try {
    const tenantResult = await pool.query(
      `
        SELECT
          t.id,
          t.name,
          s.stripe_customer_id
        FROM tenants t
        LEFT JOIN subscriptions s
          ON s.tenant_id = t.id
        WHERE t.id = $1;
      `,
      [tenantId],
    );

    if (tenantResult.rowCount === 0) {
      return res.status(404).json({
        error: "Tenant not found",
      });
    }

    const tenant = tenantResult.rows[0];

    let customerId = tenant.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        name: tenant.name,
        metadata: {
          tenant_id: tenantId,
        },
      });

      customerId = customer.id;

      await pool.query(
        `
          UPDATE subscriptions
          SET
            stripe_customer_id = $1,
            updated_at = NOW()
          WHERE tenant_id = $2;
        `,
        [customerId, tenantId],
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price: process.env.STRIPE_PRO_PRICE_ID,
          quantity: 1,
        },
      ],
      success_url: "http://localhost:3000/billing/success",
      cancel_url: "http://localhost:3000/billing/cancel",
      metadata: {
        tenant_id: tenantId,
      },
    });

    return res.status(201).json({
      checkout_url: session.url,
      session_id: session.id,
    });
  } catch (error) {
    console.error("Checkout creation failed:", error);

    return res.status(500).json({
      error: "Unable to create checkout session",
    });
  }
});

export default router;