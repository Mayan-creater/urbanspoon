---
applyTo: "apps/api/**"
---

# Backend Instructions

Read `docs/STATE_MACHINES.md`, the relevant domain design, API specification, database design, security specification, and testing strategy. Use the NestJS modular-monolith boundaries and keep business rules out of controllers. The backend is authoritative for permissions, pricing, taxes/fees, payment verification, dispatch, and state transitions. Use Prisma migrations, transactions, idempotency keys, safe errors, audit records, and retry-safe jobs.
