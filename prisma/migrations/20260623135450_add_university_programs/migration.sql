/*
  Warnings:

  - You are about to drop the column `programId` on the `Application` table. All the data in the column will be lost.
  - Added the required column `program` to the `Application` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ApplicationStatus" ADD VALUE 'VERIFIED';
ALTER TYPE "ApplicationStatus" ADD VALUE 'FLAGGED';
ALTER TYPE "ApplicationStatus" ADD VALUE 'NEEDS_DOCUMENT';

-- AlterTable
ALTER TABLE "Application" DROP COLUMN "programId",
ADD COLUMN     "program" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "University" ADD COLUMN     "details" JSONB,
ADD COLUMN     "programs" TEXT[];

-- CreateTable
CREATE TABLE "UniversityMatchScore" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "matchScore" INTEGER NOT NULL,
    "reasons" TEXT[],
    "warnings" TEXT[],
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UniversityMatchScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UniversityMatchScore_userId_idx" ON "UniversityMatchScore"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UniversityMatchScore_userId_universityId_key" ON "UniversityMatchScore"("userId", "universityId");

-- AddForeignKey
ALTER TABLE "UniversityMatchScore" ADD CONSTRAINT "UniversityMatchScore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniversityMatchScore" ADD CONSTRAINT "UniversityMatchScore_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE CASCADE ON UPDATE CASCADE;
