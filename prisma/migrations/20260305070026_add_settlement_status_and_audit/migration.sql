-- CreateTable
CREATE TABLE "settlement_status" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlement_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_audits" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "delta" DECIMAL(20,8) NOT NULL,
    "journalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settlementStatusId" TEXT NOT NULL,

    CONSTRAINT "settlement_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "settlement_status_marketId_key" ON "settlement_status"("marketId");

-- CreateIndex
CREATE INDEX "settlement_audits_marketId_idx" ON "settlement_audits"("marketId");

-- CreateIndex
CREATE INDEX "settlement_audits_accountId_idx" ON "settlement_audits"("accountId");

-- AddForeignKey
ALTER TABLE "settlement_status" ADD CONSTRAINT "settlement_status_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_audits" ADD CONSTRAINT "settlement_audits_settlementStatusId_fkey" FOREIGN KEY ("settlementStatusId") REFERENCES "settlement_status"("id") ON DELETE CASCADE ON UPDATE CASCADE;
