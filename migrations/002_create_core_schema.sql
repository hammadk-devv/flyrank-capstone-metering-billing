CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- TENANTS
-- ============================================================

CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PLANS
-- ============================================================

CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    api_call_limit BIGINT NOT NULL CHECK (api_call_limit >= 0),
    ai_token_limit BIGINT NOT NULL CHECK (ai_token_limit >= 0),
    monthly_price_cents BIGINT NOT NULL CHECK (monthly_price_cents >= 0),
    stripe_price_id TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SUBSCRIPTIONS
-- ============================================================

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id UUID NOT NULL
        REFERENCES tenants(id)
        ON DELETE CASCADE,

    plan_id UUID NOT NULL
        REFERENCES plans(id)
        ON DELETE RESTRICT,

    stripe_customer_id TEXT UNIQUE,

    stripe_subscription_id TEXT UNIQUE,

    status TEXT NOT NULL
        CHECK (
            status IN (
                'active',
                'trialing',
                'past_due',
                'canceled',
                'incomplete',
                'incomplete_expired',
                'unpaid'
            )
        ),

    current_period_start TIMESTAMPTZ,

    current_period_end TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT subscriptions_one_per_tenant
        UNIQUE (tenant_id)
);

CREATE INDEX idx_subscriptions_tenant_id
    ON subscriptions (tenant_id);

-- ============================================================
-- USAGE EVENTS
-- ============================================================

CREATE TABLE usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id UUID NOT NULL
        REFERENCES tenants(id)
        ON DELETE CASCADE,

    usage_type TEXT NOT NULL
        CHECK (
            usage_type IN (
                'api_call',
                'ai_token'
            )
        ),

    quantity BIGINT NOT NULL
        CHECK (quantity > 0),

    idempotency_key TEXT NOT NULL
        CHECK (length(trim(idempotency_key)) > 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT usage_events_tenant_idempotency_key
        UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX idx_usage_events_tenant_type_created
    ON usage_events (tenant_id, usage_type, created_at);

CREATE INDEX idx_usage_events_tenant_created
    ON usage_events (tenant_id, created_at);

-- ============================================================
-- STRIPE EVENTS
-- ============================================================

CREATE TABLE stripe_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    stripe_event_id TEXT NOT NULL UNIQUE,

    event_type TEXT NOT NULL,

    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stripe_events_type
    ON stripe_events (event_type);