CREATE TYPE "PricingRuleType" AS ENUM ('DELIVERY_FEE', 'PACKAGING_FEE', 'SERVICE_FEE', 'TAX');
CREATE TYPE "PricingValueType" AS ENUM ('FIXED', 'PERCENTAGE');
CREATE TYPE "CouponDiscountType" AS ENUM ('FIXED', 'PERCENTAGE');

CREATE TABLE "Cart" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "restaurantId" UUID NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Cart_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Cart_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Cart_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "CartItem" (
  "id" UUID NOT NULL,
  "cartId" UUID NOT NULL,
  "menuItemId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CartItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CartItem_quantity_check" CHECK ("quantity" BETWEEN 1 AND 99)
);

CREATE TABLE "CartItemOptionSelection" (
  "id" UUID NOT NULL,
  "cartItemId" UUID NOT NULL,
  "optionId" UUID NOT NULL,
  "groupNameSnapshot" TEXT NOT NULL,
  "optionNameSnapshot" TEXT NOT NULL,
  "priceDeltaMinorSnapshot" INTEGER NOT NULL,
  CONSTRAINT "CartItemOptionSelection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CartItemOptionSelection_cartItemId_fkey" FOREIGN KEY ("cartItemId") REFERENCES "CartItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CartItemOptionSelection_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "MenuOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CartItemOptionSelection_price_check" CHECK ("priceDeltaMinorSnapshot" >= 0)
);

CREATE TABLE "PricingRule" (
  "id" UUID NOT NULL,
  "ruleKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "type" "PricingRuleType" NOT NULL,
  "valueType" "PricingValueType" NOT NULL,
  "value" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
  "scopeState" TEXT,
  "appliesTo" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "taxable" BOOLEAN NOT NULL DEFAULT false,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveUntil" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PricingRule_version_check" CHECK ("version" > 0),
  CONSTRAINT "PricingRule_value_check" CHECK (
    "value" >= 0 AND
    ("valueType" <> 'PERCENTAGE' OR "value" <= 10000) AND
    ("effectiveUntil" IS NULL OR "effectiveFrom" < "effectiveUntil")
  )
);

CREATE TABLE "Coupon" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "discountType" "CouponDiscountType" NOT NULL,
  "discountValue" INTEGER NOT NULL,
  "minSubtotalMinor" INTEGER NOT NULL DEFAULT 0,
  "maxDiscountMinor" INTEGER,
  "usageLimit" INTEGER,
  "usageCount" INTEGER NOT NULL DEFAULT 0,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
  "restaurantId" UUID,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Coupon_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Coupon_discount_check" CHECK (
    "discountValue" > 0 AND
    "minSubtotalMinor" >= 0 AND
    ("maxDiscountMinor" IS NULL OR "maxDiscountMinor" > 0) AND
    ("usageLimit" IS NULL OR "usageLimit" > 0) AND
    "usageCount" >= 0 AND
    ("discountType" <> 'PERCENTAGE' OR "discountValue" <= 10000) AND
    "startsAt" < "endsAt"
  )
);

CREATE UNIQUE INDEX "Cart_userId_key" ON "Cart"("userId");
CREATE INDEX "Cart_restaurantId_updatedAt_idx" ON "Cart"("restaurantId", "updatedAt");
CREATE INDEX "CartItem_cartId_createdAt_idx" ON "CartItem"("cartId", "createdAt");
CREATE INDEX "CartItem_menuItemId_idx" ON "CartItem"("menuItemId");
CREATE UNIQUE INDEX "CartItemOptionSelection_cartItemId_optionId_key" ON "CartItemOptionSelection"("cartItemId", "optionId");
CREATE INDEX "CartItemOptionSelection_optionId_idx" ON "CartItemOptionSelection"("optionId");
CREATE UNIQUE INDEX "PricingRule_ruleKey_version_key" ON "PricingRule"("ruleKey", "version");
CREATE INDEX "PricingRule_type_isActive_effectiveFrom_effectiveUntil_scopeState_idx" ON "PricingRule"("type", "isActive", "effectiveFrom", "effectiveUntil", "scopeState");
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");
CREATE INDEX "Coupon_isActive_startsAt_endsAt_idx" ON "Coupon"("isActive", "startsAt", "endsAt");
CREATE INDEX "Coupon_restaurantId_code_isActive_idx" ON "Coupon"("restaurantId", "code", "isActive");
