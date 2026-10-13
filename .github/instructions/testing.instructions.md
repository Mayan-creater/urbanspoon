---
applyTo: "**/*.test.ts,**/*.test.tsx,**/*.spec.ts,**/*.spec.tsx,e2e/**"
---

# Testing Instructions

Test behavior and business outcomes. Use `docs/STATE_MACHINES.md` as the oracle for transition tests. Cover authorization, payment/order idempotency, pricing/tax/fee calculations, state transitions, dispatch retries, provider failures, accessibility, and critical browser journeys. Preserve meaningful failures and never weaken a test to make a suite pass.
