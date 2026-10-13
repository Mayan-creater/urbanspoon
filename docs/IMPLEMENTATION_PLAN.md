# Urban Spoon — Implementation Plan

## Strategy

Build the transactional core outward. Do not start with advanced AI before ordering is reliable.

Work is organized into milestones M0–M12. Product phases are defined in [ROADMAP.md](ROADMAP.md): M0–M8 deliver the MVP, M9–M10 Phase 2, M11 Phase 3, and M12 Phases 4–5.

## M0 — Foundation

Repository structure, environment config, coding standards, CI basics, frontend/backend shells, database connection/migrations, logging, health endpoint, test framework.
**Exit:** app starts locally and baseline tests/CI pass.

## M1 — Identity/Roles

Registration, login, logout, verification, profiles, roles, authorization, addresses.
**Exit:** protected routes and role boundaries tested.

## M2 — Restaurant/Menu

Onboarding, profile, categories, items, options, availability, customer views.
**Exit:** restaurant can manage menu; customer can browse accurately.
**Delivered:** restaurant onboarding and duplicate protection; scoped partner profiles,
weekly hours, menu categories/items/options, availability and archival; audited
administrator approval; public discovery and menus with schedule-aware orderability.

## M3 — Discovery

Location, search, filters, sorting, restaurant cards, categories, favorites.
**Exit:** customer can discover serviceable restaurants.
**Implemented:** location-radius discovery, restaurant/menu search, cuisine,
category, dietary, price, rating, ETA, current-offer, and open/closed filters;
relevance/name/price/distance/rating/ETA sorting; live facets; authenticated
favorites; and trigram-backed spelling tolerance. Ratings are sourced,
admin-audited snapshots; ETAs are partner estimates; offers are informational
and do not change checkout prices.

## M4 — Cart/Checkout

Cart, customization, pricing, tax/fee rules, basic coupons, checkout preview.
**Exit:** server-authoritative totals and critical calculation tests.
**Implemented:** owner-scoped persistent cart and option selections; server
revalidation of menu/customization/address state; versioned fee/tax rules;
fixed and percentage coupons with minimums, caps, and usage limits; and a
customer checkout preview with a line-by-line authoritative total. Demo pricing
is opt-in and local-only; production tax and fees remain configuration-gated.

## M5 — Payments/Orders

Payment integration, order intents, verified payment attempts, server-side
confirmation, voiding and automatic refunds, restaurant acceptance/rejection,
state machines from [STATE_MACHINES.md](STATE_MACHINES.md), real-time order
events, notifications.
**Exit:** payment/order consistency and retry safety.
**Implemented sandbox slice:** immutable checkout-snapshot intents, per-customer
idempotency, coupon reservation/consumption/release, test-only sandbox payment
attempts, HMAC-verified and idempotent payment webhooks, retryable failed
attempts, atomic order confirmation, late/duplicate/voided-payment refunds,
customer order listing/details/pre-acceptance cancellation, and restaurant
accept/reject/prepare/ready/cancel operations with scoped permissions, status
history, and audit records. The simulator and webhook are disabled unless
`NODE_ENV=test`; no card data is accepted or stored.

**Remaining for production M5:** integrate and configure a real payment
provider, implement real-time order events/notifications and tracking, and
complete end-to-end validation against the chosen provider. The sandbox
adapter is not a production payment integration.

## M6 — Delivery

Partner onboarding, partner PWA, availability, dispatch offers, pickup, delivery, proof/OTP, location updates, earnings.
**Exit:** complete end-to-end order flow.
**Implemented:** delivery-partner onboarding with manual/external review, encrypted local identity/vehicle and delivery evidence, provider-scoped authorization, installable `/delivery` PWA, online/offline heartbeat, prep-aware timed dispatch, race-safe acceptance/reassignment, Google Routes with OSRM/straight-line fallback, delivery history, pickup and customer-code completion, failure/release, owner-scoped tracking, five-second location throttling/30-day retention, five-second SSE snapshots with polling fallback, itemized base/distance/incentive/cash-tip earnings, digital checkout tips persisted through payment totals and cancellation refunds, market-specific payout provider selection (Razorpay Route India, Stripe Connect US/EUR), disabled payout markets where no provider is selected, manual reconciliation and a non-production no-funds sandbox transfer, `/admin/delivery` operations queue, and desktop/mobile Playwright journeys.

