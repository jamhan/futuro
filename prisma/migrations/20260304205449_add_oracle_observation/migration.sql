-- CreateTable
CREATE TABLE "oracle_observations" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "value" DECIMAL(20,8) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "oracle_observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oracle_observations_marketId_key" ON "oracle_observations"("marketId");

-- AddForeignKey
ALTER TABLE "oracle_observations" ADD CONSTRAINT "oracle_observations_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
