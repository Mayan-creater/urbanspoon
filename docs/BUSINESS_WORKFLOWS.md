# Urban Spoon — Business Workflows

States and transitions referenced here are defined in [STATE_MACHINES.md](STATE_MACHINES.md).

## Order and Payment

1. Customer selects a serviceable restaurant and server-validates the cart.
2. Checkout preview calculates taxes, fees, discounts, and total.
3. An order intent snapshots the cart items, charges, address, and total.
4. A payment attempt is created and verified independently with the provider.
5. On verification, the server revalidates and confirms the intent exactly once into an order. If revalidation fails, the intent is voided and refunded in full automatically.
6. Restaurant accepts or rejects within the acceptance window; rejection or timeout triggers an automatic full refund.
7. Restaurant prepares the order; dispatch offers the delivery to an eligible partner ahead of readiness.
8. Partner picks up and completes delivery using required proof/OTP.
9. Customer receives status updates and may review only an eligible completed order.

## Cancellation and Refund

Eligibility depends on order state, actor, and reason, as listed in the refund policy table in the state machines. Automatic refunds (voided intents, late or duplicate payments, restaurant rejection or cancellation, customer cancellation before acceptance) are submitted immediately. Other refunds are requested by support or admin and approved by a second person. The backend submits an idempotent provider request and reconciles failures through a retryable job.

## Dispatch

See [DELIVERY_SYSTEM.md](DELIVERY_SYSTEM.md). The dispatch worker selects eligible partners within the serviceable zone, sends an expiring offer, and moves to the next candidate on rejection or timeout. Every assignment decision is auditable.

## Admin and Support

Administrative actions require scoped permissions, show before/after values where relevant, and write audit records. Support agents act through cases and cannot bypass payment, authorization, or state-transition policies.

## Failure Recovery

Payment callbacks, job retries, provider timeouts, duplicate requests, notification failures, and partial delivery failures are handled through idempotency keys, deduplicated webhook events, durable events, reconciliation jobs, and explicit customer/support outcomes.
