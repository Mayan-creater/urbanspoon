CREATE TYPE "RestaurantStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

CREATE TABLE "Restaurant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "cuisineTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "addressLine1" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "status" "RestaurantStatus" NOT NULL DEFAULT 'PENDING',
    "isAcceptingOrders" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Restaurant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Restaurant_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "RestaurantHours" (
    "id" UUID NOT NULL,
    "restaurantId" UUID NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "openTime" TEXT NOT NULL,
    "closeTime" TEXT NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "RestaurantHours_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RestaurantHours_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RestaurantHours_dayOfWeek_check" CHECK ("dayOfWeek" BETWEEN 0 AND 6)
);

CREATE TABLE "MenuCategory" (
    "id" UUID NOT NULL,
    "restaurantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MenuCategory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MenuCategory_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "MenuItem" (
    "id" UUID NOT NULL,
    "restaurantId" UUID NOT NULL,
    "categoryId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "dietaryTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "imageUrl" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MenuItem_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MenuItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MenuCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MenuItem_priceMinor_check" CHECK ("priceMinor" >= 0)
);

CREATE TABLE "MenuOptionGroup" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "minSelections" INTEGER NOT NULL DEFAULT 0,
    "maxSelections" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MenuOptionGroup_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MenuOptionGroup_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MenuOptionGroup_selection_bounds_check" CHECK ("minSelections" >= 0 AND "maxSelections" >= "minSelections")
);

CREATE TABLE "MenuOption" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "priceDeltaMinor" INTEGER NOT NULL DEFAULT 0,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MenuOption_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MenuOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "MenuOptionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MenuOption_priceDeltaMinor_check" CHECK ("priceDeltaMinor" >= 0)
);

CREATE UNIQUE INDEX "Restaurant_slug_key" ON "Restaurant"("slug");
CREATE INDEX "Restaurant_status_isAcceptingOrders_city_idx" ON "Restaurant"("status", "isAcceptingOrders", "city");
CREATE INDEX "Restaurant_createdByUserId_createdAt_idx" ON "Restaurant"("createdByUserId", "createdAt");
CREATE UNIQUE INDEX "RestaurantHours_restaurantId_dayOfWeek_key" ON "RestaurantHours"("restaurantId", "dayOfWeek");
CREATE INDEX "RestaurantHours_restaurantId_dayOfWeek_idx" ON "RestaurantHours"("restaurantId", "dayOfWeek");
CREATE UNIQUE INDEX "MenuCategory_restaurantId_name_key" ON "MenuCategory"("restaurantId", "name");
CREATE INDEX "MenuCategory_restaurantId_isActive_sortOrder_idx" ON "MenuCategory"("restaurantId", "isActive", "sortOrder");
CREATE INDEX "MenuItem_restaurantId_isAvailable_archivedAt_sortOrder_idx" ON "MenuItem"("restaurantId", "isAvailable", "archivedAt", "sortOrder");
CREATE INDEX "MenuItem_categoryId_isAvailable_archivedAt_idx" ON "MenuItem"("categoryId", "isAvailable", "archivedAt");
CREATE INDEX "MenuOptionGroup_itemId_sortOrder_idx" ON "MenuOptionGroup"("itemId", "sortOrder");
CREATE INDEX "MenuOption_groupId_isAvailable_sortOrder_idx" ON "MenuOption"("groupId", "isAvailable", "sortOrder");

INSERT INTO "RolePermission" ("role", "permission") VALUES
  ('restaurant_owner', 'restaurant.menu.manage'),
  ('restaurant_staff', 'restaurant.menu.manage')
ON CONFLICT ("role", "permission") DO NOTHING;