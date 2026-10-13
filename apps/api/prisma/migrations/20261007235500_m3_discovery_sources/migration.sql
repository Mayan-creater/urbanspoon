ALTER TABLE "Restaurant"
  ADD COLUMN "estimatedEtaMinMinutes" INTEGER,
  ADD COLUMN "estimatedEtaMaxMinutes" INTEGER,
  ADD CONSTRAINT "Restaurant_eta_bounds_check"
    CHECK (
      ("estimatedEtaMinMinutes" IS NULL) = ("estimatedEtaMaxMinutes" IS NULL)
      AND ("estimatedEtaMinMinutes" IS NULL OR "estimatedEtaMinMinutes" BETWEEN 1 AND 240)
      AND ("estimatedEtaMaxMinutes" IS NULL OR "estimatedEtaMaxMinutes" BETWEEN "estimatedEtaMinMinutes" AND 240)
    );

CREATE TABLE "RestaurantRatingSnapshot" (
  "id" UUID NOT NULL,
  "restaurantId" UUID NOT NULL,
  "averageRating" DOUBLE PRECISION NOT NULL,
  "reviewCount" INTEGER NOT NULL,
  "source" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RestaurantRatingSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RestaurantRatingSnapshot_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RestaurantRatingSnapshot_averageRating_check" CHECK ("averageRating" BETWEEN 0 AND 5),
  CONSTRAINT "RestaurantRatingSnapshot_reviewCount_check" CHECK ("reviewCount" > 0)
);

CREATE TABLE "RestaurantOffer" (
  "id" UUID NOT NULL,
  "restaurantId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "terms" TEXT,
  "redemptionInstructions" TEXT NOT NULL,
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RestaurantOffer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RestaurantOffer_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RestaurantOffer_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RestaurantOffer_validity_check" CHECK ("validFrom" < "validUntil")
);

CREATE UNIQUE INDEX "RestaurantRatingSnapshot_restaurantId_key"
  ON "RestaurantRatingSnapshot"("restaurantId");
CREATE INDEX "RestaurantOffer_restaurantId_isActive_validFrom_validUntil_idx"
  ON "RestaurantOffer"("restaurantId", "isActive", "validFrom", "validUntil");