import Stripe from "stripe";
import pool from "../db/pool.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function handleStripeEvent(event) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `
        SELECT id
        FROM stripe_events
        WHERE stripe_event_id = $1
        FOR UPDATE;
      `,
      [event.id],
    );

    if (existing.rowCount > 0) {
      await client.query("COMMIT");

      return {
        duplicate: true,
      };
    }

    await client.query(
      `
        INSERT INTO stripe_events (
          stripe_event_id,
          event_type
        )
        VALUES ($1, $2);
      `,
      [event.id, event.type],
    );

    if (
      event.type === "checkout.session.completed" ||
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated"
    ) {
      const object = event.data.object;

      const tenantId =
        object.metadata?.tenant_id ||
        null;

      const customerId =
        object.customer ||
        null;

      const subscriptionId =
        object.subscription ||
        object.id ||
        null;

      if (tenantId || customerId) {
        const resolvedTenant = await client.query(
          `
            SELECT tenant_id
            FROM subscriptions
            WHERE tenant_id = $1
               OR stripe_customer_id = $2
            LIMIT 1;
          `,
          [tenantId, customerId],
        );

        if (resolvedTenant.rowCount > 0) {
          const resolvedTenantId = resolvedTenant.rows[0].tenant_id;

          let subscription = object;

          if (
            event.type === "checkout.session.completed" &&
            object.subscription
          ) {
            subscription = await stripe.subscriptions.retrieve(
              object.subscription,
            );
          }

          const stripePriceId =
            subscription.items?.data?.[0]?.price?.id || null;

          const status = subscription.status;

          const periodStart = subscription.current_period_start
            ? new Date(subscription.current_period_start * 1000)
            : null;

          const periodEnd = subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000)
            : null;

          let planResult = null;

          if (stripePriceId) {
            planResult = await client.query(
              `
                SELECT id
                FROM plans
                WHERE stripe_price_id = $1;
              `,
              [stripePriceId],
            );
          }

          if (planResult?.rowCount > 0) {
            await client.query(
              `
                UPDATE subscriptions
                SET
                  plan_id = $1,
                  stripe_customer_id = COALESCE($2, stripe_customer_id),
                  stripe_subscription_id = COALESCE($3, stripe_subscription_id),
                  status = $4,
                  current_period_start = $5,
                  current_period_end = $6,
                  updated_at = NOW()
                WHERE tenant_id = $7;
              `,
              [
                planResult.rows[0].id,
                customerId,
                subscriptionId,
                status,
                periodStart,
                periodEnd,
                resolvedTenantId,
              ],
            );
          }
        }
      }
    }

    await client.query("COMMIT");

    return {
      duplicate: false,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export default stripe;