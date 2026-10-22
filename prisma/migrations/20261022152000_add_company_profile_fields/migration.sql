-- Add optional company profile fields present in Prisma schema
ALTER TABLE "companies"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "address" TEXT,
  ADD COLUMN "logoUrl" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "website" TEXT;
