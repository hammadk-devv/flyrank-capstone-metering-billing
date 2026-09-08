# FlyRank Usage Metering & Billing Engine

A production-minded SaaS usage metering and billing backend built for the FlyRank AI Internship Backend Engineering Capstone.

The service answers three core billing questions:

1. How much has a tenant used?
2. What did that usage cost?
3. Has the tenant reached its plan limit?

It implements PostgreSQL-backed usage metering, idempotency, quota enforcement, deterministic AI-token pricing, Stripe Sandbox subscriptions, signed webhooks, and subscription reconciliation.

## Features

- Multi-tenant usage metering
- PostgreSQL persistence
- SQL migrations and deterministic seed data
- Free and Pro plans
- API-call metering
- AI-token metering
- Idempotency-key protection
- Transactional quota enforcement
- 429 quota responses
- Integer micro-unit cost calculation
- Cached-input pricing
- Reasoning-token pricing
- Usage and cost rollups
- Stripe Checkout in Sandbox mode
- Stripe webhook signature verification
- Stripe webhook deduplication
- Free → Pro subscription synchronization
- Background subscription reconciliation
- Retry and failure handling
- Vitest automated tests
- Zod request validation

## Architecture

```text
                         Client
                           |
                           v
                  +------------------+
                  |  Express API     |
                  +------------------+
                     |            |
                     v            v
                /generate       /usage
                     |            |
                     v            v
              +-------------+  +-------------+
              | MeterService|  | Usage Query |
              +-------------+  +-------------+
                     |
                     v
              +----------------+
              |   PostgreSQL   |
              |                |
              | tenants        |
              | plans          |
              | subscriptions  |
              | usage_events   |
              | stripe_events  |
              +----------------+
                     ^
                     |
              Stripe Webhooks
                     ^
                     |
              Stripe Checkout

              Background Job
                     |
                     v
              Subscription
              Reconciliation
```

## Technology Stack

- Node.js
- Express
- PostgreSQL
- Docker
- Stripe Sandbox
- Stripe CLI
- Vitest
- Zod

## Project Structure

```text
flyrank-capstone-metering-billing/
├── migrations/
│   ├── 001_initial_schema.sql
│   ├── 002_create_core_schema.sql
│   └── 003_add_usage_cost.sql
├── src/
│   ├── db/
│   │   ├── migrate.js
│   │   ├── pool.js
│   │   └── seed.js
│   ├── jobs/
│   │   └── subscription-reconciliation.job.js
│   ├── routes/
│   │   ├── billing.routes.js
│   │   ├── generate.routes.js
│   │   ├── usage.routes.js
│   │   └── webhook.routes.js
│   ├── services/
│   │   ├── cost.service.js
│   │   ├── meter.service.js
│   │   └── stripe.service.js
│   └── server.js
├── tests/
│   ├── cost.service.test.js
│   ├── generate.routes.test.js
│   ├── meter.service.test.js
│   └── setup.js
├── .env.example
├── BUILDLOG.md
├── capstone.yaml
├── DESIGN.md
├── EVIDENCE.md
├── docker-compose.yml
├── package.json
└── README.md
```

# Getting Started

## Prerequisites

Install:

- Node.js
- Docker Desktop
- Stripe CLI

Stripe must be configured in Sandbox/Test mode.

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment

Copy `.env.example` to `.env`.

Configure:

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://metering:metering@localhost:5432/metering

STRIPE_SECRET_KEY=sk_test_replace_me
STRIPE_WEBHOOK_SECRET=whsec_replace_me
STRIPE_PRO_PRICE_ID=price_replace_me
```

Do not commit `.env`.

## 3. Start PostgreSQL

```bash
docker compose up -d
```

## 4. Run migrations and seed

```bash
npm run db:migrate
npm run db:seed
```

## 5. Start the application

```bash
npm run dev
```

Or:

```bash
npm start
```

Application:

```text
http://localhost:3000
```

# Plans

## Free

```text
API calls: 1,000 / month
AI tokens: 100,000 / month
Price: $0
```

## Pro

```text
API calls: 100,000 / month
AI tokens: 10,000,000 / month
Price: $9.99 / month
```

These are demo values for the capstone.

# API

## Health

```http
GET /health
```

Example:

```json
{
  "status": "ok",
  "service": "metering-billing-engine"
}
```

## Database Health

```http
GET /health/db
```

Returns PostgreSQL connectivity status.

## Generate / Meter Usage

```http
POST /generate
```

Required headers:

```text
Content-Type: application/json
X-Tenant-Id: <tenant-id>
Idempotency-Key: <unique-key>
```

### API call

```json
{
  "usageType": "api_call",
  "quantity": 1
}
```

### AI token request

```json
{
  "usageType": "ai_token",
  "inputTokens": 1000,
  "cachedInputTokens": 200,
  "outputTokens": 500,
  "reasoningTokens": 100
}
```

For AI-token usage, quantity is calculated from input, output, and reasoning token counts unless an explicit quantity is supplied.

## Idempotency

Every billable request requires an `Idempotency-Key`.

The database enforces:

```text
UNIQUE (tenant_id, idempotency_key)
```

Submitting the same request with the same key returns the original usage event instead of recording another event.

## Quotas

When a request would exceed the active plan's monthly quota, the API returns:

```text
HTTP 429
```

and does not insert the rejected usage event.

## Usage

```http
GET /usage
```

Required header:

```text
X-Tenant-Id: <tenant-id>
```

Example response:

```json
{
  "plan": "Pro",
  "period": {
    "start": "..."
  },
  "api_calls": {
    "used": 1001,
    "limit": 100000
  },
  "ai_tokens": {
    "used": 3300,
    "limit": 10000000
  },
  "cost": {
    "micro_units": 54720
  }
}
```

# AI Token Pricing

Pinned demo pricing:

```text
Fresh input:  10 micro-units/token
Cached input:  2 micro-units/token
Output:       30 micro-units/token
Reasoning:    30 micro-units/token
```

Cached input is charged at its lower rate.

Reasoning tokens are charged using the output rate.

Example:

```text
Input:             1000
Cached input:       200
Output:             500
Reasoning:          100

