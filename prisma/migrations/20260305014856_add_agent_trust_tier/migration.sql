-- CreateEnum
CREATE TYPE "AgentTrustTier" AS ENUM ('UNVERIFIED', 'VERIFIED', 'TRUSTED');

-- AlterTable
ALTER TABLE "agent_profiles" ADD COLUMN "trustTier" "AgentTrustTier" NOT NULL DEFAULT 'UNVERIFIED';

-- Existing agents (admin-created) are treated as VERIFIED so they keep normal rate limits
UPDATE "agent_profiles" SET "trustTier" = 'VERIFIED';
