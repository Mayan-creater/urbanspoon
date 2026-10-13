# Urban Spoon — State Machines

This document is the single authoritative definition of MVP lifecycle states
and transitions. Other documents summarize or reference it and must not
redefine states. A change here requires matching updates to the database
design, API specification, and state-machine tests.

All transitions are enforced server-side, run inside a database transaction,
and write a status-history record containing actor, previous state, next
state, reason, and timestamp. Any transition not listed is invalid and must be
rejected.

## Order Intent

An order intent holds the priced, immutable checkout snapshot (items, charges,
address, totals) while the customer pays. It never becomes an order unless a
verified payment exists.

| From | To | Actor | Condition |
| --- | --- | --- | --- |
| — | `OPEN` | Customer | Checkout preview is valid; items, charges, address, and totals are snapshotted. |
| `OPEN` | `PAYMENT_PENDING` | Customer | A payment attempt is created. |
| `PAYMENT_PENDING` | `OPEN` | System | The attempt failed or was cancelled and the intent has not expired. The customer may retry with a new attempt. |
| `PAYMENT_PENDING` | `PAYMENT_VERIFIED` | System | The server verified a successful attempt through the provider API or a signed webhook, and amount, currency, merchant, and intent match. |
| `PAYMENT_VERIFIED` | `CONFIRMED` | System | Confirmation revalidation passes (restaurant open and serviceable, items available). The order is created in the same transaction. |
| `PAYMENT_VERIFIED` | `VOIDED` | System | Confirmation revalidation fails. A full automatic refund is created. |
| `OPEN`, `PAYMENT_PENDING` | `EXPIRED` | System | The payment window closes. |
| `OPEN` | `CANCELLED` | Customer | The customer abandons checkout. |

Terminal states: `CONFIRMED`, `VOIDED`, `EXPIRED`, `CANCELLED`.

Confirmation is performed by the server as soon as verification succeeds. The
client never confirms an intent; it polls or subscribes to the intent until it
reaches a terminal state.

**Late and duplicate payments.** If an attempt succeeds after its intent is
`EXPIRED` or `CANCELLED`, or if a second attempt succeeds on an intent that is
already `CONFIRMED` or `VOIDED`, the attempt is recorded as `SUCCEEDED`, the
intent does not change, and a full automatic refund is created with reason
`LATE_PAYMENT` or `DUPLICATE_PAYMENT`.

## Payment Attempt

| From | To | Condition |
| --- | --- | --- |
| — | `INITIATED` | Attempt created with the provider. |
| `INITIATED` | `PENDING` | The provider accepted the attempt and awaits customer action. |
| `INITIATED`, `PENDING` | `SUCCEEDED` | Server-side provider verification succeeded. |
| `INITIATED`, `PENDING` | `FAILED` | The provider reports failure or verification fails. |
| `INITIATED`, `PENDING` | `CANCELLED` | The customer or provider cancelled the attempt. |

Terminal states: `SUCCEEDED`, `FAILED`, `CANCELLED`. Refund progress is never
stored on the payment attempt; it is tracked only by refunds.

## Refund

| From | To | Actor | Condition |
| --- | --- | --- | --- |
| — | `REQUESTED` | Support/admin with `payment.refund` | A manual refund that policy requires to be approved. |
| — | `SUBMITTED` | System | An automatic refund (see the refund policy below). |
| `REQUESTED` | `SUBMITTED` | Approver with `payment.refund.approve` | The approver is not the requester. |
| `REQUESTED` | `REJECTED` | Approver with `payment.refund.approve` | A reason is required. |
| `SUBMITTED` | `SUCCEEDED` | System | The provider confirmed the refund. |
| `SUBMITTED` | `FAILED` | System | The provider rejected the refund or retries were exhausted. |
| `FAILED` | `SUBMITTED` | System or admin | Retry using the original idempotency key. |

Terminal states: `SUCCEEDED`, `REJECTED`. A payment may have several partial
refunds; the sum of non-rejected refunds can never exceed the captured amount.

## Order

An order exists only after an intent is `CONFIRMED`. Orders carry no payment
states.

| From | To | Actor | Condition |
| --- | --- | --- | --- |
| — | `CONFIRMED` | System | Created by intent confirmation. |
| `CONFIRMED` | `RESTAURANT_ACCEPTED` | Restaurant (`restaurant.orders.manage`) | Within the acceptance window. |
| `CONFIRMED` | `REJECTED_BY_RESTAURANT` | Restaurant, or System on acceptance timeout | A reason is required (`ACCEPTANCE_TIMEOUT` for the system). |
| `CONFIRMED` | `CANCELLED_BY_CUSTOMER` | Customer | Only before the restaurant accepts. |
| `RESTAURANT_ACCEPTED` | `PREPARING` | Restaurant | — |
| `PREPARING` | `READY_FOR_PICKUP` | Restaurant | — |
| `PREPARING`, `READY_FOR_PICKUP` | `PICKED_UP` | System | Driven by the delivery reaching `PICKED_UP`. Pickup from `PREPARING` implicitly marks the food ready and is recorded. |
| `PICKED_UP` | `DELIVERED` | System | Driven by the delivery reaching `DELIVERED`. |
| `PICKED_UP` | `DELIVERY_FAILED` | System | Driven by the delivery reaching `FAILED`. |
| `RESTAURANT_ACCEPTED`, `PREPARING`, `READY_FOR_PICKUP` | `CANCELLED_BY_RESTAURANT` | Restaurant | A reason is required (for example, an item cannot be fulfilled). |
| Any non-terminal state | `CANCELLED_BY_ADMIN` | Admin (`admin.orders.manage`) or support acting on a case | A reason is required. |

