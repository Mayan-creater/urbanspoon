ALTER TABLE "PasswordReset"
ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "UserAddress_one_default_per_user_key"
ON "UserAddress" ("userId")
WHERE "isDefault" = true;