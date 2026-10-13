# Urban Spoon — Features and User Stories

## Story Format
**As a [role], I want [capability], so that [benefit].**

## Customer
### US-C01 Registration
Register securely using supported identity information.
**Acceptance:** valid registration succeeds; invalid data rejected; duplicate identity handled; verification enforced where configured; sensitive data protected.

### US-C02 Login
Securely log in.
**Acceptance:** valid credentials authenticate; invalid credentials are safe; protected resources require authentication.

### US-C10 Discovery
See serviceable nearby restaurants.
**Acceptance:** serviceable restaurants shown; distance/ETA available where supported; unavailable state clear.

### US-C11 Search
Search restaurants, cuisines, and food.
**Acceptance:** relevant results; empty state; normal spelling variation where supported.

### US-C12 Filters
Filter by cuisine, dietary preference, price, rating, distance, ETA, offers, availability.
**Acceptance:** filters apply/remove correctly and combine consistently.

### US-C20 Restaurant View
View restaurant information, hours, ratings, serviceability, menu.
**Acceptance:** only active/serviceable restaurants are shown as orderable; hours, fees, serviceability, menu, and unavailable states are accurate; unauthorized private data is excluded.
### US-C21 Customization
Select variants/add-ons.
**Acceptance:** required choices enforced; optional choices work; price updates; server revalidates.

### US-C30 Cart
Add/remove/change quantities.
**Acceptance:** quantities/totals correct; invalid values rejected; restaurant conflicts handled.

### US-C31 Smart Portable Cart (Phase 2)
Share a cart safely.
**Acceptance:** uses the group-order mechanism; join tokens are single-use and stored hashed; participants must be authenticated; permitted information only; owner controls final submission; expired/invalid shares rejected.

### US-C32 Group Order (Phase 2)
Invite participants to contribute.
**Acceptance:** secure join; every item records the participant who added it; only the host can lock and check out; server validation.

### US-C40 Checkout
See complete price.
**Acceptance:** subtotal, discount, fees/taxes, final total visible; server recalculates.

### US-C41 Payment
Pay using supported method.
**Acceptance:** initiation; success/failure with retry until the intent expires; server-side provider verification and confirmation; duplicate callbacks cannot duplicate orders; late or duplicate payments are refunded automatically; if the order cannot be confirmed after payment, the customer sees that a full refund was issued.

### US-C50 Place Order
Receive confirmed order.
**Acceptance:** unique ID; order-time snapshots; confirmation; restaurant notification.

### US-C51 Track Order
See accurate order progress and ETA where available.
**Acceptance:** only the order owner or authorized support/admin can view it; statuses follow the server state machine; ETA is labeled unavailable when the provider cannot calculate it; updates tolerate refresh and retry.
### US-C52 Cancel Order
Cancel eligible order.
**Acceptance:** self-cancellation is allowed only before the restaurant accepts, with an automatic full refund; after acceptance the customer is directed to support; reason captured where required; refund follows the policy in STATE_MACHINES.md.

## Restaurant
### US-R01 Onboarding
Submit business and verification information.
**Acceptance:** required business fields and documents validate; duplicate submissions are handled; status is visible; private documents are access-controlled; approval is audited.
### US-R02 Menu
Create/edit/disable/categorize/price items.
**Acceptance:** scoped staff can manage only their restaurant; prices use valid minor units; required options validate; changes are audited and unavailable items cannot enter new orders.
### US-R03 Orders
Accept/reject and update preparation status.
**Acceptance:** only valid state transitions succeed; rejection requires a reason; duplicate actions are idempotent; customer and delivery notifications reflect the committed state.
### US-R04 Availability
Control hours and item availability.
**Acceptance:** closed or out-of-zone restaurants cannot receive normal orders; item availability is enforced at preview, intent, and confirmation; schedule changes are auditable.
### US-R05 Analytics
View orders, revenue, item, rating, and operational metrics.
**Acceptance:** metrics are scoped to the restaurant and date range; money reconciles to settled orders; empty and delayed-data states are explicit.

## Delivery
### US-D01 Online
Become available.
**Acceptance:** only verified partners can go online; availability changes are authenticated, idempotent, timestamped, and reflected in dispatch eligibility.
### US-D02 Assignment
Receive eligible delivery assignments.
**Acceptance:** assignment details reveal only operationally required data; offers expire; acceptance is race-safe; unavailable or already-assigned partners cannot accept.
### US-D03 Pickup
Confirm pickup.
**Acceptance:** pickup is allowed only for the assigned delivery in a pickup-ready state; duplicate confirmation is safe; timestamp and actor are recorded.
### US-D04 Completion
Complete delivery with required verification/proof.
**Acceptance:** required OTP/proof validates; only the assigned partner or authorized operations role can complete; completion is idempotent and auditable.
### US-D05 Earnings
View completed delivery earnings.
**Acceptance:** earnings include only eligible completed deliveries; adjustments are visible; data is scoped to the partner and supports a deterministic date range.

