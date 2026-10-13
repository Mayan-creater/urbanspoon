CREATE TYPE "DeliveryEvidenceType" AS ENUM ('IDENTITY', 'VEHICLE', 'PICKUP_PROOF', 'DELIVERY_PROOF');

ALTER TABLE "PartnerEarning" ADD COLUMN "calculation" JSONB;

CREATE TABLE "DeliveryEvidence" (
  "id" UUID NOT NULL,
  "storageId" UUID NOT NULL,
  "deliveryPartnerId" UUID NOT NULL,
  "deliveryId" UUID,
  "uploadedByUserId" UUID NOT NULL,
  "evidenceType" "DeliveryEvidenceType" NOT NULL,
  "originalFilename" VARCHAR(180) NOT NULL,
  "contentType" VARCHAR(80) NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeliveryEvidence_sizeBytes_check" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 10485760),
  CONSTRAINT "DeliveryEvidence_storageId_key" UNIQUE ("storageId"),
  CONSTRAINT "DeliveryEvidence_deliveryPartnerId_fkey" FOREIGN KEY ("deliveryPartnerId") REFERENCES "DeliveryPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DeliveryEvidence_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DeliveryEvidence_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "DeliveryEvidence_deliveryPartnerId_evidenceType_createdAt_idx" ON "DeliveryEvidence"("deliveryPartnerId", "evidenceType", "createdAt");
CREATE INDEX "DeliveryEvidence_deliveryId_evidenceType_createdAt_idx" ON "DeliveryEvidence"("deliveryId", "evidenceType", "createdAt");