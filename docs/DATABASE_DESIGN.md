# Urban Spoon — Database Design

## Goal

Use a relational transactional model (PostgreSQL with Prisma migrations) for core marketplace operations. Names are logical and may be adapted to Prisma conventions. Status columns use exactly the states defined in [STATE_MACHINES.md](STATE_MACHINES.md).

## Money

All money columns are integer minor units (paise for INR) stored as `BIGINT`, with an explicit `currency` column on every monetary record. Percentages and rates are stored in basis points. Never use floating-point for money.

## Identity and Access

- `users`: id, name, email, phone, status, timestamps
- `user_roles`: id, user_id, role, scope_type (`platform`, `restaurant`, `organization`, `provider`), scope_id, status, granted_by_user_id, timestamps
- `role_permissions`: role, permission — seeded by migration from the matrix in [USER_ROLES_AND_PERMISSIONS.md](USER_ROLES_AND_PERMISSIONS.md)
- `auth_credentials`: id, user_id, provider, password_hash, verified_at, timestamps
- `auth_sessions`: id, user_id, token_hash, expires_at, revoked_at, device metadata, timestamps
- `auth_verifications`: id, user_id, purpose, token_hash, expires_at, attempts, consumed_at, timestamps
- `password_resets`: id, user_id, token_hash, expires_at, attempts, consumed_at, timestamps
- `user_addresses`: id, user_id, label, address fields, latitude/longitude, notes, is_default

Verification and reset codes have bounded attempts and expire. A partial unique
index permits at most one default address per user.

Restaurant staff are `user_roles` rows with role `restaurant_staff` or `restaurant_owner` scoped to the restaurant; there is no separate staff table.

## Restaurants, Zones, and Menus

- `restaurants`: id, owner_user_id, name, description, cuisine, address, coordinates, delivery_zone_id, status, verification_status, fssai_license_number, timestamps
- `restaurant_hours`: id, restaurant_id, day_of_week, opens_at, closes_at
- `delivery_zones`: id, name, geometry, status, timestamps
- `menu_categories`: id, restaurant_id, name, sort_order, status
- `menu_items`: id, restaurant_id, category_id, name, description, price, currency, dietary_tags, image_upload_id, is_available, status (`ACTIVE`, `ARCHIVED`), timestamps
- `menu_item_options`: id, menu_item_id, name, selection_type, min_select, max_select
- `menu_item_option_values`: id, option_id, name, price_delta, status

Menu items are archived, never hard-deleted, because order snapshots reference them.

## Carts and Group Orders

- `carts`: id, user_id, restaurant_id, status, expires_at, timestamps
- `cart_items`: id, cart_id, added_by_user_id, menu_item_id, quantity, unit_price_snapshot, customization
- `group_orders` (Phase 2): id, host_user_id, cart_id, order_intent_id, status, deadline_at, locked/checkout timestamps
- `group_order_members` (Phase 2): id, group_order_id, user_id, joined_at
- `group_order_invites` (Phase 2): id, group_order_id, creator, token_hash, expiry, consumed timestamp/user
- `cart_items.added_by_user_id`: authenticated contributor, backfilled from cart owner for existing rows

A user may have several carts, but at most one `ACTIVE` cart per restaurant.

## Checkout, Orders, and Payments

- `order_intents`: id, customer_id, restaurant_id, cart_id, delivery_address_snapshot, delivery_instructions, status, currency, subtotal, discount_total, fee_total, tax_total, tip_amount, grand_total, expires_at, void_reason, timestamps
- `order_intent_items`: id, order_intent_id, menu_item_id, item_name_snapshot, unit_price, quantity, customization_snapshot, line_total
- `order_intent_charges`: id, order_intent_id, charge_type, rule_type, rule_id, rule_version, amount, currency, is_taxable, metadata
- `orders`: id, order_number, order_intent_id (unique), confirming_payment_attempt_id (unique), customer_id, restaurant_id, delivery_address_snapshot, delivery_instructions, status, currency, subtotal, discount_total, fee_total, tax_total, tip_amount, grand_total, cancellation_reason, timestamps
- `order_items`: id, order_id, menu_item_id, item_name_snapshot, unit_price, quantity, customization_snapshot, line_total
- `order_charges`: id, order_id, charge_type, rule_type, rule_id, rule_version, amount, currency, is_taxable, metadata
- `order_status_history`: id, order_id, from_status, to_status, actor_user_id, reason, metadata, timestamp
- `payment_attempts`: id, order_intent_id, provider, provider_reference, method, amount, currency, status, failure_code, idempotency_key, timestamps
- `refunds`: id, payment_attempt_id, order_id (nullable), amount, currency, reason_code, status, requested_by_user_id, approved_by_user_id, provider_reference, idempotency_key, timestamps

Orders have no payment status. Payment state lives on `payment_attempts` and refund state lives only on `refunds`.

## Delivery

- `DeliveryPartner`: one profile per user; verification status, online/busy/offline availability, vehicle type, verifier, and non-PII KYC provider/reference/review reason
- `Delivery`: one per order; current partner, lifecycle status, hashed completion code, failure reason, prep estimate, estimated ready/dispatch times, and lifecycle timestamps
- `DeliveryAssignment`: expiring per-partner offers and response/rejection state; a PostgreSQL partial unique index allows at most one accepted assignment per delivery
- `DeliveryStatusHistory`: actor, previous/next status, reason, correlation ID, timestamp
- `PartnerLocation`: partner/delivery coordinates, accuracy, and recorded time; old points are pruned after 30 days
- `PartnerEarning`: idempotent earning rows by delivery/type, amount in minor units, currency, status, and optional reserved payout
- `PartnerPayout`: idempotent partner payout request with date range, currency/amount, requested/approved/paid/rejected state, approver, and external transfer reference

