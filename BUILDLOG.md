# BUILDLOG

## Project

**FlyRank AI Internship — Usage Metering & Billing Engine**

## Development Summary

This project was developed incrementally as a backend capstone using:

- Node.js
- Express
- PostgreSQL
- Docker
- Stripe Sandbox
- Stripe CLI
- Vitest
- Zod

The implementation focused on correctness around usage metering, idempotency, quota enforcement, AI-token cost calculation, Stripe webhooks, and subscription synchronization.

AI assistance was used during development for architecture planning, implementation guidance, debugging, testing, and documentation. All generated suggestions were reviewed, executed, tested, and corrected where necessary.

---

## Build Progress

### 1. Project Foundation

Created the Node.js/Express application and configured:

- PostgreSQL
- Docker Compose
- environment variables
- Git
- database connection pooling
- SQL migrations
- deterministic database seeding

---

### 2. Database Schema

Implemented PostgreSQL tables for:

- `tenants`
- `plans`
- `subscriptions`
- `usage_events`
- `stripe_events`
- `schema_migrations`

Added database constraints and indexes for:

- tenant isolation
- positive usage quantities
- supported usage types
- valid plan limits
- idempotency uniqueness
- Stripe event uniqueness

Usage idempotency is enforced with:

```text
UNIQUE (tenant_id, idempotency_key)
```

---

### 3. Metering and Quotas

Implemented the meter service with:

- transactional usage recording
- idempotency-key handling
- duplicate detection
- tenant isolation
- monthly quota checks
- database-backed persistence

The service locks the subscription during quota evaluation so concurrent requests cannot independently consume the same remaining quota.

---

### 4. Usage Endpoint

Implemented:

```text
GET /usage
```

The endpoint reports:

- current plan
- API-call usage and limit
- AI-token usage and limit
- accumulated cost

---

### 5. AI Token Metering and Pricing

Added AI-token metering with separate fields for:

- input tokens
- cached input tokens
- output tokens
- reasoning tokens

Pinned demo pricing was implemented using integer micro-units:

```text
Fresh input:  10 micro-units/token
Cached input:  2 micro-units/token
Output:       30 micro-units/token
Reasoning:    30 micro-units/token
```

A validation case using 1,000 input tokens, 200 cached input tokens, 500 output tokens, and 100 reasoning tokens produced:

```text
26400 micro-units
```

---

### 6. API and AI Usage Support

The `/generate` endpoint was updated to support both:

```text
api_call
ai_token
```

API calls can specify a quantity.

AI-token requests calculate quantity from input, output, and reasoning tokens unless an explicit quantity is provided.

---

### 7. Stripe Checkout

Implemented:

```text
POST /billing/checkout
```

Configured Stripe Sandbox with a recurring Pro price.

The application creates a Stripe customer when necessary and creates a Stripe Checkout subscription session.

---

### 8. Stripe Webhooks

Implemented:

```text
POST /webhooks/stripe
```

The webhook handler:

1. receives the raw request body
2. verifies the Stripe signature
3. checks whether the Stripe event was already processed
4. persists the event
5. synchronizes the tenant subscription
6. returns success

Stripe event processing is deduplicated using the persistent `stripe_events` table.

---

## Debugging and Corrections

### Stripe account mismatch

During Stripe integration, the Stripe CLI and application were initially connected to different Sandbox accounts.

The CLI reported:

```text
acct_1UDMJb75FWuD3E7L
```

while an earlier CLI configuration referenced a different account.

The application's Stripe secret key was checked programmatically using the Stripe API and confirmed the correct account.

The Stripe CLI was then authenticated against the matching Sandbox account.

After correction, Stripe events were successfully forwarded to:

```text
http://localhost:3000/webhooks/stripe
```

---

### Webhook route path

The webhook router initially duplicated the mount path.

The application used:

```text
app.use("/webhooks/stripe", webhookRouter)
```

while the router also contained the same path.

The router was corrected to use:

```text
router.post("/", ...)
```

This produced the intended endpoint:

```text
POST /webhooks/stripe
```

---

### Raw Stripe webhook body

Stripe signature verification requires the raw request body.

The webhook route therefore uses:

```text
express.raw({ type: "application/json" })
```

