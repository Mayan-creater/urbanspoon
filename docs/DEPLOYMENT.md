# Urban Spoon — Deployment Specification

## Environments
Local, Development, Test/QA, Staging, Production.

Keep environment configuration outside source code.

## Configuration
Secret-manage database URLs, authentication secrets, payment credentials, AI keys, maps keys, notification credentials, and storage credentials. Never commit production secrets.

## CI/CD
```text
Checkout
  ↓
Install
  ↓
Lint
  ↓
Typecheck
  ↓
Unit Tests
  ↓
Build
  ↓
API/Integration Tests
  ↓
Security Checks
  ↓
Deploy Test/Staging
  ↓
Smoke/E2E
  ↓
Approval
  ↓
Production
```

## Database Deployment
Controlled migrations, staging verification, backup before risky changes, no destructive changes without migration plan, rolling-deployment compatibility.

## Production
HTTPS, secure headers, production logging, monitoring, health checks, error tracking, scaling strategy, backups/recovery, alerting.

## Frontend
Validate production API configuration, optimize assets, document caching, handle source maps according to policy.

## Backend
Validate environment variables, database connectivity, migrations, health checks, workers/queues, monitoring.

## Rollback
Define application, frontend, database, and configuration rollback. Prefer backward-compatible migrations.

## Monitoring
Uptime, error rate, latency, database health, jobs/queues, payment failures, order failures, notifications, resources.

Initial production targets, subject to revision before launch:

- Availability: 99.9% monthly for the customer API (about 43 minutes of downtime), excluding planned maintenance and declared regional disasters.
- API latency: p95 under 500 ms for reads and under 1 s for checkout preview/order-intent operations, excluding provider time.
- Recovery point objective (RPO): 15 minutes for transactional data, using continuous backup with point-in-time recovery.
- Recovery time objective (RTO), single-zone or primary database failure: 5 minutes, through a multi-zone database with automatic failover and at least two application instances across zones. This counts against the availability target.
- Recovery time objective (RTO), full regional disaster: 1 hour, by restoring into a standby region. A regional disaster is declared through the incident process and is outside the monthly availability target.
- Restore tests: at least quarterly and after material backup changes.

These targets are the single source for RPO and RTO; other documents reference this section.

## Disaster Recovery
Automated backups must support the RPO above, use documented retention, and be
stored separately from the primary environment. The restore procedure and
failover responsibilities must be documented and tested against the RTO above.

## Production Smoke
Homepage, login, discovery, menu, cart, checkout entry, payment health, safe order-path verification, admin, health endpoint.

## Release Checklist
- [ ] Tests pass
- [ ] Build passes
- [ ] Security checks pass
- [ ] Migration reviewed
- [ ] Environment verified
- [ ] Backup available
- [ ] Monitoring active
- [ ] Rollback plan available
- [ ] Smoke tests pass
- [ ] Release documented
