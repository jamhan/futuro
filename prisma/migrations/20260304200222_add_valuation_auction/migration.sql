-- CreateTable
CREATE TABLE "valuation_submissions" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "intervalId" TEXT NOT NULL,
    "fairValue" DECIMAL(20,8) NOT NULL,
    "lowerBand" DECIMAL(20,8) NOT NULL,
    "upperBand" DECIMAL(20,8) NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "valuation_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_results" (
    "id" TEXT NOT NULL,
    "intervalId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "clearingPrice" DECIMAL(20,8) NOT NULL,
    "volume" DECIMAL(20,8) NOT NULL,
    "imbalance" DECIMAL(20,8) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auction_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "valuation_submissions_intervalId_idx" ON "valuation_submissions"("intervalId");

-- CreateIndex
CREATE INDEX "valuation_submissions_marketId_idx" ON "valuation_submissions"("marketId");

-- CreateIndex
CREATE UNIQUE INDEX "valuation_submissions_agentId_marketId_intervalId_key" ON "valuation_submissions"("agentId", "marketId", "intervalId");

-- CreateIndex
CREATE INDEX "auction_results_intervalId_idx" ON "auction_results"("intervalId");

-- CreateIndex
CREATE UNIQUE INDEX "auction_results_intervalId_marketId_key" ON "auction_results"("intervalId", "marketId");
