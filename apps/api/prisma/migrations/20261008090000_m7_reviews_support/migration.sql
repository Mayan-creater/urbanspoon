CREATE TYPE "ReviewModerationStatus" AS ENUM ('PENDING', 'PUBLISHED', 'HIDDEN', 'REJECTED');
CREATE TYPE "ReviewReportStatus" AS ENUM ('OPEN', 'DISMISSED', 'ACTIONED');
CREATE TYPE "SupportCaseStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED');
CREATE TYPE "SupportCategory" AS ENUM ('ORDER', 'PAYMENT', 'ACCOUNT', 'DELIVERY', 'OTHER');
CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

CREATE TABLE "OrderReview" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "restaurantId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "body" VARCHAR(2000) NOT NULL,
  "status" "ReviewModerationStatus" NOT NULL DEFAULT 'PENDING',
  "moderationReason" VARCHAR(500),
  "moderatedByUserId" UUID,
  "moderatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderReview_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
  CONSTRAINT "OrderReview_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderReview_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderReview_moderatedByUserId_fkey" FOREIGN KEY ("moderatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ReviewReport" (
  "id" UUID NOT NULL,
  "reviewId" UUID NOT NULL,
  "reporterUserId" UUID NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "status" "ReviewReportStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReviewReport_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "OrderReview"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReviewReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "SupportCase" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "assignedToUserId" UUID,
  "orderId" UUID,
  "idempotencyKey" TEXT NOT NULL,
  "category" "SupportCategory" NOT NULL,
  "priority" "SupportPriority" NOT NULL DEFAULT 'NORMAL',
  "status" "SupportCaseStatus" NOT NULL DEFAULT 'OPEN',
  "subject" VARCHAR(120) NOT NULL,
  "resolutionSummary" VARCHAR(1000),
  "customerOutcome" VARCHAR(500),
  "resolvedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportCase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupportCase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SupportCase_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "SupportCase_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "SupportMessage" (
  "id" UUID NOT NULL,
  "caseId" UUID NOT NULL,
  "authorUserId" UUID NOT NULL,
  "body" VARCHAR(4000) NOT NULL,
  "isInternal" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupportMessage_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "SupportCase"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SupportMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OrderReview_orderId_key" ON "OrderReview"("orderId");
CREATE UNIQUE INDEX "OrderReview_userId_idempotencyKey_key" ON "OrderReview"("userId", "idempotencyKey");
CREATE INDEX "OrderReview_restaurantId_status_createdAt_idx" ON "OrderReview"("restaurantId", "status", "createdAt");
CREATE INDEX "OrderReview_status_createdAt_idx" ON "OrderReview"("status", "createdAt");
CREATE UNIQUE INDEX "ReviewReport_reviewId_reporterUserId_key" ON "ReviewReport"("reviewId", "reporterUserId");
CREATE INDEX "ReviewReport_status_createdAt_idx" ON "ReviewReport"("status", "createdAt");
CREATE UNIQUE INDEX "SupportCase_userId_idempotencyKey_key" ON "SupportCase"("userId", "idempotencyKey");
CREATE INDEX "SupportCase_userId_status_updatedAt_idx" ON "SupportCase"("userId", "status", "updatedAt");
CREATE INDEX "SupportCase_assignedToUserId_status_updatedAt_idx" ON "SupportCase"("assignedToUserId", "status", "updatedAt");
CREATE INDEX "SupportCase_status_priority_createdAt_idx" ON "SupportCase"("status", "priority", "createdAt");
CREATE INDEX "SupportCase_orderId_idx" ON "SupportCase"("orderId");
CREATE INDEX "SupportMessage_caseId_isInternal_createdAt_idx" ON "SupportMessage"("caseId", "isInternal", "createdAt");

INSERT INTO "RolePermission" ("role", "permission") VALUES
  ('support_agent', 'admin.reviews.moderate'),
  ('support_agent', 'support.cases.manage'),
  ('admin', 'admin.reviews.moderate'),
  ('admin', 'admin.support.manage'),
  ('super_admin', 'admin.reviews.moderate'),
  ('super_admin', 'admin.support.manage')
ON CONFLICT ("role", "permission") DO NOTHING;