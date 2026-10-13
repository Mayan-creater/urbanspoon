# Urban Spoon — Testing Strategy

## Objective
Provide confidence that Urban Spoon is correct, secure, usable, and reliable.

## Levels
- Unit: deterministic business logic.
- Integration: modules, persistence, providers.
- API: contracts and behavior.
- E2E: critical user journeys.
- Security: auth, authorization, injection, secrets, abuse.
- Accessibility: keyboard, semantics, labels, focus, contrast.
- Performance: response time, throughput, critical page/load scenarios.

## Critical E2E
1. Registration/login
2. Discovery
3. Search/filter
4. Menu
5. Customization
6. Cart
7. Checkout
8. Payment
9. Order confirmation
10. Restaurant acceptance
11. Preparation
12. Delivery assignment
13. Delivery completion
14. History
15. Review
16. Cancellation/refund where eligible

## API Categories
Happy path, validation, authentication, authorization, ownership, pagination, filtering/sorting, idempotency, errors, rate limits, provider failures.

## Financial Tests
Subtotal, quantity, customization, discount, tax, delivery fee, platform fee, rounding, final total, payment amount, refund/partial refund. Include boundary values.

## State Machine
[STATE_MACHINES.md](STATE_MACHINES.md) is the test oracle. Every row of every
transition table needs a test for the allowed actor, and each state needs tests
proving that unlisted transitions and wrong actors are rejected with
`INVALID_STATE_TRANSITION` or a forbidden response.

Happy paths:
- Intent: `OPEN → PAYMENT_PENDING → PAYMENT_VERIFIED → CONFIRMED`
- Order: `CONFIRMED → RESTAURANT_ACCEPTED → PREPARING → READY_FOR_PICKUP → PICKED_UP → DELIVERED`
- Delivery: `PENDING_ASSIGNMENT → ASSIGNED → ARRIVED_AT_RESTAURANT → PICKED_UP → ARRIVED → DELIVERED`

Required failure and race scenarios:
- Payment attempt fails, then a retry on the same intent succeeds.
- Intent expires; a payment succeeding after expiry is refunded automatically and creates no order.
- Two attempts on one intent both succeed: exactly one order, the second payment refunded.
- Webhook and client verify arrive concurrently or repeatedly: exactly one order.
- Item becomes unavailable or restaurant closes between intent and verification: intent `VOIDED`, full refund.
- Cart edited after intent creation: the paid amount and order items match the intent snapshot.
- Restaurant rejection and acceptance timeout: `REJECTED_BY_RESTAURANT`, full refund.
- Customer cancellation before and after acceptance (after must be rejected).
- Offer rejection, expiry, concurrent acceptance by two partners, and release before pickup.
- Delivery failure, and order cancellation withdrawing open offers.
- Partial refunds that would exceed the captured amount are rejected; refund approval by the requester is rejected.

Invalid transitions must be rejected and recorded where auditability is required.

## Test Data
Use isolated deterministic fixtures; no production personal data; cleanup/isolation strategy.

## Browser
Test supported release browsers and mobile/tablet/desktop critical views. Prefer stable accessible selectors/test IDs. Avoid fixed sleeps.

## Mobile
For native apps: Android/iOS, device sizes, permissions, network interruption, notifications, background/foreground.

## Regression
Every release: unit, API, critical E2E, security checks, smoke. Major releases additionally require full regression, performance, accessibility, and recovery testing.

## CI Gates
Fail on build, typecheck, lint where configured, critical test, or required security gate failure.

## Severity
Critical: security breach, payment corruption, duplicate orders, data loss, platform outage.
High: major ordering flow, authorization bypass, widespread checkout.
Medium: important degradation with workaround.
Low: minor UI/content.

## Reporting
Environment, commit/build, suite, test, status, duration, failure reason, artifacts/logs.

## Completion
Acceptance criteria have verification and important negative/security cases are covered.