Terminal states: `DELIVERED`, `REJECTED_BY_RESTAURANT`,
`CANCELLED_BY_CUSTOMER`, `CANCELLED_BY_RESTAURANT`, `CANCELLED_BY_ADMIN`,
`DELIVERY_FAILED`. After acceptance, customers cannot self-cancel; they raise
a support case.

A replacement order after a terminal failure is a new intent and order created
through a documented support workflow; terminal orders are never reopened.

Delivery assignment is not an order state. Dispatch can begin while the food
is being prepared, so assignment progress is tracked on the delivery and
combined with the order state in the customer tracking view.

## Delivery

A delivery is created when the order reaches `RESTAURANT_ACCEPTED`.

| From | To | Actor | Condition |
| --- | --- | --- | --- |
| — | `PENDING_ASSIGNMENT` | System | Order accepted. |
| `PENDING_ASSIGNMENT` | `ASSIGNED` | System | A partner accepted an offer. |
| `ASSIGNED` | `PENDING_ASSIGNMENT` | Partner or operations | The assignment was released before pickup; dispatch re-offers. |
| `ASSIGNED` | `ARRIVED_AT_RESTAURANT` | Assigned partner | — |
| `ASSIGNED`, `ARRIVED_AT_RESTAURANT` | `PICKED_UP` | Assigned partner | Pickup proof is valid. |
| `PICKED_UP` | `ARRIVED` | Assigned partner | — |
| `PICKED_UP`, `ARRIVED` | `DELIVERED` | Assigned partner | The delivery OTP or configured proof validates. |
| `PICKED_UP`, `ARRIVED` | `FAILED` | Assigned partner or operations | A reason is required; a support workflow starts. |
| Any non-terminal state | `CANCELLED` | System | The order was cancelled. Active offers are withdrawn. |

Terminal states: `DELIVERED`, `FAILED`, `CANCELLED`.

## Delivery Assignment (Offer)

| From | To | Condition |
| --- | --- | --- |
| — | `OFFERED` | Dispatch selected the partner; the offer has an expiry. |
| `OFFERED` | `ACCEPTED` | The partner accepted before expiry and is still eligible. Race-safe: at most one accepted assignment per delivery. |
| `OFFERED` | `REJECTED` | The partner rejected the offer. |
| `OFFERED` | `EXPIRED` | The offer timed out. |
| `OFFERED` | `WITHDRAWN` | The system withdrew the offer (another partner accepted, or the order was cancelled). |
| `ACCEPTED` | `RELEASED` | The partner or operations released the assignment before pickup. |

Terminal states: `REJECTED`, `EXPIRED`, `WITHDRAWN`, `RELEASED`, and
`ACCEPTED` once the delivery reaches `PICKED_UP`.

## Cross-Machine Mapping

| Event | Effect |
| --- | --- |
| Delivery → `PICKED_UP` | Order → `PICKED_UP` |
| Delivery → `DELIVERED` | Order → `DELIVERED` |
| Delivery → `FAILED` | Order → `DELIVERY_FAILED` |
| Order → any cancelled or rejected state | Delivery → `CANCELLED`; open offers → `WITHDRAWN` |
| Intent → `VOIDED`, late payment, or duplicate payment | Automatic full refund created as `SUBMITTED` |

Customer tracking labels: `CONFIRMED` "Order placed", `RESTAURANT_ACCEPTED`
"Accepted", `PREPARING` "Preparing", `READY_FOR_PICKUP` "Ready", delivery
`ASSIGNED` "Delivery partner assigned", `PICKED_UP` "On the way", delivery
`ARRIVED` "Arriving", `DELIVERED` "Delivered".

## Refund Policy by Outcome

| Outcome | Refund |
| --- | --- |
| `VOIDED` intent, late payment, duplicate payment | Full, automatic |
| `REJECTED_BY_RESTAURANT`, `CANCELLED_BY_RESTAURANT` | Full, automatic |
| `CANCELLED_BY_CUSTOMER` (before acceptance) | Full, automatic |
| `CANCELLED_BY_ADMIN`, `DELIVERY_FAILED` | Full or partial according to the configured cancellation policy, requested through support |
| Post-delivery complaints (missing or wrong items) | Partial or full through a support case |
