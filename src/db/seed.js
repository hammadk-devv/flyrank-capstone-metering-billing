import "dotenv/config";
import pool from "./pool.js";

const DEMO_TENANT_ID = "00000000-0000-4000-8000-000000000001";

const plans = [
  {
    name: "Free",
    apiCallLimit: 1_000,
    aiTokenLimit: 100_000,
    monthlyPriceCents: 0,
    stripePriceId: null,
  },
  {
    name: "Pro",
    apiCallLimit: 100_000,
    aiTokenLimit: 10_000_000,
    monthlyPriceCents: 999,
    stripePriceId: null,
  },
];

async function seedPlans(client) {
  const planIds = {};

  for (const plan of plans) {
    const result = await client.query(
      `
        INSERT INTO plans (
          name,
          api_call_limit,
          ai_token_limit,
          monthly_price_cents,
          stripe_price_id
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (name)
        DO UPDATE SET
          api_call_limit = EXCLUDED.api_call_limit,
          ai_token_limit = EXCLUDED.ai_token_limit,
          monthly_price_cents = EXCLUDED.monthly_price_cents,
          stripe_price_id = EXCLUDED.stripe_price_id
        RETURNING id;
      `,
      [
        plan.name,
        plan.apiCallLimit,
        plan.aiTokenLimit,
        plan.monthlyPriceCents,
        plan.stripePriceId,
      ],
    );

    planIds[plan.name] = result.rows[0].id;
  }

  return planIds;
}

async function seedDemoTenant(client, freePlanId) {
  const tenantResult = await client.query(
    `
      INSERT INTO tenants (
        id,
        name
      )
      VALUES ($1, 'Acme Demo')
      ON CONFLICT (id)
      DO UPDATE SET
        name = EXCLUDED.name
      RETURNING id;
    `,
    [DEMO_TENANT_ID],
  );

  const tenantId = tenantResult.rows[0].id;

  await client.query(
    `
      INSERT INTO subscriptions (
        tenant_id,
        plan_id,
        status
      )
      VALUES ($1, $2, 'active')
      ON CONFLICT (tenant_id)
      DO UPDATE SET
        plan_id = EXCLUDED.plan_id,
        status = EXCLUDED.status,
        updated_at = NOW();
    `,
    [tenantId, freePlanId],
  );

  return tenantId;
}

async function seed() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const planIds = await seedPlans(client);
    const tenantId = await seedDemoTenant(client, planIds.Free);

    await client.query("COMMIT");

    console.log("Seed complete.");
    console.log(`Free plan: ${planIds.Free}`);
    console.log(`Pro plan: ${planIds.Pro}`);
    console.log(`Demo tenant: ${tenantId}`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();