**Remaining before production:** select/integrate HyperVerge or Signzy after evaluation; managed private object storage/scanning (deferred for now), retention and key rotation; validate Google coverage/billing for each market; connect recipient accounts and execute real Razorpay/Stripe transfers; select local payout providers for China/Russia; integrate a production card processor and confirm tip tax/refund policies. The current local evidence vault is single-node and encrypted at rest, the payout sandbox never moves funds, and the PWA reports foreground location only without caching private work offline.

## M7 — Reviews/Support

**Implemented:** one idempotent review per customer-owned delivered order, 1-5 rating/title/body validation, pending moderation, published restaurant reviews, one report per reviewer, audited publish/hide/reject actions, and report disposition. Customer support cases support order/payment/delivery/account/general topics, validated priority, owned-order checks, idempotent creation, customer-visible replies, internal agent notes, race-safe agent claiming, assigned-agent-only case details, and audited resolution with a customer-visible outcome. Added customer `/support` and operations `/admin/reviews-support` workspaces, support-agent/moderator permissions, and desktop/mobile E2E coverage.

**Boundary:** refund execution and account changes are not performed by support-case resolution; those actions remain on their existing finance/admin permission paths. Published reviews do not yet update imported restaurant rating snapshots.

## M8 — Admin/Analytics

Dashboards, users, roles, restaurants, orders, payment and refund operations, restaurant settlements, partner payouts, reports, and audit.

**Acceptance semantics:** Admin reports use UTC timestamps and half-open ranges (`from` inclusive, `to` exclusive), default to the trailing 30 days, and cap a range at 366 days. Dashboard and report totals remain grouped by currency. Order totals are reported by lifecycle status; delivered item subtotal is the GMV measure. Payments and refunds are reported separately by status and currency and are never silently netted into revenue. Paginated admin lists default to 50 rows and cap at 100; returned customer data is limited to operational identifiers and contact fields.

Restaurant settlements are generated once per restaurant and period from delivered orders only. The item snapshot records gross item subtotal, restaurant-funded discount, successful refund adjustment, commission basis, commission rule ID/version, and net amount; delivery/service fees, tax, and courier tips are excluded. Commission rules are effective-dated and versioned. A settlement is immutable after generation; corrections use explicit, reasoned adjustments. Approval requires a different actor from the generator, is audited, and records approval only: marking a settlement paid requires an external transfer reference and never initiates a transfer. Partner payout behavior retains the same manual-reconciliation/no-funds-sandbox boundary.

Payment operations are read-only except for state-machine-authorized refund actions. Manual refunds enter `REQUESTED`, require a distinct approver, and sandbox retries reuse the original idempotency key. Until a production payment provider is selected and integrated, no admin action may claim to have moved or returned real funds; sandbox execution is available only in test mode, and external reconciliation is explicitly recorded as such.

**Implemented:** permission-guarded dashboard and currency-separated reports; paginated user, order, payment, refund, settlement, and audit views; reasoned user status changes with session revocation; reasoned order cancellation; idempotent manual refund request/approval/rejection/retry state changes; versioned commission rules; settlement generation, explicit adjustments, separate-actor approval, external-transfer reconciliation; and a responsive `/admin` workspace.

**Browser acceptance:** fixture-driven desktop/mobile E2E covers dashboard/report export, user status change, order cancellation, refund request/approval/retry, settlement generation/adjustment/approval/external-transfer reconciliation, and audit visibility.

**Remaining for M8 exit:** complete regression/security review. A live card/refund/settlement provider remains a production integration gate; the current admin actions do not move funds.

## M9 — Loyalty/Promotions

