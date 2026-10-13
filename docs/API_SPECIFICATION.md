# Urban Spoon — API Specification

## Principles

Use a documented HTTP/JSON API unless another style is explicitly selected. Version public APIs, use consistent authentication/errors, validate server-side, paginate large lists, and use idempotency for retry-sensitive operations. State changes follow [STATE_MACHINES.md](STATE_MACHINES.md); action endpoints map to named transitions rather than accepting an arbitrary target status.

Endpoints marked _(Phase 2)_ or _(Phase 3)_ are part of the contract but are not built for the MVP. See [ROADMAP.md](ROADMAP.md).

## Base

`/api/v1`

## Authentication

```text
POST /auth/register
POST /auth/login
POST /auth/logout
POST /auth/refresh
POST /auth/verify
POST /auth/verify/resend
POST /auth/forgot-password
POST /auth/reset-password
GET  /me
PATCH /me
```

M1 registration uses email and password; phone is optional profile data. Email
verification uses a six-digit, single-use code delivered through the configured
SMTP adapter. Codes expire and failed attempts are limited. Login is allowed
only after email verification. Successful verification and login issue an
opaque, seven-day `HttpOnly`, `SameSite=Lax` session cookie; only a hash of the
session token is stored. Logout revokes the session, refresh rotates its token,
and password reset revokes all existing sessions. Authentication and
verification routes are rate-limited.

## Customer

```text
GET    /restaurants
GET    /restaurants/{restaurantId}
GET    /restaurants/{restaurantId}/menu
GET    /search
GET    /categories
GET    /discovery/facets
GET    /favorites/restaurants
POST   /favorites/restaurants/{restaurantId}
DELETE /favorites/restaurants/{restaurantId}
GET    /addresses
POST   /addresses
PATCH  /addresses/{id}
DELETE /addresses/{id}
GET    /carts
POST   /carts
GET    /carts/{cartId}
DELETE /carts/{cartId}
POST   /carts/{cartId}/items
PATCH  /carts/{cartId}/items/{itemId}
DELETE /carts/{cartId}/items/{itemId}
POST   /promotions/validate
POST   /checkout/preview
```

Each customer owns one cart at a time; changing restaurants requires clearing
the current cart. Cart lines belong to currently available menu items and store
the selected customization IDs and display snapshots. The server enforces each
option group's minimum/maximum selections and rechecks current options, menu
availability, restaurant hours, and address serviceability at checkout preview.
Preview pricing is recalculated from current menu prices; client-submitted
prices are never accepted.

`POST /checkout/preview` accepts `cartId` and optional `addressId` and
`couponCode`. It returns line calculations, item subtotal, coupon discount,
versioned delivery/packaging/service fees, applicable taxes, total, and the
pricing-rule IDs/versions used. Coupon preview does not reserve or consume a
usage; usage must be atomically claimed by the M5 order-intent flow.

Checkout pricing rules are versioned. Create a new version with
`POST /admin/pricing-rules` (`admin.pricing.manage`); publishing a version
deactivates the prior active version for that key. Manage basic coupons with
`GET/POST /admin/coupons` and `POST /admin/coupons/{id}/disable`, guarded by
`admin.promotions.manage`. Coupon percentage values and pricing percentages are
basis points; fixed values and order thresholds use minor currency units.
Demo pricing/tax rules are enabled only by the opt-in local demo seed. GST and
production fee values require approved configuration and tax-adviser review.

`GET /restaurants` and `GET /search` accept `query`, `city`, `cuisine`,
`category`, `dietary`, `minPriceMinor`, `maxPriceMinor`, `minRating`,
`maxEtaMinutes`, `hasOffer`, `availability`, `latitude`, `longitude`,
`maxDistanceKm`, `sort`, `limit`, and `offset`.
Search matches restaurant details and available menu-item text. Queries of at
least three characters also use PostgreSQL trigram similarity for ordinary
spelling errors. Filter clauses combine; category, dietary, and price
constraints must match an eligible menu item. A location must include both
coordinates. Nearby results are limited by
both the requested distance and each restaurant's configured service radius.
Location is used only for the request and is not stored for the customer.
`GET /discovery/facets` returns active cuisine, menu-category, and dietary-tag
values. Price bounds use minor currency units; the default result limit is 50.
`minRating` filters sourced 0-5 rating snapshots; `maxEtaMinutes` filters by
the restaurant-provided maximum estimate; `hasOffer=true|false` checks current
offers within their active validity windows. Rating and ETA sorts place missing
values after restaurants with known values.

