ALTER TABLE "DeliveryPartner"
  ADD COLUMN "marketRegion" VARCHAR(2) NOT NULL DEFAULT 'IN',
  ADD CONSTRAINT "DeliveryPartner_marketRegion_check"
    CHECK ("marketRegion" IN ('IN', 'US', 'EU', 'CN', 'RU'));

ALTER TABLE "PartnerPayout"
  ADD COLUMN "provider" VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
  ADD CONSTRAINT "PartnerPayout_provider_check"
    CHECK ("provider" IN ('RAZORPAY_ROUTE', 'STRIPE_CONNECT', 'MANUAL', 'SANDBOX'));