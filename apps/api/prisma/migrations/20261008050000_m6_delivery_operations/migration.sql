ALTER TYPE "PartnerEarningStatus" ADD VALUE 'PAYOUT_REQUESTED';
CREATE TYPE "PartnerPayoutStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PAID', 'REJECTED');

ALTER TABLE "DeliveryPartner"
  ADD COLUMN "verificationProvider" TEXT,
  ADD COLUMN "verificationReference" TEXT,
  ADD COLUMN "verificationReason" TEXT;

ALTER TABLE "Delivery"
  ADD COLUMN "estimatedPreparationMinutes" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN "estimatedReadyAt" TIMESTAMP(3),
  ADD COLUMN "dispatchAt" TIMESTAMP(3),
  ADD CONSTRAINT "Delivery_estimatedPreparationMinutes_check"
    CHECK ("estimatedPreparationMinutes" BETWEEN 5 AND 120);

CREATE TABLE "PartnerPayout" (
  "id" UUID NOT NULL,
  "deliveryPartnerId" UUID NOT NULL,
  "requestedByUserId" UUID NOT NULL,
  "approvedByUserId" UUID,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "status" "PartnerPayoutStatus" NOT NULL DEFAULT 'REQUESTED',
  "idempotencyKey" TEXT NOT NULL,
  "providerReference" TEXT,
  "rejectionReason" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartnerPayout_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PartnerPayout_deliveryPartnerId_fkey" FOREIGN KEY ("deliveryPartnerId") REFERENCES "DeliveryPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PartnerPayout_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PartnerPayout_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PartnerPayout_period_check" CHECK ("periodStart" < "periodEnd"),
  CONSTRAINT "PartnerPayout_amount_check" CHECK ("amountMinor" > 0)
);

ALTER TABLE "PartnerEarning"
  ADD COLUMN "payoutId" UUID,
  ADD CONSTRAINT "PartnerEarning_payoutId_fkey"
    FOREIGN KEY ("payoutId") REFERENCES "PartnerPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "PartnerPayout_idempotencyKey_key" ON "PartnerPayout"("idempotencyKey");
CREATE INDEX "PartnerPayout_deliveryPartnerId_status_requestedAt_idx" ON "PartnerPayout"("deliveryPartnerId", "status", "requestedAt");
CREATE INDEX "PartnerPayout_status_requestedAt_idx" ON "PartnerPayout"("status", "requestedAt");
CREATE INDEX "PartnerEarning_payoutId_idx" ON "PartnerEarning"("payoutId");