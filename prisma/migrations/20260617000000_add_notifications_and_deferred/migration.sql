-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('USER_REGISTERED', 'USER_ONBOARDING_COMPLETED', 'APPLICATION_SUBMITTED', 'APPLICATION_STATUS_CHANGED', 'UNIVERSITY_CREATED', 'UNIVERSITY_UPDATED', 'UNIVERSITY_DELETED', 'CACHE_CLEARED', 'SCHOLARSHIP_DEADLINE_APPROACHING', 'SYSTEM_ALERT');

-- AlterEnum
ALTER TYPE "ApplicationStatus" ADD VALUE 'DEFERRED';

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metadata" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_isRead_idx" ON "Notification"("isRead");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");
