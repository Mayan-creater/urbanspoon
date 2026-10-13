CREATE TYPE "RestaurantSettlementStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID');

ALTER TABLE "Refund"
ADD COLUMN "restaurantAdjustmentMinor" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Refund"
ADD CONSTRAINT "Refund_restaurantAdjustmentMinor_check"
CHECK ("restaurantAdjustmentMinor" >= 0 AND "restaurantAdjustmentMinor" <= "amountMinor");

CREATE TABLE "CommissionRule" (
  "id" UUID NOT NULL,
  "ruleKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "restaurantId" UUID,
  "rateBps" INTEGER NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveUntil" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommissionRule_rateBps_check" CHECK ("rateBps" BETWEEN 0 AND 10000),
  CONSTRAINT "CommissionRule_effective_range_check"
    CHECK ("effectiveUntil" IS NULL OR "effectiveFrom" < "effectiveUntil"),
  CONSTRAINT "CommissionRule_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "RestaurantSettlement" (
  "id" UUID NOT NULL,
  "restaurantId" UUID NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "grossItemMinor" INTEGER NOT NULL,
  "restaurantDiscountMinor" INTEGER NOT NULL,
  "refundAdjustmentMinor" INTEGER NOT NULL,
  "commissionBasisMinor" INTEGER NOT NULL,
  "commissionMinor" INTEGER NOT NULL,
  "netAmountMinor" INTEGER NOT NULL,
  "status" "RestaurantSettlementStatus" NOT NULL DEFAULT 'DRAFT',
  "generatedByUserId" UUID NOT NULL,
  "approvedByUserId" UUID,
  "approvedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "externalTransferReference" VARCHAR(160),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RestaurantSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RestaurantSettlement_period_check" CHECK ("periodStart" < "periodEnd"),
  CONSTRAINT "RestaurantSettlement_amounts_check" CHECK (
    "grossItemMinor" >= 0 AND "restaurantDiscountMinor" >= 0 AND
    "refundAdjustmentMinor" >= 0 AND "commissionBasisMinor" >= 0 AND
    "commissionMinor" >= 0 AND "netAmountMinor" >= 0
  ),
  CONSTRAINT "RestaurantSettlement_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RestaurantSettlement_generatedByUserId_fkey"
    FOREIGN KEY ("generatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RestaurantSettlement_approvedByUserId_fkey"
    FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "RestaurantSettlementItem" (
  "id" UUID NOT NULL,
  "settlementId" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "commissionRuleId" UUID,
  "commissionRuleVersion" INTEGER,
  "grossItemMinor" INTEGER NOT NULL,
  "restaurantDiscountMinor" INTEGER NOT NULL,
  "refundAdjustmentMinor" INTEGER NOT NULL,
  "commissionBasisMinor" INTEGER NOT NULL,
  "commissionMinor" INTEGER NOT NULL,
  "netAmountMinor" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RestaurantSettlementItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RestaurantSettlementItem_amounts_check" CHECK (
    "grossItemMinor" >= 0 AND "restaurantDiscountMinor" >= 0 AND
    "refundAdjustmentMinor" >= 0 AND "commissionBasisMinor" >= 0 AND
    "commissionMinor" >= 0 AND "netAmountMinor" >= 0
  ),
  CONSTRAINT "RestaurantSettlementItem_settlementId_fkey"
    FOREIGN KEY ("settlementId") REFERENCES "RestaurantSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RestaurantSettlementItem_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RestaurantSettlementItem_commissionRuleId_fkey"
    FOREIGN KEY ("commissionRuleId") REFERENCES "CommissionRule"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "SettlementAdjustment" (
  "id" UUID NOT NULL,
  "settlementId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SettlementAdjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SettlementAdjustment_amount_check" CHECK ("amountMinor" <> 0),
  CONSTRAINT "SettlementAdjustment_settlementId_fkey"
    FOREIGN KEY ("settlementId") REFERENCES "RestaurantSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SettlementAdjustment_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CommissionRule_ruleKey_version_key" ON "CommissionRule"("ruleKey", "version");
CREATE INDEX "CommissionRule_restaurantId_isActive_effectiveFrom_effectiveUntil_idx"
  ON "CommissionRule"("restaurantId", "isActive", "effectiveFrom", "effectiveUntil");
CREATE UNIQUE INDEX "RestaurantSettlement_restaurantId_periodStart_periodEnd_currency_key"
  ON "RestaurantSettlement"("restaurantId", "periodStart", "periodEnd", "currency");
CREATE INDEX "RestaurantSettlement_status_periodEnd_idx" ON "RestaurantSettlement"("status", "periodEnd");
CREATE INDEX "RestaurantSettlement_restaurantId_periodStart_periodEnd_idx"
  ON "RestaurantSettlement"("restaurantId", "periodStart", "periodEnd");
CREATE UNIQUE INDEX "RestaurantSettlementItem_orderId_key" ON "RestaurantSettlementItem"("orderId");
CREATE INDEX "RestaurantSettlementItem_settlementId_createdAt_idx"
  ON "RestaurantSettlementItem"("settlementId", "createdAt");
CREATE INDEX "SettlementAdjustment_settlementId_createdAt_idx"
  ON "SettlementAdjustment"("settlementId", "createdAt");