CREATE TYPE "OrderIntentStatus" AS ENUM ('OPEN', 'PAYMENT_PENDING', 'PAYMENT_VERIFIED', 'CONFIRMED', 'VOIDED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "OrderStatus" AS ENUM ('CONFIRMED', 'RESTAURANT_ACCEPTED', 'REJECTED_BY_RESTAURANT', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERED', 'DELIVERY_FAILED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RESTAURANT', 'CANCELLED_BY_ADMIN');
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'SUBMITTED', 'SUCCEEDED', 'FAILED', 'REJECTED');
CREATE TYPE "CouponReservationStatus" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED');

CREATE TABLE "OrderIntent" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "restaurantId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "OrderIntentStatus" NOT NULL DEFAULT 'OPEN',
  "currency" VARCHAR(3) NOT NULL,
  "subtotalMinor" INTEGER NOT NULL,
  "discountMinor" INTEGER NOT NULL,
  "feesMinor" INTEGER NOT NULL,
  "taxMinor" INTEGER NOT NULL,
  "totalMinor" INTEGER NOT NULL,
  "couponId" UUID,
  "couponCode" TEXT,
  "checkoutSnapshot" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderIntent_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderIntent_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "OrderIntent_amounts_check" CHECK ("subtotalMinor" >= 0 AND "discountMinor" >= 0 AND "feesMinor" >= 0 AND "taxMinor" >= 0 AND "totalMinor" >= 0)
);

CREATE TABLE "PaymentAttempt" (
  "id" UUID NOT NULL,
  "orderIntentId" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "providerReference" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'INITIATED',
  "amountMinor" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "checkoutUrl" TEXT,
  "failureCode" TEXT,
  "providerData" JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentAttempt_orderIntentId_fkey" FOREIGN KEY ("orderIntentId") REFERENCES "OrderIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentAttempt_amount_check" CHECK ("amountMinor" > 0)
);

CREATE TABLE "Order" (
  "id" UUID NOT NULL,
  "orderIntentId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "restaurantId" UUID NOT NULL,
  "confirmingPaymentAttemptId" UUID,
  "status" "OrderStatus" NOT NULL DEFAULT 'CONFIRMED',
  "currency" VARCHAR(3) NOT NULL,
  "subtotalMinor" INTEGER NOT NULL,
  "discountMinor" INTEGER NOT NULL,
  "feesMinor" INTEGER NOT NULL,
  "taxMinor" INTEGER NOT NULL,
  "totalMinor" INTEGER NOT NULL,
  "orderSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Order_orderIntentId_fkey" FOREIGN KEY ("orderIntentId") REFERENCES "OrderIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Order_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Order_amounts_check" CHECK ("subtotalMinor" >= 0 AND "discountMinor" >= 0 AND "feesMinor" >= 0 AND "taxMinor" >= 0 AND "totalMinor" >= 0)
);

CREATE TABLE "CouponRedemption" (
  "id" UUID NOT NULL,
  "couponId" UUID NOT NULL,
  "orderIntentId" UUID NOT NULL,
  "status" "CouponReservationStatus" NOT NULL DEFAULT 'RESERVED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CouponRedemption_orderIntentId_fkey" FOREIGN KEY ("orderIntentId") REFERENCES "OrderIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Refund" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "paymentAttemptId" UUID NOT NULL,
  "requestedByUserId" UUID,
  "status" "RefundStatus" NOT NULL DEFAULT 'SUBMITTED',
  "amountMinor" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "providerReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Refund_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Refund_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Refund_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Refund_amount_check" CHECK ("amountMinor" > 0)
);

CREATE TABLE "OrderIntentEvent" (
  "id" UUID NOT NULL,
  "orderIntentId" UUID NOT NULL,
  "actorUserId" UUID,
  "fromStatus" "OrderIntentStatus",
  "toStatus" "OrderIntentStatus" NOT NULL,
  "reason" TEXT,
  "correlationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderIntentEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderIntentEvent_orderIntentId_fkey" FOREIGN KEY ("orderIntentId") REFERENCES "OrderIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderIntentEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "PaymentAttemptEvent" (
  "id" UUID NOT NULL,
  "paymentAttemptId" UUID NOT NULL,
  "fromStatus" "PaymentAttemptStatus",
  "toStatus" "PaymentAttemptStatus" NOT NULL,
  "reason" TEXT,
  "providerEventId" TEXT,
  "correlationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentAttemptEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentAttemptEvent_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "OrderStatusHistory" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "actorUserId" UUID,
  "fromStatus" "OrderStatus",
  "toStatus" "OrderStatus" NOT NULL,
  "reason" TEXT,
  "correlationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderStatusHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "PaymentWebhookEvent" (
  "id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "signatureValid" BOOLEAN NOT NULL,
  "payload" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "processingError" TEXT,
  CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderIntent_userId_idempotencyKey_key" ON "OrderIntent"("userId", "idempotencyKey");
CREATE INDEX "OrderIntent_userId_createdAt_idx" ON "OrderIntent"("userId", "createdAt");
CREATE INDEX "OrderIntent_status_expiresAt_idx" ON "OrderIntent"("status", "expiresAt");
CREATE INDEX "OrderIntent_restaurantId_createdAt_idx" ON "OrderIntent"("restaurantId", "createdAt");
CREATE UNIQUE INDEX "PaymentAttempt_provider_idempotencyKey_key" ON "PaymentAttempt"("provider", "idempotencyKey");
CREATE UNIQUE INDEX "PaymentAttempt_provider_providerReference_key" ON "PaymentAttempt"("provider", "providerReference");
CREATE INDEX "PaymentAttempt_orderIntentId_createdAt_idx" ON "PaymentAttempt"("orderIntentId", "createdAt");
CREATE INDEX "PaymentAttempt_status_expiresAt_idx" ON "PaymentAttempt"("status", "expiresAt");
CREATE UNIQUE INDEX "Order_orderIntentId_key" ON "Order"("orderIntentId");
CREATE UNIQUE INDEX "Order_confirmingPaymentAttemptId_key" ON "Order"("confirmingPaymentAttemptId");
CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");
CREATE INDEX "Order_restaurantId_status_createdAt_idx" ON "Order"("restaurantId", "status", "createdAt");
CREATE UNIQUE INDEX "CouponRedemption_orderIntentId_key" ON "CouponRedemption"("orderIntentId");
CREATE INDEX "CouponRedemption_couponId_status_createdAt_idx" ON "CouponRedemption"("couponId", "status", "createdAt");
CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");
CREATE INDEX "Refund_orderId_createdAt_idx" ON "Refund"("orderId", "createdAt");
CREATE INDEX "Refund_paymentAttemptId_status_idx" ON "Refund"("paymentAttemptId", "status");
CREATE INDEX "OrderIntentEvent_orderIntentId_createdAt_idx" ON "OrderIntentEvent"("orderIntentId", "createdAt");
CREATE INDEX "PaymentAttemptEvent_paymentAttemptId_createdAt_idx" ON "PaymentAttemptEvent"("paymentAttemptId", "createdAt");
CREATE INDEX "PaymentAttemptEvent_providerEventId_idx" ON "PaymentAttemptEvent"("providerEventId");
CREATE INDEX "OrderStatusHistory_orderId_createdAt_idx" ON "OrderStatusHistory"("orderId", "createdAt");
CREATE UNIQUE INDEX "PaymentWebhookEvent_provider_providerEventId_key" ON "PaymentWebhookEvent"("provider", "providerEventId");
CREATE INDEX "PaymentWebhookEvent_processedAt_receivedAt_idx" ON "PaymentWebhookEvent"("processedAt", "receivedAt");
