ALTER TABLE "Refund" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "Refund" ADD COLUMN "orderIntentId" UUID;

ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_orderIntentId_fkey"
  FOREIGN KEY ("orderIntentId") REFERENCES "OrderIntent"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Refund_orderIntentId_createdAt_idx" ON "Refund"("orderIntentId", "createdAt");