## Admin
### US-A01 Users
Manage users according to permission.
**Acceptance:** admin permissions and scope are enforced; sensitive changes require a reason; role/status changes are audited; private data is minimized.
### US-A02 Restaurants
Review/approve/suspend/configure restaurants.
**Acceptance:** approval requires required verification; suspension records reason and effective time; restaurant owners cannot approve themselves; actions are auditable.
### US-A03 Orders
Inspect operational orders.
**Acceptance:** filters and pagination are deterministic; private data is redacted by permission; admin actions use the same state and refund policies as customer actions.
### US-A04 Promotions
Configure promotions.
**Acceptance:** rules validate type, dates, scope, limits, stacking, and currency; changes are versioned/audited; disabled or expired promotions cannot apply.
### US-A05 Reports
View business/operational reports.
**Acceptance:** report scope and date boundaries are explicit; totals identify pending/refunded values; exports protect sensitive data and are access-controlled.
### US-A06 Audit
Privileged actions are auditable.
**Acceptance:** actor, permission, target, timestamp, request/correlation ID, and before/after values are recorded where applicable; audit records are append-only to normal users.

## Loyalty/Membership
### US-L01 Earn
Earn eligible loyalty points/coins.
**Acceptance:** earning rules are versioned and deterministic; points are granted once per eligible order; reversals create compensating transactions.
### US-L02 Redeem
Redeem eligible benefits.
**Acceptance:** balance, expiry, eligibility, and concurrency are validated server-side; redemption is atomic and auditable.
### US-L03 Membership
View membership status and benefits.
**Acceptance:** status and benefits reflect effective dates and payment state; expired or cancelled memberships do not grant benefits.

## Reviews
### US-V01 Review
Review eligible completed orders.
**Acceptance:** eligibility, rating validation, abuse controls, moderation/reporting.

## Support
### US-S01 Support Case
Create an order/account/payment support case.
**Acceptance:** authenticated users can create cases for resources they own; category and priority validate; duplicate submissions are safe; sensitive fields are protected.
### US-S02 Resolve
Support agent can inspect relevant data and record resolution.
**Acceptance:** access is case-scoped; refund or account actions require explicit permission; resolution notes and customer-visible outcome are audited.

## AI
### US-AI01 Food Assistant
Ask natural-language food questions.
**Acceptance:** respects serviceability/availability; uses available data; does not invent facts; protects sensitive data.

### US-AI02 Meal Planner
Generate suggestions from supplied preferences/constraints.
**Acceptance:** constraints are validated; unavailable items are excluded or labeled; total estimates come from server data; no cart/order mutation occurs without confirmation.
### US-AI03 Review Analysis
Summarize actual review themes with traceability.
**Acceptance:** only eligible review data is used; summaries link to source reviews or an evidence set; sensitive content is filtered; failed analysis is reported clearly.
### US-AI04 Menu Assistant
Suggest menu descriptions/tags.
**Acceptance:** restaurant scope is enforced; generated content is marked as draft; unsupported nutrition or health claims are not presented as verified; owner approval is required.
### US-AI05 Voice Ordering
Use voice to assist search/order workflows.
**Acceptance:** transcript and proposed actions are reviewable; ambiguity requires clarification; final order requires explicit confirmation; no voice input bypasses authorization or pricing validation.

## Corporate
### US-CORP01 Company Account
Configure organization.
**Acceptance:** organization ownership and member roles are scoped; invitations expire; configuration changes are audited.
### US-CORP02 Employee Allowance
Define budgets/policies.
**Acceptance:** budgets, periods, categories, and limits validate; policy decisions are server-enforced before payment; overrides require permission and audit.
### US-CORP03 Reporting
View approved reports/invoices.
**Acceptance:** reports include only authorized organization data; invoice totals reconcile to orders and refunds; exports are access-controlled.

## Events/Catering
### US-E01 Event Request
Submit event requirements.
**Acceptance:** guest count, date, location, budget, and dietary constraints validate; request status and permitted attachments are visible.
### US-E02 Quote
Providers submit quotations.
**Acceptance:** only verified eligible providers can quote; quote expiry, currency, taxes, inclusions, and revisions are explicit; submissions are auditable.
### US-E03 Accept Quote
Customer compares and accepts eligible quote.
**Acceptance:** only the requester can accept; expired or withdrawn quotes cannot be accepted; acceptance creates one traceable commitment and payment workflow.

## Home Food/Tiffin
### US-H01 Provider Onboarding
Provider onboards subject to verification.
**Acceptance:** required identity, food-safety, and business checks are recorded; unverified providers cannot sell; documents are private and approval is audited.
### US-H02 Subscription
Customer subscribes to recurring meals.
**Acceptance:** schedule, address, skip/pause/resume, price, renewal, cancellation, and failed-payment behavior are explicit; duplicate renewals cannot create duplicate charges.

## Cross-Cutting Acceptance
Important features must consider authentication, authorization, validation, auditability, loading/error/empty states, retry behavior, accessibility, responsive design, performance, security, and automated tests.
