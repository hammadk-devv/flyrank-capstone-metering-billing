# Usage Metering & Billing Engine — Phase 1 Design

## 1. Problem

Build a small multi-tenant backend service that answers three questions:

1. How much has a tenant used?
2. What does that usage cost?
3. Has the tenant reached its subscription limits?

The system meters API calls and simulated AI-token usage, enforces monthly quotas, calculates cost using integer money units, and synchronizes subscription state from Stripe test-mode webhooks.

## 2. Goals

- Exactly-once usage recording for a repeated request with the same idempotency key.
- Correct quota enforcement at the exact boundary.
- Multi-tenant data isolation.
- Deterministic cost calculations.
- Stripe Checkout in test mode.
- Signature-verified and idempotent Stripe webhooks.
- Clear HTTP 4xx responses for invalid or blocked requests.
- Real PostgreSQL persistence with migrations and indexes.
- Evidence for every capstone requirement.
- A stranger can run the project from the README.

## 3. Explicit non-goals

The core system will NOT implement:

- Real AI model calls.
- Real-money Stripe payments.
- Invoicing.
- Proration.
- Overage billing.
- Distributed microservices.
- Redis/Kafka/event-sourcing infrastructure.
- Authentication/authorization beyond the minimal tenant identification needed for the demo.

These can be considered only after the required core is complete.

## 4. Stack

- Node.js + Express
- PostgreSQL
- Docker Compose
- `pg` for database access
- Zod for boundary validation
- Stripe Node SDK
- Vitest + Supertest for tests
- Pino for structured logging
- dotenv for local configuration
- Stripe CLI for local webhook forwarding/replay

## 5. Architecture

```text
Client
  |
  v
Express routes
  |
  +--> validation / tenant context
  |
  v
Controllers
  |
  +--> MeterService ------+
  +--> QuotaService -------+--> PostgreSQL
  +--> CostService --------+
  +--> BillingService -----+

Stripe Checkout --> Stripe
                       |
                       | signed webhook
                       v
                 /webhooks/stripe
                       |
                 verify signature
                       |
                 deduplicate event
                       |
                 update subscription
                       |
                       v
                   PostgreSQL
```

The implementation intentionally remains a single service with clear data, logic, and HTTP boundaries.

## 6. Plans

### Free

- API calls: 1,000/month
- AI tokens: 100,000/month
- Monthly price: 0 cents

### Pro

- API calls: 100,000/month
- AI tokens: 10,000,000/month
- Monthly price: 999 cents ($9.99)

Plan limits are stored in the database rather than hard-coded in controllers.

## 7. Usage types

`api_call`
- Quantity normally equals 1 per billable request.

`ai_token`
- Quantity is the total billable token quantity:
  `input + cached_input + output + reasoning`.

The cost calculator separately receives the token categories because cached input and reasoning tokens have different pricing rules.

## 8. Database model

### tenants

- `id` UUID primary key
- `name` text not null
- `created_at` timestamptz not null

### plans

- `id` UUID primary key
- `name` text unique not null
- `api_call_limit` bigint not null
- `ai_token_limit` bigint not null
- `monthly_price_cents` bigint not null
- `stripe_price_id` text nullable/unique
- `created_at` timestamptz not null

### subscriptions

- `id` UUID primary key
- `tenant_id` UUID not null FK -> tenants
- `plan_id` UUID not null FK -> plans
- `stripe_customer_id` text unique nullable
- `stripe_subscription_id` text unique nullable
- `status` text not null
- `current_period_start` timestamptz nullable
- `current_period_end` timestamptz nullable
- `created_at` timestamptz not null
- `updated_at` timestamptz not null

Index:
- `(tenant_id)`

### usage_events

- `id` UUID primary key
- `tenant_id` UUID not null FK -> tenants
- `usage_type` text not null
- `quantity` bigint not null
- `idempotency_key` text not null
- `created_at` timestamptz not null

Critical constraint:
- `UNIQUE (tenant_id, idempotency_key)`

Indexes:
- `(tenant_id, usage_type, created_at)`
- `(tenant_id, created_at)`

### stripe_events

- `id` UUID primary key
- `stripe_event_id` text unique not null
- `event_type` text not null
- `processed_at` timestamptz not null

The database uniqueness constraints are part of the correctness design, not merely application checks.

## 9. Idempotency strategy

For every billable request:

1. Require an `Idempotency-Key`.
2. Validate the key at the HTTP boundary.
3. Begin a database transaction.
4. Attempt to insert the usage event.
5. The `(tenant_id, idempotency_key)` unique constraint prevents duplicates.
6. If the key already exists, return the original recorded result instead of creating another event.
7. Commit the transaction.

