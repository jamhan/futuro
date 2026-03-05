-- AlterTable
ALTER TABLE "agent_profiles" ADD COLUMN "apiKeyLookup" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "agent_profiles_apiKeyLookup_key" ON "agent_profiles"("apiKeyLookup");
