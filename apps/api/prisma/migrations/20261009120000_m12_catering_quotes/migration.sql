CREATE TYPE "CateringRequestStatus" AS ENUM ('OPEN', 'WITHDRAWN', 'CLOSED');
CREATE TYPE "CateringQuoteStatus" AS ENUM ('SUBMITTED', 'SUPERSEDED', 'WITHDRAWN');

ALTER TABLE "Restaurant"
ADD COLUMN "supportsCatering" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "CateringRequest" (
    "id" UUID NOT NULL,
    "customerUserId" UUID NOT NULL,
    "status" "CateringRequestStatus" NOT NULL DEFAULT 'OPEN',
    "guestCount" INTEGER NOT NULL,
    "budgetMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "cuisineTypes" TEXT[] NOT NULL,
    "dietaryTags" TEXT[] NOT NULL,
    "occasion" VARCHAR(100) NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "city" VARCHAR(80) NOT NULL,
    "state" VARCHAR(80) NOT NULL,
    "postalCode" VARCHAR(12) NOT NULL,
    "venueAddress" VARCHAR(180) NOT NULL,
    "details" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CateringRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CateringQuote" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "restaurantId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "CateringQuoteStatus" NOT NULL DEFAULT 'SUBMITTED',
    "amountMinor" INTEGER NOT NULL,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL,
    "inclusions" TEXT[] NOT NULL,
    "message" VARCHAR(1000),
    "validUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CateringQuote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CateringRequest_customerUserId_createdAt_idx" ON "CateringRequest"("customerUserId", "createdAt");
CREATE INDEX "CateringRequest_city_status_eventAt_idx" ON "CateringRequest"("city", "status", "eventAt");
CREATE UNIQUE INDEX "CateringQuote_requestId_restaurantId_revision_key" ON "CateringQuote"("requestId", "restaurantId", "revision");
CREATE INDEX "CateringQuote_requestId_status_validUntil_idx" ON "CateringQuote"("requestId", "status", "validUntil");
CREATE INDEX "CateringQuote_restaurantId_status_createdAt_idx" ON "CateringQuote"("restaurantId", "status", "createdAt");

ALTER TABLE "CateringRequest" ADD CONSTRAINT "CateringRequest_customerUserId_fkey"
FOREIGN KEY ("customerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CateringQuote" ADD CONSTRAINT "CateringQuote_requestId_fkey"
FOREIGN KEY ("requestId") REFERENCES "CateringRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CateringQuote" ADD CONSTRAINT "CateringQuote_restaurantId_fkey"
FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CateringQuote" ADD CONSTRAINT "CateringQuote_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;