CREATE TYPE "LoyaltyTransactionType" AS ENUM ('EARN', 'REDEMPTION', 'REFUND_REVERSAL', 'REFUND_RESTORATION');
CREATE TYPE "LoyaltyRedemptionStatus" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED', 'RESTORED');
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'CANCELLED', 'EXPIRED');
CREATE TYPE "MembershipInterval" AS ENUM ('MONTHLY', 'YEARLY');

ALTER TABLE "Coupon"
    ADD COLUMN "perUserLimit" INTEGER,
    ADD COLUMN "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "campaignKey" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "campaignName" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
UPDATE "Coupon"
SET "campaignKey" = LOWER("code"), "campaignName" = "code"
WHERE "campaignKey" = '';
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_perUserLimit_check"
    CHECK ("perUserLimit" IS NULL OR "perUserLimit" > 0);
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_version_check" CHECK ("version" > 0);
CREATE UNIQUE INDEX "Coupon_campaignKey_version_key" ON "Coupon"("campaignKey", "version");

CREATE TABLE "LoyaltyRule" (
    "id" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "version" INTEGER NOT NULL,
    "earnRateBps" INTEGER NOT NULL,
    "redeemMinorPerPoint" INTEGER NOT NULL DEFAULT 1,
    "pointsExpireAfterDays" INTEGER NOT NULL DEFAULT 365,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveUntil" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyRule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LoyaltyRule_version_check" CHECK ("version" > 0),
    CONSTRAINT "LoyaltyRule_earnRateBps_check" CHECK ("earnRateBps" BETWEEN 1 AND 10000),
    CONSTRAINT "LoyaltyRule_redeemMinorPerPoint_check" CHECK ("redeemMinorPerPoint" > 0),
    CONSTRAINT "LoyaltyRule_pointsExpireAfterDays_check" CHECK ("pointsExpireAfterDays" BETWEEN 1 AND 3650),
    CONSTRAINT "LoyaltyRule_effectiveRange_check" CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom")
);

CREATE TABLE "LoyaltyTransaction" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "orderIntentId" UUID,
    "refundId" UUID,
    "type" "LoyaltyTransactionType" NOT NULL,
    "points" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "calculation" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyTransaction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LoyaltyTransaction_points_check" CHECK ("points" <> 0)
);

CREATE TABLE "LoyaltyRedemption" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "orderIntentId" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "points" INTEGER NOT NULL,
    "discountMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "LoyaltyRedemptionStatus" NOT NULL DEFAULT 'RESERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyRedemption_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LoyaltyRedemption_points_check" CHECK ("points" > 0),
    CONSTRAINT "LoyaltyRedemption_discountMinor_check" CHECK ("discountMinor" > 0)
);

CREATE TABLE "MembershipPlan" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "interval" "MembershipInterval" NOT NULL,
    "benefits" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveUntil" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MembershipPlan_priceMinor_check" CHECK ("priceMinor" > 0),
    CONSTRAINT "MembershipPlan_version_check" CHECK ("version" > 0),
    CONSTRAINT "MembershipPlan_effectiveRange_check" CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom")
);

CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "providerReference" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Membership_effectiveRange_check" CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" > "startsAt")
);

CREATE UNIQUE INDEX "LoyaltyRule_currency_version_key" ON "LoyaltyRule"("currency", "version");
CREATE INDEX "LoyaltyRule_currency_isActive_effectiveFrom_effectiveUntil_idx" ON "LoyaltyRule"("currency", "isActive", "effectiveFrom", "effectiveUntil");
CREATE UNIQUE INDEX "LoyaltyTransaction_idempotencyKey_key" ON "LoyaltyTransaction"("idempotencyKey");
CREATE INDEX "LoyaltyTransaction_userId_createdAt_idx" ON "LoyaltyTransaction"("userId", "createdAt");
CREATE INDEX "LoyaltyTransaction_orderId_type_idx" ON "LoyaltyTransaction"("orderId", "type");
CREATE INDEX "LoyaltyTransaction_orderIntentId_idx" ON "LoyaltyTransaction"("orderIntentId");
CREATE INDEX "LoyaltyTransaction_refundId_idx" ON "LoyaltyTransaction"("refundId");
CREATE UNIQUE INDEX "LoyaltyRedemption_orderIntentId_key" ON "LoyaltyRedemption"("orderIntentId");
CREATE INDEX "LoyaltyRedemption_userId_status_createdAt_idx" ON "LoyaltyRedemption"("userId", "status", "createdAt");
CREATE UNIQUE INDEX "MembershipPlan_key_version_key" ON "MembershipPlan"("key", "version");
CREATE INDEX "MembershipPlan_isActive_currency_effectiveFrom_effectiveUntil_idx" ON "MembershipPlan"("isActive", "currency", "effectiveFrom", "effectiveUntil");
CREATE UNIQUE INDEX "Membership_providerReference_key" ON "Membership"("providerReference");
CREATE INDEX "Membership_userId_status_endsAt_idx" ON "Membership"("userId", "status", "endsAt");

ALTER TABLE "LoyaltyRule" ADD CONSTRAINT "LoyaltyRule_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_ruleId_fkey"
    FOREIGN KEY ("ruleId") REFERENCES "LoyaltyRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_orderIntentId_fkey"
    FOREIGN KEY ("orderIntentId") REFERENCES "OrderIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_refundId_fkey"
    FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoyaltyRedemption" ADD CONSTRAINT "LoyaltyRedemption_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoyaltyRedemption" ADD CONSTRAINT "LoyaltyRedemption_orderIntentId_fkey"
    FOREIGN KEY ("orderIntentId") REFERENCES "OrderIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoyaltyRedemption" ADD CONSTRAINT "LoyaltyRedemption_ruleId_fkey"
    FOREIGN KEY ("ruleId") REFERENCES "LoyaltyRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "RolePermission" ("role", "permission") VALUES
    ('admin', 'admin.loyalty.manage'),
    ('super_admin', 'admin.loyalty.manage')
ON CONFLICT ("role", "permission") DO NOTHING;