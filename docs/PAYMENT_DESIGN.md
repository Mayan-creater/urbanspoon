# Urban Spoon — Payment Design

States and transitions for intents, payment attempts, and refunds are defined in [STATE_MACHINES.md](STATE_MACHINES.md).

## MVP Flow

1. Create an order intent with server-calculated items, charges, totals, and an address snapshot.
2. Create a provider payment attempt linked to the intent.
3. Treat the provider redirect and any client-reported result as untrusted hints.
4. Verify the payment through the provider API or a signed webhook.
5. On successful verification, the server revalidates and confirms the intent in one transaction, creating exactly one order. The client never confirms.
6. If revalidation fails (restaurant closed, item unavailable, address no longer serviceable), the intent is voided and a full refund is created automatically.
7. Reconcile orphaned successes, late and duplicate payments, failures, and timeouts.

## Payment Methods

The MVP supports online prepaid methods offered by the selected provider (UPI, cards, net banking, wallets). Cash on delivery is deferred to Phase 2 because it needs its own confirmation path (no verified payment), cash reconciliation with delivery partners, and fraud limits.

## Invariants

- Amount, currency, merchant, and order intent must match provider data.
- One successful payment can confirm at most one order (enforced by unique `orders.confirming_payment_attempt_id`).
- An intent's items and charges are frozen when the intent is created; the cart can change afterwards without affecting the amount being paid.
- Every retry uses an idempotency key; webhooks are deduplicated by provider event ID.
- Refunds are authorized, recorded, provider-idempotent, and reconciled. Partial refunds never exceed the captured amount in total.
- Raw card data is never stored by Urban Spoon. Use the provider's hosted checkout so card data never touches Urban Spoon servers.

## Intent Expiry

An intent's payment window is configurable (default 15 minutes). Expiry is applied by a scheduled job. A payment that succeeds after expiry, or a second successful payment for the same intent, is refunded automatically and never creates an order.

## Tax, Fee, and Commission Rules

The pricing service evaluates effective, scoped rules in this order: item and
customization prices, promotion discount, delivery fee, packaging fee,
platform/service fee, tip, and applicable taxes. Each charge is recorded as an
`order_intent_charges` row with its type, amount, currency, taxable flag, and
the source rule ID and version, and is copied unchanged to `order_charges` at
confirmation.

Tax rules are selected from the delivery jurisdiction and effective date, and
define which charge types they apply to. Fee rules may be scoped to platform,
restaurant, delivery zone, membership, or payment method, and may vary by order
value through tiers. Every rule defines its rounding mode, minimum and maximum
bounds, stacking behaviour, and whether the amount is taxable. Editing a rule
creates a new version, so a change affects new intents only and confirmed
orders keep their snapshot.

GST treatment for restaurant services sold through the platform, including
which party collects and remits tax, must be confirmed with a tax adviser and
encoded as tax rules before launch.

Restaurant commission is calculated from the versioned rule effective at the
order delivery timestamp and recorded on each settlement item with the rule
version used. Commission is never shown to customers as a charge. Restaurant
discounts and successful refunds are deducted only when explicitly attributed to
the restaurant; delivery/service fees, tax, and courier tips are excluded from
the settlement basis.

## Settlements and Payouts

Restaurant settlements aggregate delivered orders for a period, less commission
and adjustments (including refunds attributable to the restaurant). Delivery
partner earnings are recorded per delivery in `partner_earnings` and paid out
through `partner_payouts`. Both require approval before payout and are audited.
In the sandbox, refund approval/retry queues state only; it does not execute a
provider call or move funds. Marking a settlement paid records an external
transfer reference and likewise does not initiate a transfer.

## Operations

Provider adapters normalize status, reference, amount, currency, and failure codes. A reconciliation job compares local and provider records, applies only the transitions defined in the state machines, and raises exceptions for manual review. It never silently changes an order state.
