# EVIDENCE

## 1. Exactly-Once Metering / Idempotency

### Test
`tests/meter.service.test.js`

### Result
```text
✓ records usage exactly once for the same idempotency key
```

The same billable request was sent twice using the same idempotency key.

Observed behavior:
- First request: `duplicate = false`
- Retry: `duplicate = true`
- Both responses referenced the same usage event
- PostgreSQL contained exactly one event for that tenant + idempotency key

## 2. Quota Enforcement

Free plan API quota:

```text
1,000 API calls / month
```

The tenant was already at:

```text
current_usage = 1001
limit = 1000
```

A further request for one API call returned:

```text
HTTP 429
```

Response:

```json
{
  "error": "Usage quota exceeded",
  "current_usage": 1001,
  "requested_quantity": 1,
  "limit": 1000
}
```

The rejected idempotency key was checked in PostgreSQL:

```text
SELECT COUNT(*)
FROM usage_events
WHERE tenant_id = '00000000-0000-4000-8000-000000000001'
  AND idempotency_key = 'final-api-quota-boundary';

 count
-------
     0
```

The rejected request was therefore not recorded.

## 3. AI Token Pricing

Pinned pricing:

```text
Fresh input:  10 micro-units/token
Cached input:  2 micro-units/token
Output:       30 micro-units/token
Reasoning:    30 micro-units/token
```

Test:

```text
input_tokens = 1000
cached_input_tokens = 200
output_tokens = 500
reasoning_tokens = 100
```

Calculation:

```text
Fresh input = 1000 - 200 = 800
800 × 10 = 8000

Cached input:
200 × 2 = 400

Output:
500 × 30 = 15000

Reasoning:
100 × 30 = 3000

Total:
8000 + 400 + 15000 + 3000
= 26400 micro-units
```

Observed usage event:

```text
quantity = 1600
input_tokens = 1000
cached_input_tokens = 200
output_tokens = 500
reasoning_tokens = 100
cost_micro_units = 26400
```

Automated pricing tests:

```text
tests/cost.service.test.js
5 tests passed
```

## 4. Usage Rollup

Before the final AI cost test:

```text
api_calls = 1001
ai_tokens = 1700
cost = 28320 micro-units
```

The final AI test added:

```text
ai_tokens = 1600
cost = 26400 micro-units
```

After the test, `GET /usage` returned:

```text
api_calls:
used = 1001
limit = 100000

ai_tokens:
used = 3300
limit = 10000000

cost:
micro_units = 54720
```

The totals match the recorded usage events.

## 5. Stripe Checkout

Stripe Sandbox Checkout was completed successfully.

The application created a Checkout session and the test payment completed using Stripe test mode.

The resulting Stripe event was:

```text
checkout.session.completed
```

The event was forwarded to:

```text
POST /webhooks/stripe
```

and persisted in PostgreSQL.

## 6. Free → Pro Subscription Synchronization

Before Stripe synchronization:

```text
Acme Demo | Free | active
```

After successful Stripe Checkout and webhook processing:

```text
Acme Demo | Pro | active
```

`GET /usage` then returned:

```text
plan = Pro

api_calls.limit = 100000
ai_tokens.limit = 10000000
```

This proves the verified Stripe webhook updated the tenant's plan.

## 7. Webhook Signature Verification

A forged webhook was sent without a valid Stripe signature.

Result:

```text
HTTP 400
```

The fake event ID was checked in PostgreSQL:

```text
SELECT COUNT(*)
FROM stripe_events
WHERE stripe_event_id = 'evt_fake_security_test';

 count
-------
     0
```

Therefore the forged event did not modify webhook state.

## 8. Stripe Webhook Deduplication

A real Stripe event was processed:

```text
evt_1UDSC475FWuD3E7LhEl5PmW8
```

The same event was then replayed with:

```text
stripe events resend evt_1UDSC475FWuD3E7LhEl5PmW8
```

PostgreSQL was checked afterward:

```text
SELECT COUNT(*)
FROM stripe_events
WHERE stripe_event_id = 'evt_1UDSC475FWuD3E7LhEl5PmW8';

 count
-------
     1
```

The event exists exactly once.

## 9. Automated Tests

Command:

```text
npm test
```

Result:

```text
Test Files  3 passed (3)
Tests       10 passed (10)
```

Test files:

```text
tests/cost.service.test.js
tests/meter.service.test.js
tests/generate.routes.test.js
```

## 10. Database Persistence and Tenant Isolation

PostgreSQL contains:

```text
tenants
plans
subscriptions
usage_events
stripe_events
schema_migrations
```

Usage events use:

```text
UNIQUE (tenant_id, idempotency_key)
```

Usage and subscription queries are scoped by `tenant_id`.

Database schema is managed through SQL migrations.

## 11. Background Job

Background job:

```text
src/jobs/subscription-reconciliation.job.js
```

Startup output:

```text
[subscription-reconciliation] background job started
[subscription-reconciliation] completed
```

The job performs subscription reconciliation outside the HTTP request path and includes retry/failure handling.

## 12. Boundary Validation

The API validates request headers and request-body values before recording billable usage.

Required values include:

```text
X-Tenant-Id
Idempotency-Key
usageType
quantity
```

AI token values are validated as non-negative integers.

Invalid input is rejected with a 4xx response rather than being recorded as usage.

## 13. Secrets

Secrets are stored in `.env`.

`.env` is excluded from Git.

`.env.example` contains placeholders only.

Stripe is used in Sandbox/test mode.

No Stripe secret is committed to the repository.

## Final Acceptance Summary

```text
✓ Exactly-once usage metering
✓ Idempotency protection
✓ Quota enforcement
✓ 429 quota response
✓ AI token pricing
✓ Cached-input pricing
✓ Reasoning-token pricing
✓ Usage/cost rollup
✓ Stripe Checkout
✓ Free → Pro synchronization
✓ Webhook signature verification
✓ Webhook deduplication
✓ PostgreSQL persistence
✓ Tenant isolation
✓ Background reconciliation job
✓ Automated tests
✓ Environment-based secrets
```
