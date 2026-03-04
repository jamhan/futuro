-- AlterTable
ALTER TABLE "markets" ADD COLUMN     "indexId" TEXT,
ADD COLUMN     "indexType" TEXT,
ADD COLUMN     "marketType" TEXT NOT NULL DEFAULT 'BINARY';

-- AlterTable
ALTER TABLE "positions" ADD COLUMN     "quantity" DECIMAL(20,8);
