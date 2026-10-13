CREATE TYPE "GroupOrderStatus" AS ENUM ('OPEN', 'LOCKED', 'CHECKED_OUT', 'EXPIRED');

ALTER TABLE "CartItem" ADD COLUMN "addedByUserId" UUID;
UPDATE "CartItem" AS item
SET "addedByUserId" = cart."userId"
FROM "Cart" AS cart
WHERE item."cartId" = cart."id";
ALTER TABLE "CartItem" ALTER COLUMN "addedByUserId" SET NOT NULL;
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_addedByUserId_fkey"
    FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CartItem_addedByUserId_createdAt_idx" ON "CartItem"("addedByUserId", "createdAt");

CREATE TABLE "GroupOrder" (
    "id" UUID NOT NULL,
    "cartId" UUID NOT NULL,
    "orderIntentId" UUID,
    "hostUserId" UUID NOT NULL,
    "status" "GroupOrderStatus" NOT NULL DEFAULT 'OPEN',
    "deadlineAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "checkedOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GroupOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroupOrderMember" (
    "id" UUID NOT NULL,
    "groupOrderId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupOrderMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroupOrderInvite" (
    "id" UUID NOT NULL,
    "groupOrderId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "consumedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupOrderInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GroupOrder_cartId_key" ON "GroupOrder"("cartId");
CREATE UNIQUE INDEX "GroupOrder_orderIntentId_key" ON "GroupOrder"("orderIntentId");
CREATE INDEX "GroupOrder_hostUserId_status_createdAt_idx" ON "GroupOrder"("hostUserId", "status", "createdAt");
CREATE INDEX "GroupOrder_status_deadlineAt_idx" ON "GroupOrder"("status", "deadlineAt");
CREATE UNIQUE INDEX "GroupOrderMember_groupOrderId_userId_key" ON "GroupOrderMember"("groupOrderId", "userId");
CREATE INDEX "GroupOrderMember_userId_joinedAt_idx" ON "GroupOrderMember"("userId", "joinedAt");
CREATE UNIQUE INDEX "GroupOrderInvite_tokenHash_key" ON "GroupOrderInvite"("tokenHash");
CREATE INDEX "GroupOrderInvite_groupOrderId_expiresAt_consumedAt_idx" ON "GroupOrderInvite"("groupOrderId", "expiresAt", "consumedAt");

ALTER TABLE "GroupOrder" ADD CONSTRAINT "GroupOrder_cartId_fkey"
    FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupOrder" ADD CONSTRAINT "GroupOrder_orderIntentId_fkey"
    FOREIGN KEY ("orderIntentId") REFERENCES "OrderIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GroupOrder" ADD CONSTRAINT "GroupOrder_hostUserId_fkey"
    FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupOrderMember" ADD CONSTRAINT "GroupOrderMember_groupOrderId_fkey"
    FOREIGN KEY ("groupOrderId") REFERENCES "GroupOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupOrderMember" ADD CONSTRAINT "GroupOrderMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupOrderInvite" ADD CONSTRAINT "GroupOrderInvite_groupOrderId_fkey"
    FOREIGN KEY ("groupOrderId") REFERENCES "GroupOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupOrderInvite" ADD CONSTRAINT "GroupOrderInvite_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupOrderInvite" ADD CONSTRAINT "GroupOrderInvite_consumedByUserId_fkey"
    FOREIGN KEY ("consumedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;