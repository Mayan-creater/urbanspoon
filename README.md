# Urban Spoon

Urban Spoon is an AI-powered hyperlocal food marketplace. The repository is a pnpm workspace with a Next.js web app, a NestJS API, and shared packages.

## Prerequisites

- Node.js 22 or newer
- Corepack (included with Node.js) or pnpm 12.9.1
- Docker Compose for local PostgreSQL and Redis

## Local development

```sh
corepack enable
pnpm install
cp .env.example .env
docker compose up -d
pnpm --filter @urbanspoon/api db:migrate
pnpm dev
```

The web app runs at `http://localhost:3000`; the API is at `http://localhost:3001/api/v1`. API liveness is available at `/api/v1/health`, and database readiness is available at `/api/v1/health/ready`.

Create an account at `/register`, then use the verification email captured by Mailpit at `http://localhost:8025`; sign in at `/login`, and manage profile and addresses at `/account`. Prisma and web commands load the workspace-root `.env` automatically. To bootstrap a super administrator, verify an account, set `BOOTSTRAP_SUPER_ADMIN_EMAIL` in `.env`, and run `pnpm --filter @urbanspoon/api db:seed`.

Customers can submit event catering requests at `/events`. Active restaurant partners can enable catering enquiries and submit expiring quotations from `/partner`; requests remain proposals and do not create bookings or collect payment.

The AI workspace is available at `/ai`. To enable it, set `AI_API_BASE_URL`, `AI_API_KEY`, and `AI_MODEL` in `.env` to an OpenAI-compatible chat-completions provider. These settings are optional; AI endpoints return a service-unavailable response until configured. Review provider data-retention terms before sending published review or partner menu content. See [docs/AI_FEATURES.md](docs/AI_FEATURES.md) for behavior and safety boundaries.

Run `pnpm build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` for workspace quality checks. Database schema changes belong in reviewed Prisma migrations.
