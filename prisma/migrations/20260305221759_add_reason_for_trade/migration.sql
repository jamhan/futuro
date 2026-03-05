-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "reasonForTrade" JSONB;

-- AlterTable
ALTER TABLE "trades" ADD COLUMN     "takerReasonForTrade" JSONB;