The MVP currently implements a base earning for completed deliveries and manually reconciled payout batches. It stores only KYC provider references, not identity documents or sensitive identifiers. KYC document storage and delivery proof uploads are not present in the schema.

## Pricing, Settlement, and Earnings

- `tax_rules`: id, scope_type, scope_id, jurisdiction, tax_code, rate_bps, applies_to_charge_types, rounding_mode, version, effective_from, effective_to, status
- `fee_rules`: id, scope_type (`platform`, `restaurant`, `delivery_zone`, `membership`, `payment_method`), scope_id, fee_type, calculation (`fixed`, `percent`, `tiered`), amount, rate_bps, tiers, min_amount, max_amount, rounding_mode, stacking (`exclusive`, `additive`), is_taxable, version, effective_from, effective_to, status
- `CommissionRule`: rule key/version, optional restaurant scope, rate in basis points, and effective interval. A newer rule closes the previous interval; prior versions remain available for settlement snapshots.
- `RestaurantSettlement`: one restaurant and half-open period per currency; gross item subtotal, restaurant-funded discounts, attributed successful refunds, commission basis/amount, net amount, draft/approved/paid state, generator, separate approver, and external transfer reference.
- `RestaurantSettlementItem`: one order per settlement snapshot with its attributed discount/refund, commission rule ID/version, commission basis, commission, and net amount. An order can be settled only once.
- `SettlementAdjustment`: non-zero signed amount, currency, actor, and required reason. Adjustments are append-only records and can change only a draft settlement total.
- `Refund.restaurantAdjustmentMinor`: explicitly attributed restaurant-funded amount, constrained between zero and the refund amount. Only successful refunds contribute to settlement deductions.
- `partner_earnings`: id, delivery_partner_id, delivery_id, earning_type (`base`, `distance`, `incentive`, `tip`, `adjustment`), amount, currency, status, timestamp
- `partner_payouts`: id, delivery_partner_id, period_start, period_end, amount, currency, status, provider_reference, approved_by_user_id, approved_at

Pricing and commission rules are versioned. Editing a rule creates a new version; snapshots reference the exact version used. Settlement commission is chosen by the effective rule at the order delivery timestamp, and report totals remain grouped by currency.

## Engagement and Operations

- `loyalty_rules`: id, currency, version, earn_rate_bps, redemption value, expiry days, effective range, status, creator
- `loyalty_transactions`: id, user_id, order_id, order_intent_id, refund_id, rule_id, type, signed points, idempotency key, calculation, expiry
- `loyalty_redemptions`: id, user_id, order_intent_id, rule_id, points, discount, currency, reservation status, timestamps
- `membership_plans`: id, key, version, price, currency, interval, benefits, effective range, status, creator
- `memberships`: id, user_id, plan_id, payment-gated status, provider reference, effective dates
- `support_cases`: id, user_id, order_id, category, priority, status, assigned_agent_id, timestamps
- `support_case_messages`: id, support_case_id, author_user_id, body, visibility, timestamp
- `notifications`: id, user_id, type, channel, payload, status, sent_at
- `file_uploads`: id, owner_user_id, purpose, object_key, content_type, size, scan_status, access_scope, timestamps
- `audit_logs`: id, actor_user_id, permission, action, entity_type, entity_id, before, after, correlation_id, timestamp

## Reliability

- `idempotency_keys`: id, actor_scope, key, request_hash, status, response_snapshot, expires_at — unique on (actor_scope, key)
- `webhook_events`: id, provider, provider_event_id, payload_hash, status, received_at, processed_at — unique on (provider, provider_event_id)

## Integrity

Use foreign keys, unique and check constraints, and transactions for critical multi-record operations. Key rules:

- Confirming an intent atomically creates the order, copies the intent items and charges into `order_items` and `order_charges`, sets `confirming_payment_attempt_id`, and writes the first status-history entry. The unique constraints on `orders.order_intent_id` and `orders.confirming_payment_attempt_id` guarantee one order per intent and per payment.
- At most one `ACCEPTED` delivery assignment exists per delivery (partial unique index).
- The sum of non-rejected refunds for a payment attempt cannot exceed its amount (checked in the refund transaction under a row lock).
- `provider_reference` is unique per provider for payment attempts and refunds.
- Every status change writes the matching history table.

## Indexing

Index based on real query patterns. Likely candidates include user identity, role assignments by user and scope, restaurant location/status/zone, menu restaurant/category/status, order customer/restaurant/status/date, intents by status and expiry (for the expiry job), delivery partner/status, open offers by expiry, promotion code/time, and reviews by restaurant/date. Use PostGIS geospatial indexes for zones and coordinates.

## Privacy and Retention

Minimize personal data and never store raw payment card data. Raw `partner_locations` rows are kept for 30 days and then deleted or aggregated; other retention periods are defined in [SECURITY.md](SECURITY.md).

## Migrations

Every schema change uses a reviewed Prisma migration. Avoid destructive changes without a migration plan. Keep migrations compatible with rolling deployments.

## Backup

Backup, RPO, and RTO targets are defined in [DEPLOYMENT.md](DEPLOYMENT.md).
