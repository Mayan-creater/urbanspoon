# Urban Spoon — System Architecture

## Goal
Start as a manageable application and evolve to a multi-city marketplace with clear domain boundaries.

## Logical Architecture
```text
Customer Web/Mobile
Restaurant Portal
Delivery App/Portal
Admin Portal
        |
        v
API / Backend
        |
        +-- Identity/Auth
        +-- Users
        +-- Restaurants
        +-- Menus
        +-- Discovery
        +-- Cart
        +-- Orders
        +-- Payments
        +-- Delivery
        +-- Promotions
        +-- Loyalty/Membership
        +-- Reviews
        +-- Support
        +-- Notifications
        +-- AI
        +-- Analytics
        |
        v
PostgreSQL / Redis + BullMQ / Object Storage

External providers (called from the backend through adapters):
Payments, Maps/Geocoding, SMS/Email/Push, AI
```

## Initial Architecture
Prefer a modular monolith for MVP unless scale/team needs justify services earlier. Keep boundaries extractable.

## Technology Baseline

- **Language:** TypeScript with strict type checking.
- **Web application:** Next.js App Router for customer, restaurant, delivery, and admin interfaces.
- **Backend:** NestJS modular monolith with REST controllers and OpenAPI documentation.
- **Database:** PostgreSQL with Prisma migrations and transactions for critical workflows.
- **Cache and jobs:** Redis with BullMQ for retries, notifications, dispatch work, reconciliation, and scheduled tasks.
- **Files:** S3-compatible private object storage behind an upload service.
- **External providers:** Payment, maps/geocoding, messaging, push, and AI providers isolated behind adapters.
- **Testing:** Vitest for unit/integration tests and Playwright for browser journeys.
- **Operations:** Docker for local/CI parity and GitHub Actions for CI/CD.

- **Real-time updates:** Server-Sent Events from the API for order, intent, and restaurant order-queue updates, with polling as the fallback. Delivery partners send location over authenticated HTTPS requests.
- **Delivery partner app:** a Progressive Web App within the Next.js application for the MVP. Background location is not reliable in browsers, so a native app is planned for Phase 2 (see [DELIVERY_SYSTEM.md](DELIVERY_SYSTEM.md)).

This baseline is the default for MVP implementation. A change requires an
architecture decision record describing the compatibility, cost, and migration
impact.

## Repository Layout
A pnpm workspace monorepo:
```text
apps/
  web/        Next.js App Router: customer, restaurant, delivery (PWA), and admin route groups
  api/        NestJS modular monolith, Prisma schema and migrations, BullMQ workers
packages/
  contracts/  Generated OpenAPI types and the typed API client shared by web and api
  config/     Shared TypeScript, ESLint, and Vitest configuration
e2e/          Playwright journeys
docs/         Product and technical documentation
```

## Domain Modules
Identity, Users, Restaurants, Menus, Discovery, Cart, Orders, Payments, Delivery, Promotions, Loyalty, Membership, Reviews, Support, Notifications, AI, Analytics, Administration.

The Delivery module owns dispatch eligibility, assignment offers, acceptance
timeouts, reassignment, pickup/delivery state, partner location updates, and
ETA calculation. Dispatch decisions are made server-side from restaurant,
delivery-zone, partner-availability, capacity, distance, and order-priority
data; clients may report availability and location but cannot assign orders.

## Frontend
Routes live in `apps/web/src/app/` and stay thin: route groups `(customer)`, `(restaurant)`, `(delivery)`, and `(admin)` render feature modules. Feature logic is organized by feature:
```text
apps/web/src/
  app/
    (customer)/
    (restaurant)/
    (delivery)/
    (admin)/
  features/
    auth/
    discovery/
    restaurants/
    cart/
    checkout/
    orders/
    profile/
    support/
    loyalty/
    ai/
  shared/
    components/
    hooks/
    services/
    utils/
    types/
```

## Backend
Use:
```text
API/Controller
    ↓
Application/Service
    ↓
Domain/Business Rules
    ↓
Repository/Data Access
    ↓
Database
```
Do not put complex business logic in controllers.

## Data
PostgreSQL is the system of record for transactional data. Redis backs BullMQ jobs (dispatch, intent expiry, reconciliation, notifications, refunds) and short-lived caches; it never holds authoritative state. Add dedicated search infrastructure only when PostgreSQL search is shown to be insufficient.

## State Machines
Lifecycle states and transitions are defined in [STATE_MACHINES.md](STATE_MACHINES.md). Each machine is implemented once in its owning domain module as an explicit transition table; controllers and jobs request named transitions and never write status columns directly.

## Events
Potential events: OrderIntentConfirmed, OrderIntentVoided, PaymentAttemptSucceeded, RefundSubmitted, RefundSucceeded, OrderAccepted, OrderRejected, OrderPreparing, OrderReady, OrderPickedUp, OrderDelivered, OrderCancelled, ReviewSubmitted. Design for safe retries/versioning.

Dispatch-specific events include DeliveryOfferSent,
DeliveryOfferAccepted, DeliveryOfferRejected, DeliveryOfferExpired,
DeliveryAssignmentReleased, DeliveryFailed, PartnerLocationUpdated, and
DeliveryEtaUpdated. Event consumers must be idempotent and include the order,
delivery, and correlation identifiers.

## Integrations
Payment, maps/geocoding, SMS, email, push, WhatsApp, AI, analytics, object storage. Isolate providers behind adapters.

## Security
Centralized auth, authorization policies, validation, rate limits, secret management, auditing, encryption in transit, appropriate encryption at rest.

## Observability
Structured logs, correlation IDs, metrics, error monitoring, health checks, job monitoring. Never log credentials/payment secrets.

## Scalability
Optimize application/database → cache → background jobs → read optimization → search infrastructure → service extraction only when justified.

## Resilience
Handle provider timeouts, retries, duplicate callbacks, partial failures, notification/map outages, and payment outages while keeping critical transactions consistent.