Favorites require an authenticated session. Adding a favorite is idempotent
per user and restaurant; deleting a missing favorite succeeds without exposing
another user's saved list. Rating snapshots require an admin with
`admin.restaurants.manage`, record source/count, and create an audit event. ETA
bounds are partner-provided estimates, not courier-tracked promises. Partner
offers include terms and redemption instructions but do not change checkout
totals or create coupon redemptions.

## Order Intents and Payments

```text
POST /orders/intents
GET  /orders/intents/{id}
POST /orders/intents/{id}/cancel
POST /orders/intents/{id}/payment-attempts
GET  /payment-attempts/{id}
POST /payment-attempts/{id}/verify
POST /webhooks/payments/sandbox
POST /test/payments/{attemptId}/complete (test mode only)
GET  /orders
GET  /orders/{id}
POST /orders/{id}/cancel
```

`POST /orders/intents` requires an `Idempotency-Key` header (16-128
characters). The server obtains a fresh checkout preview, stores its immutable
item/charge/address/total snapshot, and returns the same intent on retry with
the same key for that customer. A coupon's limited usage is reserved in the
same transaction as intent creation; it is consumed only when an order is
confirmed and released when checkout expires, is cancelled, or is voided.

`POST /orders/intents/{id}/payment-attempts` requires its own
`Idempotency-Key`. The current adapter is named `sandbox` and is available only
when `NODE_ENV=test`; it returns a local test checkout URI and handles no card
data. `POST /test/payments/{attemptId}/complete` is also unavailable outside
test mode. It simulates success/failure by generating a signed webhook; it
does not accept a client-provided payment result as proof of payment.

`POST /webhooks/payments/sandbox` is the sandbox provider webhook endpoint. It
requires `X-Payment-Signature`, an HMAC-SHA256 signature over the normalized
event fields. The API checks the signature and matches provider reference,
intent, attempt, amount, and currency before recording success. Webhook event
IDs are unique per provider; retries and concurrent duplicate deliveries do
not create a second order. Invalid signatures and mismatched payment details
are rejected and recorded. This endpoint is test-mode-only; the sandbox secret
is `TEST_PAYMENT_WEBHOOK_SECRET` (with a test-only fallback for automated
tests).

An order intent snapshots the server-calculated items, charges, address, and
total before payment. Payment attempts belong to exactly one intent.

The server confirms an intent as soon as it has verified a successful payment
through the signed webhook. Confirmation rechecks restaurant orderability,
menu-item and selected-option availability, and delivery serviceability, then
atomically creates one order from the immutable snapshot and writes initial
status history. If revalidation fails, the intent is voided and the sandbox
provider executes a full refund. The verify endpoint is a client hint after
the provider redirect; it ignores any request body and returns the persisted
server-verified attempt state. There is no client confirmation endpoint. The
client polls `GET /orders/intents/{id}` until the intent reaches a terminal
state; a `CONFIRMED` intent includes its order summary.

Webhook handlers verify the provider signature, deduplicate on the provider
event ID, and are idempotent. Late captures after cancellation/expiry and
payments from a second successful attempt are refunded automatically; late
refunds are linked to the intent when no order exists. Refunds retain status,
provider reference, amount, and reason. No raw payment credentials are
accepted or stored.

## Orders and Tracking

```text
GET  /orders
GET  /orders/{id}
GET  /orders/{id}/tracking
GET  /orders/{id}/events
POST /orders/{id}/cancel
```

`/orders/{id}/events` is a Server-Sent Events stream of order and delivery
status changes. Clients fall back to polling `/orders/{id}/tracking` when the
stream is unavailable. These tracking and streaming endpoints are planned and
not yet implemented. Customer order listing, details, and cancellation are
implemented; cancellation is allowed only before restaurant acceptance and
executes a full sandbox refund.

## Group Orders and Shared Carts (Phase 2)

```text
POST   /group-orders
POST   /group-orders/{id}/invites
POST   /group-orders/join
GET    /group-orders/{id}
POST   /group-orders/{id}/items
PATCH  /group-orders/{id}/items/{itemId}
DELETE /group-orders/{id}/items/{itemId}
POST   /group-orders/{id}/lock
POST   /group-orders/{id}/checkout
```

A shared Smart Portable Cart and a group order use this one mechanism. The
host creates a group order from their cart and receives a join link containing
a single-use token; the token is stored only as a hash. Participants must be
authenticated to join or add items, and every item records who added it. Only
the host can lock the group order and start checkout.