Fresh input = 1000 - 200 = 800

800 × 10 = 8000
200 × 2  = 400
500 × 30 = 15000
100 × 30 = 3000

Total = 26400 micro-units
```

These are pinned capstone demo values, not provider pricing.

# Stripe Billing

## Checkout

```http
POST /billing/checkout
```

Required header:

```text
X-Tenant-Id: <tenant-id>
```

The endpoint creates a Stripe Sandbox Checkout session for the Pro subscription.

## Webhook

```http
POST /webhooks/stripe
```

The webhook:

1. receives the raw Stripe request body
2. verifies the Stripe signature
3. checks the persistent event ID for duplicates
4. records the Stripe event
5. resolves the tenant
6. synchronizes the subscription and plan
7. returns success

Invalid signatures return HTTP 400.

Replayed Stripe events are detected using the `stripe_events` table.

## Stripe CLI

Authenticate Stripe CLI against the same Sandbox account used by the application's `STRIPE_SECRET_KEY`.

Start the listener:

```bash
stripe listen --events "checkout.session.completed,customer.subscription.created,customer.subscription.updated" --forward-to http://localhost:3000/webhooks/stripe
```

Use the signing secret printed by Stripe CLI in `.env`:

```env
STRIPE_WEBHOOK_SECRET=whsec_...
```

Restart the Node application after changing `.env`.

## Test Stripe Events

Generate a test event:

```bash
stripe trigger checkout.session.completed
```

For a real Checkout flow:

1. Start PostgreSQL.
2. Start the Node server.
3. Start the Stripe CLI listener.
4. Call `POST /billing/checkout`.
5. Open the returned Checkout URL.
6. Complete the Sandbox payment.
7. Confirm webhook delivery.
8. Confirm the tenant changed from Free to Pro.
9. Call `GET /usage`.

Test card:

```text
4242 4242 4242 4242
```

Use any future expiry date and valid test CVC.

# Background Reconciliation

The subscription reconciliation job is:

```text
src/jobs/subscription-reconciliation.job.js
```

It:

- runs at startup
- runs periodically
- checks subscription state
- retries failed operations
- reports an alert after retry exhaustion

It is intentionally implemented as an in-process background job for the bounded capstone scope.

# Testing

Run:

```bash
npm test
```

Final verified result:

```text
Test Files  3 passed (3)
Tests       10 passed (10)
```

Tests cover:

- AI cost calculation
- token validation
- request validation
- idempotent metering
- quota enforcement

# Database

PostgreSQL tables:

```text
tenants
plans
subscriptions
usage_events
stripe_events
schema_migrations
```

Important constraints include:

```text
UNIQUE (tenant_id, idempotency_key)
UNIQUE (stripe_event_id)
```

Usage records and subscription operations are tenant-scoped.

# Security

- Stripe secrets are stored in `.env`.
- `.env` is excluded from Git.
- `.env.example` contains placeholders only.
- Stripe webhook signatures are verified.
- Stripe events are deduplicated.
- Usage idempotency is enforced at the database level.
- Tenant IDs scope usage and subscription operations.
- Stripe is used only in Sandbox/Test mode.

# Scope and Limitations

Included:

- 2 plans
- 2 usage types
- dummy billable endpoint
- usage metering
- quota enforcement
- AI-token cost calculation
- Stripe Sandbox subscriptions
- webhook verification and deduplication
- background reconciliation

Not included:

- real AI model calls
- production payment processing
- invoicing
- proration
- overage billing
- complex tax handling
- distributed job infrastructure
- production alerting infrastructure

AI token usage is simulated.

# Documentation

- `DESIGN.md` — system design and technical decisions
- `EVIDENCE.md` — acceptance-test evidence
- `BUILDLOG.md` — development history, AI assistance, debugging, and corrections
- `capstone.yaml` — capstone run, seed, test, base URL, and endpoints

# Final Verification

```bash
npm test
git status
```

The final repository should have passing tests and a clean working tree before submission.

## License

MIT