**Implemented:** currency-scoped, effective-dated earning rules; append-only
points history; 365-day expiry; lifetime Bronze/Silver/Gold/Platinum thresholds
of 0/500/2,500/10,000 net points with 1.0x/1.1x/1.25x/1.5x earn multipliers;
customer wallet and tier; 1 point = 1 currency minor unit redemption; coupon and
FoodCoins non-stacking; locked payment-intent reservations; consume-on-confirm;
release-on-cancel/expiry; and idempotent successful-refund reversals/restoration.
Admin-configurable rate and effective dates have no implicit earning rate.

Campaign coupons are keyed and versioned, audited, currency/scope/date/minimum/
maximum/global-cap constrained, and support per-customer caps and first-order
eligibility. Checkout and intent creation recheck eligibility; intent reservations
are serialized per customer. A responsive admin campaign console creates and
disables versions.

FoodPass has versioned, effective-dated plans and customer/admin catalog/status
surfaces. Membership activation and benefits remain unavailable until a real
payment provider confirms payment; no sandbox action represents a paid plan.

**Remaining for production:** select and integrate a real recurring payment
provider; then implement provider-confirmed membership activation, renewal,
cancellation, and failed-payment transitions. More promotion types and a real
payment/refund settlement path remain separate provider/product gates.

## M10 — Differentiators

**Implemented slice:** a host starts a group from their existing restaurant cart;
host-issued invite tokens are random, stored hashed, single-use, and expire at
the group deadline or after 24 hours. Authenticated members can contribute menu
items, adjust/remove only their own contributions, and see participant names;
the host can manage all items, lock a non-empty group, and create the existing
authoritative order intent. Group item writes and invite issuance serialize with
the lock; legacy cart mutations stop after lock; host checkout is idempotent.
Customer UI supports create/join/share, group-mode restaurant menu additions,
participant attribution, locking, and checkout. Desktop/mobile Playwright covers
host and participant journeys.

**Remaining:** Smart Food Comparison, “Why This Restaurant?”, scheduled ordering,
cash on delivery, and the native delivery partner app. COD still requires the
confirmation, reconciliation, and fraud policies in [PAYMENT_DESIGN.md](PAYMENT_DESIGN.md).

## M11 — AI

AI Food Assistant, recommendations, meal planner, review analysis, menu assistant, Smart Cart, restaurant insights, and voice ordering. Delivered with provider-configurable, reviewable suggestions: customer food suggestions use current menus from open, serviceable restaurants; meal/voice-order totals and review/metric citations are validated against server data; Smart Cart inspects only the customer's cart and changes it only after explicit confirmation; partner insights aggregate authorized restaurant snapshots and published reviews; menu drafts require restaurant menu-management permission and explicit partner review; voice order proposals never place an order. Configure the OpenAI-compatible provider with `AI_API_BASE_URL`, `AI_API_KEY`, and `AI_MODEL`; see [AI_FEATURES.md](AI_FEATURES.md) for data-handling and acceptance details.

## M12 — Expansion

Event catering request and quote exchange delivered as the first Phase 4 vertical slice: customers submit event requirements and can withdraw open requests; active restaurants explicitly opt in, discover eligible same-city/cuisine requests, and submit expiring, currency-matched, revisioned quotations. Quotes are proposals only; acceptance/payment is not implemented until a catering payment and reconciliation policy is defined.

**Remaining:** Corporate accounts and spending policies; quote acceptance/payment; verified home-food providers and regulatory onboarding; tiffin schedules and recurring billing; multi-city configuration and optimization.

## Feature Cycle

1. Read requirements.
2. Plan.
3. Design data/API/UI.
4. Implement.
5. Add tests.
6. Run focused tests.
7. Run regression.
8. Run lint/typecheck/build.
9. Review security/accessibility.
10. Update docs.
11. Complete acceptance criteria.

## Vertical Slice Rule

Prefer complete vertical slices. Example: a menu-item feature should include database, API, backend validation, restaurant UI, customer UI, and tests rather than disconnected layers.

## MVP Release Gate

Core journeys pass; payment/order state tested; authorization tested; critical E2E passes; no secrets; migrations reviewed; backup/recovery plan; production configuration documented.