Each invite is independently single-use. Group item writes and invite issuance
serialize against host locking; checkout is created through the normal server-
priced order-intent flow and uses a stable group-scoped idempotency key.

## Restaurant Partner

```text
GET    /partner/restaurants
POST   /partner/restaurants
GET    /partner/restaurants/{restaurantId}
PATCH  /partner/restaurants/{restaurantId}
PUT    /partner/restaurants/{restaurantId}/hours
GET    /partner/restaurants/{restaurantId}/offers
POST   /partner/restaurants/{restaurantId}/offers
POST   /partner/restaurants/{restaurantId}/offers/{offerId}/disable
GET    /partner/restaurants/{restaurantId}/menu
POST   /partner/restaurants/{restaurantId}/menu/categories
PATCH  /partner/restaurants/{restaurantId}/menu/categories/{id}
POST   /partner/restaurants/{restaurantId}/menu/items
PATCH  /partner/restaurants/{restaurantId}/menu/items/{id}
POST   /partner/restaurants/{restaurantId}/menu/items/{id}/archive
PUT    /partner/restaurants/{restaurantId}/menu/items/{id}/availability
GET    /partner/restaurants/{restaurantId}/staff
POST   /partner/restaurants/{restaurantId}/staff
DELETE /partner/restaurants/{restaurantId}/staff/{userId}
GET    /partner/restaurants/{restaurantId}/orders
GET    /partner/restaurants/{restaurantId}/orders/{id}
POST   /partner/restaurants/{restaurantId}/orders/{id}/accept
POST   /partner/restaurants/{restaurantId}/orders/{id}/reject
POST   /partner/restaurants/{restaurantId}/orders/{id}/preparing
POST   /partner/restaurants/{restaurantId}/orders/{id}/ready
POST   /partner/restaurants/{restaurantId}/orders/{id}/cancel
GET    /partner/restaurants/{restaurantId}/events
GET    /partner/restaurants/{restaurantId}/settlements
```

`GET /partner/restaurants` lists the restaurants the caller holds a role for.
`POST /partner/restaurants` starts onboarding. Every other route checks that
the caller's role assignment is scoped to `{restaurantId}`. `events` is a
Server-Sent Events stream of new and changed orders.

Restaurant order routes are implemented for listing and details plus named
accept, reject, preparing, ready, and cancel transitions. Each transition is
conditional on the current state and records an actor, reason, status history,
and audit log entry. Reject and restaurant-cancel actions require a reason and
execute an automatic full sandbox refund. These routes require the scoped
`restaurant.orders.manage` permission. Real-time partner `events` streaming
remains planned.

Restaurant submissions start in `PENDING`, and the submitting owner receives
a scoped owner assignment in the same transaction. An administrator with
`admin.restaurants.manage` approves a pending restaurant through
`POST /admin/restaurants/{restaurantId}/approve`; owners cannot approve their
own submissions. Restaurant hours replace all seven local weekdays atomically.
Public browse and menu responses include only approved restaurants, omit
private contact fields, and calculate current orderability from the restaurant
timezone, its order pause setting, and its weekly hours.

## Delivery Partner

```text
POST  /delivery/onboarding
GET   /delivery/profile
PATCH /delivery/partners/{partnerId}/availability
GET   /delivery/partners/{partnerId}/offers
POST  /delivery/partners/{partnerId}/offers/{assignmentId}/accept
POST  /delivery/partners/{partnerId}/offers/{assignmentId}/reject
GET   /delivery/partners/{partnerId}/active
POST  /delivery/partners/{partnerId}/active/arrived-at-restaurant
POST  /delivery/partners/{partnerId}/active/pickup
POST  /delivery/partners/{partnerId}/active/arrived
POST  /delivery/partners/{partnerId}/active/complete
POST  /delivery/partners/{partnerId}/active/fail
POST  /delivery/partners/{partnerId}/active/release
POST  /delivery/partners/{partnerId}/location
GET   /delivery/partners/{partnerId}/earnings
POST  /delivery/partners/{partnerId}/payouts
GET   /delivery/partners/{partnerId}/payouts
GET   /delivery/partners/{partnerId}/events (SSE)
GET   /orders/{orderId}/tracking
GET   /orders/{orderId}/events (SSE)
GET   /admin/delivery-partners?status=PENDING
POST  /admin/delivery-partners/{partnerId}/review
POST  /admin/deliveries/{deliveryId}/dispatch
GET   /admin/partner-payouts?status=REQUESTED
POST  /admin/partner-payouts/{payoutId}/approve
POST  /admin/partner-payouts/{payoutId}/reject
POST  /admin/partner-payouts/{payoutId}/mark-paid
```

