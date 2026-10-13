CREATE TYPE "DeliveryPartnerVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');
CREATE TYPE "DeliveryPartnerAvailability" AS ENUM ('OFFLINE', 'ONLINE', 'BUSY', 'SUSPENDED');
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING_ASSIGNMENT', 'ASSIGNED', 'ARRIVED_AT_RESTAURANT', 'PICKED_UP', 'ARRIVED', 'DELIVERED', 'FAILED', 'CANCELLED');
CREATE TYPE "DeliveryAssignmentStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN', 'RELEASED');
CREATE TYPE "PartnerEarningType" AS ENUM ('BASE', 'DISTANCE', 'INCENTIVE', 'TIP', 'ADJUSTMENT');
CREATE TYPE "PartnerEarningStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'REVERSED');

CREATE TABLE "DeliveryPartner" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "verificationStatus" "DeliveryPartnerVerificationStatus" NOT NULL DEFAULT 'PENDING',
  "availability" "DeliveryPartnerAvailability" NOT NULL DEFAULT 'OFFLINE',
  "vehicleType" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "verifiedByUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryPartner_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeliveryPartner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeliveryPartner_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Delivery" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "deliveryPartnerId" UUID,
  "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING_ASSIGNMENT',
  "deliveryOtpHash" VARCHAR(64) NOT NULL,
  "failureReason" TEXT,
  "assignedAt" TIMESTAMP(3),
  "arrivedAtRestaurantAt" TIMESTAMP(3),
  "pickedUpAt" TIMESTAMP(3),
  "arrivedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Delivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Delivery_deliveryPartnerId_fkey" FOREIGN KEY ("deliveryPartnerId") REFERENCES "DeliveryPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "DeliveryAssignment" (
  "id" UUID NOT NULL,
  "deliveryId" UUID NOT NULL,
  "deliveryPartnerId" UUID NOT NULL,
  "status" "DeliveryAssignmentStatus" NOT NULL DEFAULT 'OFFERED',
  "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "respondedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeliveryAssignment_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DeliveryAssignment_deliveryPartnerId_fkey" FOREIGN KEY ("deliveryPartnerId") REFERENCES "DeliveryPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "DeliveryStatusHistory" (
  "id" UUID NOT NULL,
  "deliveryId" UUID NOT NULL,
  "actorUserId" UUID,
  "fromStatus" "DeliveryStatus",
  "toStatus" "DeliveryStatus" NOT NULL,
  "reason" TEXT,
  "correlationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryStatusHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeliveryStatusHistory_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DeliveryStatusHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "PartnerLocation" (
  "id" UUID NOT NULL,
  "deliveryPartnerId" UUID NOT NULL,
  "deliveryId" UUID,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "accuracyM" DOUBLE PRECISION,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerLocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PartnerLocation_deliveryPartnerId_fkey" FOREIGN KEY ("deliveryPartnerId") REFERENCES "DeliveryPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PartnerLocation_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PartnerLocation_coordinates_check" CHECK ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180),
  CONSTRAINT "PartnerLocation_accuracy_check" CHECK ("accuracyM" IS NULL OR "accuracyM" >= 0)
);

CREATE TABLE "PartnerEarning" (
  "id" UUID NOT NULL,
  "deliveryPartnerId" UUID NOT NULL,
  "deliveryId" UUID NOT NULL,
  "earningType" "PartnerEarningType" NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "status" "PartnerEarningStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartnerEarning_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PartnerEarning_deliveryPartnerId_fkey" FOREIGN KEY ("deliveryPartnerId") REFERENCES "DeliveryPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PartnerEarning_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PartnerEarning_amount_check" CHECK ("amountMinor" >= 0)
);

CREATE UNIQUE INDEX "DeliveryPartner_userId_key" ON "DeliveryPartner"("userId");
CREATE INDEX "DeliveryPartner_verificationStatus_availability_updatedAt_idx" ON "DeliveryPartner"("verificationStatus", "availability", "updatedAt");
CREATE UNIQUE INDEX "Delivery_orderId_key" ON "Delivery"("orderId");
CREATE INDEX "Delivery_status_createdAt_idx" ON "Delivery"("status", "createdAt");
CREATE INDEX "Delivery_deliveryPartnerId_status_updatedAt_idx" ON "Delivery"("deliveryPartnerId", "status", "updatedAt");
CREATE INDEX "DeliveryAssignment_deliveryPartnerId_status_expiresAt_idx" ON "DeliveryAssignment"("deliveryPartnerId", "status", "expiresAt");
CREATE INDEX "DeliveryAssignment_deliveryId_status_offeredAt_idx" ON "DeliveryAssignment"("deliveryId", "status", "offeredAt");
CREATE UNIQUE INDEX "DeliveryAssignment_one_accepted_per_delivery_key" ON "DeliveryAssignment"("deliveryId") WHERE "status" = 'ACCEPTED';
CREATE INDEX "DeliveryStatusHistory_deliveryId_createdAt_idx" ON "DeliveryStatusHistory"("deliveryId", "createdAt");
CREATE INDEX "PartnerLocation_deliveryPartnerId_recordedAt_idx" ON "PartnerLocation"("deliveryPartnerId", "recordedAt");
CREATE INDEX "PartnerLocation_deliveryId_recordedAt_idx" ON "PartnerLocation"("deliveryId", "recordedAt");
CREATE UNIQUE INDEX "PartnerEarning_deliveryId_earningType_key" ON "PartnerEarning"("deliveryId", "earningType");
CREATE INDEX "PartnerEarning_deliveryPartnerId_status_createdAt_idx" ON "PartnerEarning"("deliveryPartnerId", "status", "createdAt");