The same logical request with the same key therefore produces one usage event.

A different key represents a different billable operation.

The design will also test concurrent/retried requests rather than relying only on sequential examples.

## 10. Quota strategy

Quota is checked before a new billable usage event is committed.

For the current billing period:

```text
used + requested <= plan_limit
```

If true:
- allow the operation and record usage atomically.

If false:
- do not create the new usage event.
- API quota exhaustion returns `429 Too Many Requests`.
- Subscription/payment restriction returns `402 Payment Required`.

Boundary proof must include:

```text
999 + 1 -> allowed
1000 + 1 -> rejected
```

The exact rule is documented and tested.

## 11. Cost strategy

Money is represented as integer cents. No floating-point money values are stored.

API-call pricing will be pinned in configuration:

- API call unit price: 1 cent per call for the metered demo.

AI-token pricing will use integer micro-units and pinned constants:

- fresh input: 10 micro-units/token
- cached input: 2 micro-units/token
- output: 30 micro-units/token
- reasoning: 30 micro-units/token

Reasoning tokens are priced using the output rate.

Example:

```text
fresh_input * 10
+ cached_input * 2
+ output * 30
+ reasoning * 30
= AI cost in micro-units
```

The calculator will return integer values only. Conversion to displayable cents happens explicitly and deterministically.

## 12. API contract

### GET /health

Returns service health.

### POST /tenants

Creates a demo tenant and initializes its Free subscription.

Request:

```json
{
  "name": "Acme"
}
```

### POST /generate

Dummy billable endpoint.

Headers:

```text
Idempotency-Key: unique-request-key
X-Tenant-Id: tenant-uuid
```

Request:

```json
{
  "input_tokens": 1200,
  "cached_input_tokens": 300,
  "output_tokens": 500,
  "reasoning_tokens": 100
}
```

Behavior:
- validate request
- identify tenant
- determine requested usage
- enforce quota
- record usage exactly once
- calculate cost
- return a deterministic result

### GET /usage

Headers:

```text
X-Tenant-Id: tenant-uuid
```

Returns current monthly usage, plan limits, and calculated cost.

### POST /billing/checkout

Creates a Stripe Checkout session for upgrading the tenant to Pro.

### POST /webhooks/stripe

Receives Stripe events.

Supported events:
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Webhook flow:
- verify raw-body signature
- reject forged requests with `400`
- deduplicate by Stripe event ID
- apply state change once
- persist processed event

## 13. Validation and error policy

Bad client input must produce clean 4xx responses, never a generic 500.

Examples:

- missing `Idempotency-Key` -> `400`
- malformed tenant ID -> `400`
- invalid token counts -> `400`
- quota exceeded -> `429`
- payment/subscription restriction -> `402`
- invalid Stripe signature -> `400`

Internal errors are logged without exposing secrets.

## 14. Transaction boundaries

The most important state changes are transactional.

Metering:
- quota decision + usage event creation must not leave partial accounting.

Webhook:
- duplicate detection + subscription update + processed-event record must be atomic.

The implementation will favor PostgreSQL constraints and transactions over fragile application-only checks.

## 15. Security

- Stripe secret key only in `.env`.
- Stripe webhook secret only in `.env`.
- `.env` is git-ignored.
- `.env.example` contains safe placeholders only.
- Secrets are never logged.
- Tenant-scoped queries always include tenant identity.
- Stripe webhook signatures are verified before processing.

## 16. Evidence plan

`EVIDENCE.md` will contain one concrete proof for each required acceptance item:

1. Same idempotency key twice -> one usage event.
2. Exact quota boundary -> correct allow/reject behavior.
3. Stripe test Checkout -> Free to Pro and new limits.
4. Forged webhook -> 400; replay -> processed once.
5. Pricing rules -> exact expected totals.

Additional evidence will cover validation, tenant isolation, migrations, tests, and the background-job requirement.

## 17. Background job

The shared capstone requirements include at least one background job. We will keep this small and useful:

`usage-period-finalizer`

It will run on a schedule in the application process and perform a lightweight monthly usage finalization/verification task. It will be designed so the request path does not depend on it.

Failures will be logged clearly and the job will be safe to retry.

## 18. Definition of done

The project is complete only when:

- required submission files exist
- migrations create the full schema
- seed creates deterministic demo data
- README works on a clean machine
- all acceptance probes pass
- tests pass in one command
- evidence is pasted into `EVIDENCE.md`
- AI assistance is honestly recorded in `BUILDLOG.md`
- no secrets exist in Git history
- meaningful commits show each build phase
- public GitHub repository is runnable by a stranger