Onboarding creates a `PENDING` profile and provider-scoped
`delivery_partner` role. Only an administrator with `admin.dispatch.manage` can
verify or reject it. Rejection requires a reason. Admin review can record a
manual decision or an external provider/reference. The current onboarding form
captures vehicle type but does not collect identity documents or integrate a
licensed KYC provider. Never put identity numbers or document data in the
reference/reason fields.

Every partner operation checks the authenticated user's profile and the
provider-scoped `delivery.self.manage` grant. Going online requires a verified
profile. Accepting an offer conditionally claims the partner's `ONLINE` slot
and the delivery in one transaction; one partner cannot accept multiple
deliveries concurrently. Restaurant acceptance creates a delivery. The
restaurant accept route accepts optional `prepTimeMinutes=5..120`; it defaults
to 20. The dispatcher begins offers at the configured prep lead time (10
minutes by default), selects the nearest eligible online partner with a recent location,
and advances after rejection or expiry. Offer expiry and due dispatch are
swept every ten seconds; administrators can force dispatch.

Arrival, pickup, delivery, failure, and release are named transitions with
status history and audit records. Pickup synchronizes the order to
`PICKED_UP`; completion requires the six-digit customer delivery code and
synchronizes the order to `DELIVERED`. The code is returned only by the owning
customer's tracking endpoint and is hidden after completion or failure.
Customer tracking returns only recent location updates; stale or missing
locations are reported as unavailable.

Location updates are accepted only while the partner is online or busy, only
for that partner's active delivery when a delivery ID is supplied, and no more
than once every five seconds. Updates older than 30 days are deleted as new
locations arrive. A location heartbeat older than 90 seconds takes an
otherwise-online partner offline and excludes them from dispatch. The delivery
PWA sends foreground browser geolocation and does not cache authenticated API
data for offline use. The estimate shown on offers is straight-line distance
and average-speed time, not a road-route estimate. Partner and customer SSE
endpoints send authorized state snapshots every five seconds; polling remains
the fallback. Partners can request idempotent payouts of available completed
earnings. Operations may approve/reject a request; marking it paid requires a
reference for an externally completed transfer. The API does not execute
transfers. Distance/incentive/tip earning calculations are not implemented.

## Uploads

```text
POST   /uploads/presign
POST   /uploads/{id}/complete
DELETE /uploads/{id}
```

Uploads are private by default. The server validates owner, purpose, size,
content type, extension, malware-scan status, and access scope before issuing
or serving an object URL.

## Reviews

```text
POST  /reviews
GET   /reviews/mine
GET   /restaurants/{restaurantId}/reviews
POST  /reviews/{reviewId}/reports
GET   /admin/reviews?status=PENDING|PUBLISHED|HIDDEN|REJECTED|REPORTED
PATCH /admin/reviews/{reviewId}/moderation
```

Reviews require a customer-owned delivered order and an `Idempotency-Key` header. New reviews remain pending until moderation; public restaurant results include published reviews only. Reporting is idempotent per review/customer. Moderation actions are audited and require `admin.reviews.moderate`.

## Support

```text
POST /support/cases
GET  /support/cases
GET  /support/cases/{caseId}
POST /support/cases/{caseId}/messages
GET  /support/agent/cases
POST /support/agent/cases/{caseId}/claim
GET  /support/agent/cases/{caseId}
POST /support/agent/cases/{caseId}/messages
POST /support/agent/cases/{caseId}/resolve
```

Case creation requires an `Idempotency-Key`. Order/payment/delivery cases must reference an order owned by the customer. Agents can read details only after claiming a case; internal notes are excluded from customer responses. Resolution stores an internal summary and a customer-visible outcome. Refunds are not executed through these routes.

## Admin

