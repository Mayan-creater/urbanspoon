ALTER TABLE "OrderIntent"
  ADD COLUMN "tipMinor" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "OrderIntent_tipMinor_check" CHECK ("tipMinor" >= 0);

ALTER TABLE "Order"
  ADD COLUMN "tipMinor" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "Order_tipMinor_check" CHECK ("tipMinor" >= 0);