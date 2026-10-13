ALTER TABLE "Restaurant"
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION,
  ADD COLUMN "serviceRadiusKm" DOUBLE PRECISION NOT NULL DEFAULT 10,
  ADD CONSTRAINT "Restaurant_coordinates_pair_check"
    CHECK (("latitude" IS NULL) = ("longitude" IS NULL)),
  ADD CONSTRAINT "Restaurant_serviceRadiusKm_check"
    CHECK ("serviceRadiusKm" > 0 AND "serviceRadiusKm" <= 100),
  ADD CONSTRAINT "Restaurant_latitude_check"
    CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "Restaurant_longitude_check"
    CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180);

CREATE TABLE "RestaurantFavorite" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "restaurantId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RestaurantFavorite_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RestaurantFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RestaurantFavorite_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RestaurantFavorite_userId_restaurantId_key"
  ON "RestaurantFavorite"("userId", "restaurantId");
CREATE INDEX "RestaurantFavorite_restaurantId_createdAt_idx"
  ON "RestaurantFavorite"("restaurantId", "createdAt");
