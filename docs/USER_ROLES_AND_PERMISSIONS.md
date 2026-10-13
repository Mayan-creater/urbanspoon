# Urban Spoon — Roles and Permissions

## Model

Authorization uses scoped RBAC plus policy checks. A user may hold multiple active role assignments (`user_roles`). Each assignment is scoped to the platform, a restaurant, an organization, or a provider account. Roles map to permissions through `role_permissions`, seeded from the matrix below by migration; changing the matrix requires a migration and a matching update to this document.

## Roles

- `customer`: own profile, addresses, carts, orders, payments, reviews, and support cases.
- `restaurant_owner`: manage an assigned restaurant, its hours, menu, orders, staff, promotions, analytics, and settlements.
- `restaurant_staff`: operate orders for an assigned restaurant and toggle item availability.
- `delivery_partner`: manage own availability, offers, active deliveries, location, proof, and earnings.
- `support_agent`: inspect assigned cases and the orders they reference, and request refunds.
- `admin`: manage platform operations within assigned permissions.
- `super_admin`: manage administrators, permissions, and platform configuration.

Provider and corporate roles are post-MVP extensions and must use the same scoped-assignment model.

## MVP Permission Matrix

Customer actions on their own resources are authorized by ownership and do not need named permissions.

| Permission | restaurant_owner | restaurant_staff | delivery_partner | support_agent | admin | super_admin |
| --- | --- | --- | --- | --- | --- | --- |
| `restaurant.manage` | ✓ (scoped) | | | | | |
| `restaurant.orders.manage` | ✓ (scoped) | ✓ (scoped) | | | | |
| `restaurant.menu.availability` | ✓ (scoped) | ✓ (scoped) | | | | |
| `restaurant.staff.manage` | ✓ (scoped) | | | | | |
| `delivery.self.manage` | | | ✓ (self) | | | |
| `support.cases.manage` | | | | ✓ (assigned cases) | ✓ | ✓ |
| `payment.refund` | | | | ✓ | ✓ | ✓ |
| `payment.refund.approve` | | | | | ✓ | ✓ |
| `admin.users.manage` | | | | | ✓ | ✓ |
| `admin.restaurants.manage` | | | | | ✓ | ✓ |
| `admin.orders.manage` | | | | | ✓ | ✓ |
| `admin.dispatch.manage` | | | | | ✓ | ✓ |
| `admin.promotions.manage` | | | | | ✓ | ✓ |
| `admin.pricing.manage` (tax, fee, commission rules) | | | | | | ✓ |
| `admin.settlements.approve` | | | | | ✓ | ✓ |
| `admin.reports.read` | | | | | ✓ | ✓ |
| `admin.audit.read` | | | | | | ✓ |
| `admin.roles.manage` | | | | | | ✓ |

## Policy Checks

Every protected request verifies authentication, permission, scope, resource ownership, current resource state, and actor eligibility. Client-supplied role, user, restaurant, or organization identifiers are never authoritative.

Separation of duties: a refund approver must be a different user from the requester, and a restaurant owner can never approve their own restaurant. Support access is limited to assigned cases and the orders they reference, and is time-bounded where practical. Role changes, refunds, restaurant approval, pricing and commission changes, and audit-log access write audit records.

## Acceptance

Unauthorized access returns a safe forbidden response, cross-scope access is rejected, permission changes are audited, and every row of the matrix has automated positive and negative tests.
