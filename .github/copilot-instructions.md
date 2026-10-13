# Urban Spoon Development Instructions

Read `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/STATE_MACHINES.md`, `docs/ROADMAP.md` (to check which phase a feature belongs to), the relevant domain design, security guidance, and testing strategy before implementing a feature.

Use the documented TypeScript/Next.js/NestJS/PostgreSQL/Prisma baseline and the repository layout in `docs/ARCHITECTURE.md`. Do not build features marked for a later phase unless asked. Keep the backend authoritative for authorization, pricing, taxes, fees, payment status, dispatch, and order transitions. Use migrations for schema changes, idempotency for retryable side effects, and tests for acceptance criteria and negative paths.

Do not expose secrets or raw payment data. Keep changes scoped, update contracts when behavior changes, and report the commands and results actually run.
