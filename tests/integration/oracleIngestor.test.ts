/**
 * Integration test: oracle ingestor reads files, creates OracleObservation,
 * triggers resolve for LOCKED markets.
 */
import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import { getPrismaClient } from '../../src/db/client';
import { OracleIngestor } from '../../src/services/oracleIngestor';
import { MarketState, MarketType } from '../../src/domain/types';
import { IndexType } from '../../src/domain/types';

const prisma = getPrismaClient();

describe('OracleIngestor', () => {
  let tempDir: string;
  let marketId: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-ingest-'));
    const market = await prisma.market.create({
      data: {
        description: 'Test rainfall market',
        location: 'Sydney, NSW',
        eventDate: new Date('2026-03-23'),
        condition: 'weekly_weather_rainfall',
        state: MarketState.LOCKED,
        marketType: MarketType.FUTURES,
        indexType: IndexType.WEATHER_RAINFALL,
        indexId: '066062_weather_rainfall_2026-03-23',
        minPrice: 0,
        maxPrice: 500,
        contractMultiplier: 0.02,
      },
    });
    marketId = market.id;
  });

  afterAll(async () => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
    await prisma.oracleObservation.deleteMany({ where: { marketId } });
    await prisma.oracleResult.deleteMany({ where: { marketId } });
    await prisma.market.deleteMany({ where: { id: marketId } });
  });

  it('ingests file, creates OracleObservation, and triggers resolve for LOCKED market', async () => {
    const filePath = path.join(tempDir, '066062_weather_rainfall_2026-03-23.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        indexId: '066062_weather_rainfall_2026-03-23',
        value: 25.5,
        collected_at: '2026-03-20T00:05:00+11:00',
        source: 'bom',
      })
    );

    const ingestor = new OracleIngestor();
    const result = await ingestor.ingestFromFiles(tempDir);

    expect(result.filesRead).toBe(1);
    expect(result.observationsCreated).toBe(1);
    expect(result.marketsResolved).toBe(1);
    expect(result.errors).toHaveLength(0);

    const obs = await prisma.oracleObservation.findUnique({
      where: { marketId },
    });
    expect(obs).not.toBeNull();
    expect(parseFloat(obs!.value.toString())).toBe(25.5);
    expect(obs!.source).toBe('bom');

    const oracleResult = await prisma.oracleResult.findUnique({
      where: { marketId },
    });
    expect(oracleResult).not.toBeNull();
    expect(parseFloat(oracleResult!.value.toString())).toBe(25.5);

    const market = await prisma.market.findUnique({
      where: { id: marketId },
    });
    expect(market!.state).toBe(MarketState.RESOLVED);
  });
});