```text
GET   /admin/dashboard
GET   /admin/reports
GET   /admin/reports/export
GET   /admin/users
PATCH /admin/users/{id}/status
POST  /admin/users/{id}/roles
DELETE /admin/users/{id}/roles/{assignmentId}
GET   /admin/restaurants
PATCH /admin/restaurants/{id}
POST  /admin/restaurants/{id}/approve
PUT   /admin/restaurants/{id}/rating
POST  /admin/restaurants/{id}/suspend
GET   /admin/orders
POST  /admin/orders/{id}/cancel
GET   /admin/payment-attempts
GET   /admin/refunds
POST  /admin/refunds
POST  /admin/refunds/{id}/approve
POST  /admin/refunds/{id}/reject
POST  /admin/refunds/{id}/retry
GET   /admin/promotions
POST  /admin/promotions
PATCH /admin/promotions/{id}
POST  /admin/promotions/{id}/disable
GET   /admin/tax-rules
POST  /admin/tax-rules
PATCH /admin/tax-rules/{id}
GET   /admin/fee-rules
POST  /admin/fee-rules
PATCH /admin/fee-rules/{id}
GET   /admin/commission-rules
POST  /admin/commission-rules
GET   /admin/settlements
POST  /admin/settlements/generate
POST  /admin/settlements/{id}/adjustments
POST  /admin/settlements/{id}/approve
POST  /admin/settlements/{id}/mark-paid
GET   /admin/partner-payouts
POST  /admin/partner-payouts/{id}/approve
GET   /admin/audit-logs
GET   /admin/pricing-rules
POST  /admin/pricing-rules
GET   /admin/coupons
POST  /admin/coupons
POST  /admin/coupons/{id}/disable
```

Tax and fee rule updates create new versions; they never modify a version that
existing snapshots reference. Commission versions are created with
`POST /admin/commission-rules`. Settlement generation
uses delivered timestamps in a half-open UTC period, creates one settlement per
currency, and snapshots the commission version and attributed refund adjustment.
Approval requires an actor other than the generator. `mark-paid` records an
external transfer reference only and does not initiate a transfer. Manual refund
approval/retry changes queue state only until a production provider is integrated.

## Dispatch and Zones

```text
GET   /delivery/zones
POST  /admin/delivery/zones
PATCH /admin/delivery/zones/{id}
GET   /admin/deliveries
POST  /admin/deliveries/{deliveryId}/dispatch
POST  /admin/deliveries/{deliveryId}/reassign
POST  /admin/deliveries/{deliveryId}/fail
```

## AI (Phase 3)

```text
POST /ai/food-assistant
POST /ai/meal-plan
POST /ai/review-analysis
POST /ai/menu-assistant
POST /ai/voice-intent
```

## Response Format

Success:

```json
{ "data": {}, "meta": {} }
```

Error:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request could not be processed.",
    "details": []
  }
}
```

Do not expose internal stack traces. An invalid state transition returns `409`
with code `INVALID_STATE_TRANSITION`.

## Pagination

Use query parameters such as `?page=1&pageSize=20`. Return pagination metadata where practical.

## HTTP Semantics

GET retrieval; POST creation/actions; PATCH partial updates; PUT full replacement; DELETE where appropriate. Use appropriate status codes.

## Authorization

Every protected endpoint must have a documented role/permission requirement.
Permissions are defined in [USER_ROLES_AND_PERMISSIONS.md](USER_ROLES_AND_PERMISSIONS.md).
For the MVP, route groups use these minimum permissions:

| Route group                                                                         | Minimum permission and scope                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer profile, addresses, carts, intents, orders, tracking, reviews, and support | Authenticated customer acting on their own resources; order actions also require the current-state policy to allow them.                                                                                                                |
| `/partner/restaurants/{restaurantId}/…`                                             | Scoped to `{restaurantId}`: `restaurant.manage` for profile, hours, menu, and settlements; `restaurant.orders.manage` for orders and events; `restaurant.menu.availability` for item availability; `restaurant.staff.manage` for staff. |
| `/delivery/…`                                                                       | `delivery.self.manage`, scoped to the authenticated partner and their own offers and deliveries.                                                                                                                                        |
| Payment verification and webhooks                                                   | Verify: the intent's customer. Webhooks: provider signature only. Clients can never mark a payment successful.                                                                                                                          |
| `POST /orders/{id}/refunds`                                                         | `payment.refund`. Approval requires `payment.refund.approve` and a different user from the requester.                                                                                                                                   |
| `/admin/…`                                                                          | The specific admin permission for the resource, at platform scope.                                                                                                                                                                      |

Resource ownership, role scope, and state-transition policy are checked
server-side on every request. A route must not infer authorization from a
client-supplied user, restaurant, or role identifier. Server-Sent Events
streams apply the same checks when the stream opens.

## Idempotency

Required for order-intent creation, payment-attempt creation, refunds, refund
approval and retry, delivery offer acceptance, pickup, completion, and webhook
processing. Clients send an `Idempotency-Key` per logical operation; keys are
stored in `idempotency_keys`. Reusing a key with a different request payload
is rejected; retries return the original result. Webhooks are deduplicated by
provider event ID instead.

## Evolution

Avoid unnecessary breaking changes. Version breaking changes and document deprecations. Keep API/OpenAPI documentation synchronized.
