import pool from "../db/pool.js";
import stripe from "../services/stripe.service.js";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

const ALLOWED_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "unpaid",
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(operation, jobName) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      console.error(
        `[${jobName}] attempt ${attempt}/${MAX_RETRIES} failed:`,
        error.message,
      );

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  console.error(
    `[ALERT] ${jobName} failed after ${MAX_RETRIES} attempts:`,
    lastError,
  );

  throw lastError;
}

async function reconcileSubscriptions() {
  const result = await pool.query(`
    SELECT
      s.tenant_id,
      s.stripe_customer_id
    FROM subscriptions s
    WHERE s.stripe_customer_id IS NOT NULL;
  `);

  for (const row of result.rows) {
    const subscriptions = await stripe.subscriptions.list({
      customer: row.stripe_customer_id,
      status: "all",
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      continue;
    }

    const subscription = subscriptions.data[0];

    const stripePriceId =
      subscription.items?.data?.[0]?.price?.id || null;

    if (!stripePriceId) {
      continue;
    }

    const planResult = await pool.query(
      `
        SELECT id
        FROM plans
        WHERE stripe_price_id = $1;
      `,
      [stripePriceId],
    );

    if (planResult.rowCount === 0) {
      console.error(
        `[ALERT] No local plan found for Stripe price ${stripePriceId}`,
      );
      continue;
    }

    const status = ALLOWED_STATUSES.has(subscription.status)
      ? subscription.status
      : "past_due";

    await pool.query(
      `
        UPDATE subscriptions
        SET
          plan_id = $1,
          stripe_subscription_id = $2,
          status = $3,
          current_period_start = $4,
          current_period_end = $5,
          updated_at = NOW()
        WHERE tenant_id = $6;
      `,
      [
        planResult.rows[0].id,
        subscription.id,
        status,
        subscription.current_period_start
          ? new Date(subscription.current_period_start * 1000)
          : null,
        subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000)
          : null,
        row.tenant_id,
      ],
    );
  }

  console.log("[subscription-reconciliation] completed");
}

export function startSubscriptionReconciliationJob() {
  const run = async () => {
    try {
      await withRetry(
        reconcileSubscriptions,
        "subscription-reconciliation",
      );
    } catch {
      // Failure already reported by withRetry.
    }
  };

  // Run once when the server starts.
  run();

  // Run every hour.
  setInterval(run, 60 * 60 * 1000);

  console.log(
    "[subscription-reconciliation] background job started",
  );
}