and is mounted before the normal:

```text
express.json()
```

middleware.

---

### Vitest setup configuration

An initial command-line setup option was attempted:

```text
--setupFiles
```

The installed Vitest version rejected that CLI option.

The setup was moved into the Vitest configuration file:

```text
vitest.config.js
```

using the test `setupFiles` configuration.

The test suite then ran successfully.

---

### PowerShell JSON quoting

Initial `curl.exe` requests from PowerShell caused JSON parsing errors.

The request body was being interpreted incorrectly before reaching the Express application.

Testing was switched to PowerShell's native:

```text
Invoke-RestMethod
Invoke-WebRequest
```

with:

```text
ConvertTo-Json
```

This produced valid JSON requests.

---

## Acceptance Testing

### Exactly-once usage

The same idempotency key was submitted twice.

Result:

```text
First request: duplicate = false
Second request: duplicate = true
Database event count: 1
```

---

### Quota boundary

The tenant was switched to the Free plan for the boundary test.

Free limit:

```text
1,000 API calls
```

Existing usage:

```text
1001
```

Next API call:

```text
HTTP 429
```

The rejected idempotency key was not persisted:

```text
count = 0
```

The tenant was subsequently restored to Pro.

---

### Stripe Checkout

A Stripe Sandbox Checkout session was completed successfully.

Stripe CLI showed:

```text
--> checkout.session.completed
--> customer.subscription.created
<-- [200] POST http://localhost:3000/webhooks/stripe
```

The PostgreSQL subscription changed from:

```text
Free
```

to:

```text
Pro
```

with an active Stripe subscription ID.

---

### Forged webhook

A webhook request with an invalid signature returned:

```text
HTTP 400
```

The fake Stripe event was not inserted into `stripe_events`.

---

### Webhook replay

A real Stripe event was replayed using:

```text
stripe events resend <event_id>
```

PostgreSQL contained exactly one record for the event ID after replay.

---

### AI cost verification

Final AI test:

```text
Input tokens:           1000
Cached input tokens:     200
Output tokens:            500
Reasoning tokens:         100
```

Recorded:

```text
Quantity:                 1600
Cost:                     26400 micro-units
```

The `/usage` endpoint reflected the resulting totals.

---

## Automated Testing

Final test command:

```text
npm test
```

Final result:

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

---

## Background Job

Implemented:

```text
src/jobs/subscription-reconciliation.job.js
```

The job:

- runs at application startup
- runs periodically
- reconciles subscription state
- retries failed operations
- emits an alert after retry exhaustion

Observed startup output:

```text
[subscription-reconciliation] background job started
[subscription-reconciliation] completed
```

---

## Git Milestones

The main implementation milestones included:

```text
6906aad feat: add metering and quota enforcement
aa550be feat: add usage summary endpoint
f00c200 feat: add AI token metering and cost tracking
bab860a feat: add subscription reconciliation background job
0794360 feat: add Stripe billing and webhook integration
6163857 test: add AI cost calculation coverage
c60cde4 test: add metering and cost test coverage
225c3da feat: support API and AI token metering
```

The repository is maintained on GitHub with the final changes pushed to `main`.

---

## Lessons Learned

1. Billing systems need database-level idempotency, not only application-level checks.
2. Quota checks and usage insertion need transactional protection.
3. Stripe CLI and application credentials must use the same account and environment.
4. Stripe webhook signatures require the raw request body.
5. Stripe events must be deduplicated persistently.
6. Integer micro-units avoid floating-point money errors.
7. Cached AI input and reasoning tokens need explicit pricing treatment.
8. PowerShell command-line quoting can affect JSON API testing.
9. AI-generated code must be validated by running the application and tests.
10. Evidence should be based on actual test results and database observations.

---

## Final State

The completed system provides:

- PostgreSQL-backed usage metering
- tenant isolation
- exactly-once/idempotent usage recording
- monthly quota enforcement
- API-call metering
- AI-token metering
- deterministic AI cost calculation
- usage and cost reporting
- Stripe Sandbox Checkout
- signed Stripe webhooks
- webhook deduplication
- Free → Pro subscription synchronization
- subscription reconciliation background job
- retry and failure handling
- automated test coverage
- environment-based secret management
