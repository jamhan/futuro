import { Router } from 'express';
import Decimal from 'decimal.js';
import agentsRouter from './agents';
import auctionRouter from './auction';
import adminRouter from './admin';
import { ExchangeService } from '../services/exchangeService';
import { MarketRepository } from '../repositories/marketRepository';
import { OrderRepository } from '../repositories/orderRepository';
import { TradeRepository } from '../repositories/tradeRepository';
import { AccountRepository } from '../repositories/accountRepository';
import { OracleService } from '../services/oracle';
import { MockWeatherOracle } from '../services/oracle';
import { SettlementService } from '../services/settlement';
import { LedgerService } from '../services/ledgerService';
import { getLeaderboard } from '../services/leaderboardService';
import { agentOrdersTotal, agentOrderRejectionsTotal } from '../services/metrics';
import { getIndexValueForMarket } from '../services/indexProviders';
import { MarketLifecycle } from '../domain/market';
import { isFuturesMarket } from '../engine/futuresMatchingGuard';
import { MarketState, MarketType, OrderSide, OrderType, Outcome } from '../domain/types';
import { getPrismaClient } from '../db/client';
import { agentRateLimitMiddleware } from '../middleware/agentRateLimit';
import { agentPerMarketRateLimitMiddleware } from '../middleware/agentPerMarketRateLimit';
import { isOrderRejectionError } from '../errors/orderRejection';
import { z } from 'zod';

const router = Router();
const prisma = getPrismaClient();

const exchangeService = new ExchangeService();
const marketRepo = new MarketRepository();
const orderRepo = new OrderRepository();
const tradeRepo = new TradeRepository();
const accountRepo = new AccountRepository();
const oracleService = new OracleService(new MockWeatherOracle());
const settlementService = new SettlementService();
const ledgerService = new LedgerService();

// Validation schemas
const createMarketSchema = z.object({
  description: z.string(),
  location: z.string(),
  eventDate: z.string().transform((str) => new Date(str)),
  condition: z.string(),
  marketType: z.enum(['BINARY', 'FUTURES']).optional(),
  indexType: z.string().optional(),
  indexId: z.string().optional(),
});

const placeOrderSchema = z.object({
  marketId: z.string(),
  accountId: z.string().optional(), // Optional when using X-Agent-Key
  side: z.enum(['BUY_YES', 'BUY_NO', 'BUY', 'SELL']),
  type: z.enum(['LIMIT', 'MARKET']),
  price: z.number().positive().nullable().optional(),
  quantity: z.number().positive(),
});

const cancelOrderSchema = z.object({
  accountId: z.string().optional(), // Optional when using X-Agent-Key
});

// Agent admin
router.use('/agents', agentsRouter);

// Admin (oracle import, etc.)
router.use('/admin', adminRouter);

// Auction (valuations, etc.)
router.use('/auction', auctionRouter);

// Leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const entries = await getLeaderboard();
    res.json(entries);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});


// Markets
router.get('/markets', async (req, res) => {
  try {
    const markets = await marketRepo.findAll();
    res.json(markets);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/markets/:id', async (req, res) => {
  try {
    const market = await marketRepo.findById(req.params.id);
    if (!market) {
      return res.status(404).json({ error: 'Market not found' });
    }
    res.json(market);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/markets', async (req, res) => {
  try {
    const data = createMarketSchema.parse(req.body);
    const market = await marketRepo.create({
      ...data,
      marketType: (data.marketType as MarketType) ?? MarketType.BINARY,
      indexType: data.indexType ?? null,
      indexId: data.indexId ?? null,
      state: MarketState.DRAFT,
      winningOutcome: null,
      lockedAt: null,
      resolvedAt: null,
      settledAt: null,
    });
    res.status(201).json(market);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

router.post('/markets/:id/open', async (req, res) => {
  try {
    const market = await marketRepo.findById(req.params.id);
    if (!market) {
      return res.status(404).json({ error: 'Market not found' });
    }

    if (!MarketLifecycle.canTransition(market.state, MarketState.OPEN)) {
      return res.status(400).json({ error: 'Invalid state transition' });
    }

    const updated = await marketRepo.updateState(req.params.id, MarketState.OPEN);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/markets/:id/lock', async (req, res) => {
  try {
    const market = await marketRepo.findById(req.params.id);
    if (!market) {
      return res.status(404).json({ error: 'Market not found' });
    }

    if (!MarketLifecycle.canTransition(market.state, MarketState.LOCKED)) {
      return res.status(400).json({ error: 'Invalid state transition' });
    }

    const updated = await marketRepo.updateState(req.params.id, MarketState.LOCKED, {
      lockedAt: new Date(),
    });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

const resolveMarketSchema = z.object({
  indexValue: z.number().positive().optional(), // For FUTURES: settlement index value
});

router.post('/markets/:id/resolve', async (req, res) => {
  try {
    const market = await marketRepo.findById(req.params.id);
    if (!market) {
      return res.status(404).json({ error: 'Market not found' });
    }

    if (!MarketLifecycle.canResolve(market.state)) {
      return res.status(400).json({ error: 'Market cannot be resolved' });
    }

    const body = resolveMarketSchema.safeParse(req.body || {});
    const indexValue = body.success ? body.data.indexValue : undefined;

    let outcome: Outcome;
    let value: number;
    let source: string;

    if (isFuturesMarket(market)) {
      const observation = await prisma.oracleObservation.findUnique({
        where: { marketId: req.params.id },
      });
      if (observation) {
        value = parseFloat(observation.value.toString());
        outcome = Outcome.YES;
        source = observation.source;
      } else if (indexValue != null) {
        value = indexValue;
        outcome = Outcome.YES;
        source = 'manual';
      } else {
        value = await getIndexValueForMarket(market, indexValue);
        outcome = Outcome.YES;
        source = 'mock';
      }
    } else {
      const oracleResult = await oracleService.resolveMarket(market);
      outcome = oracleResult.outcome;
      value = oracleResult.value;
      source = oracleResult.source;
    }

    await prisma.oracleResult.upsert({
      where: { marketId: req.params.id },
      create: {
        marketId: req.params.id,
        outcome,
        value,
        source,
      },
      update: { outcome, value, source },
    });

    const updated = await marketRepo.updateState(req.params.id, MarketState.RESOLVED, {
      resolvedAt: new Date(),
      winningOutcome: outcome,
    });

    res.json({ market: updated, oracleResult: { outcome, value, source } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/markets/:id/settle', async (req, res) => {
  try {
    const market = await marketRepo.findById(req.params.id);
    if (!market) {
      return res.status(404).json({ error: 'Market not found' });
    }
    if (!MarketLifecycle.canTransition(market.state, MarketState.SETTLED)) {
      return res.status(400).json({ error: 'Market must be RESOLVED to settle' });
    }

    const oracle = await prisma.oracleResult.findUnique({
      where: { marketId: req.params.id },
    });
    if (!oracle) {
      return res.status(400).json({ error: 'Market has no oracle result; resolve first' });
    }

    const positions = await accountRepo.findPositionsByMarket(req.params.id);
    const winningOutcome = (oracle.outcome as Outcome) || Outcome.YES;
    const indexValue = new Decimal(oracle.value.toString());
    const contractMultiplier =
      market.contractMultiplier != null ? market.contractMultiplier : new Decimal(1);
    const options = isFuturesMarket(market)
      ? { marketType: MarketType.FUTURES, indexValue, contractMultiplier }
      : undefined;

    const settlements = settlementService.calculateSettlements(
      positions,
      winningOutcome,
      options
    );

    const journalLines = [];
    for (const [accountId, payout] of settlements) {
      const p = new Decimal(payout.toString());
      if (p.gt(0)) {
        journalLines.push({
          accountId,
          debit: new Decimal(0),
          credit: p,
        });
      } else if (p.lt(0)) {
        journalLines.push({
          accountId,
          debit: p.abs(),
          credit: new Decimal(0),
        });
      }
    }
    if (journalLines.length > 0) {
      await ledgerService.postJournal(
        journalLines,
        { description: 'settlement', refId: req.params.id }
      );
    }

    const updated = await marketRepo.updateState(req.params.id, MarketState.SETTLED, {
      settledAt: new Date(),
    });

    res.json({ market: updated, settlements: Object.fromEntries(settlements) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Orders (all orders for the market; for order book, filter client-side or use ?resting=1)
router.get('/markets/:marketId/orders', async (req, res) => {
  try {
    let orders = await orderRepo.findByMarket(req.params.marketId);
    if (req.query.resting === '1') {
      orders = orders.filter(
        (o) => o.status === 'PENDING' || o.status === 'PARTIALLY_FILLED'
      );
    }
    // Serialize with plain numbers so client never sees Decimal objects or wrong values
    res.json(
      orders.map((o) => ({
        id: o.id,
        marketId: o.marketId,
        accountId: o.accountId,
        side: o.side,
        type: o.type,
        price: o.price != null ? Number(o.price.toString()) : null,
        quantity: Number(o.quantity.toString()),
        filledQuantity: Number(o.filledQuantity.toString()),
        status: o.status,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      }))
    );
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/orders', agentPerMarketRateLimitMiddleware, agentRateLimitMiddleware, async (req, res) => {
  try {
    const data = placeOrderSchema.parse(req.body);
    const effectiveAccountId = req.accountId ?? data.accountId;
    if (!effectiveAccountId) {
      return res.status(400).json({ error: 'accountId required (or use X-Agent-Key)' });
    }
    if (req.agent && data.accountId && data.accountId !== req.accountId) {
      return res.status(403).json({ error: 'Agent can only trade on own account' });
    }
    const result = await exchangeService.placeOrder({
      marketId: data.marketId,
      accountId: effectiveAccountId,
      side: data.side as OrderSide,
      type: data.type as OrderType,
      price: data.price !== null && data.price !== undefined ? new Decimal(data.price) : null,
      quantity: new Decimal(data.quantity),
    });
    if (req.agent) {
      agentOrdersTotal.inc({ agent_id: req.agent.id });
    }
    res.status(201).json(result);
  } catch (error: any) {
    if (req.agent) {
      const reason = isOrderRejectionError(error) ? error.code : (error.message?.slice(0, 50) ?? 'unknown');
      agentOrderRejectionsTotal.inc({ reason });
    }
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    if (isOrderRejectionError(error)) {
      return res.status(400).json({ error: error.toJSON() });
    }
    res.status(400).json({ error: error.message });
  }
});

router.delete('/orders/:id', async (req, res) => {
  try {
    const data = cancelOrderSchema.parse(req.query);
    const effectiveAccountId = req.accountId ?? data.accountId;
    if (!effectiveAccountId) {
      return res.status(400).json({
        error: 'accountId required in query (or use X-Agent-Key)',
      });
    }
    if (req.agent && data.accountId && data.accountId !== req.accountId) {
      return res.status(403).json({ error: 'Agent can only cancel orders for own account' });
    }
    const order = await exchangeService.cancelOrder(req.params.id, effectiveAccountId);
    res.json(order);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    res.status(400).json({ error: error.message });
  }
});

// Trades
router.get('/markets/:marketId/trades', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const trades = await tradeRepo.findByMarket(req.params.marketId, limit);
    res.json(trades);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Accounts
router.get('/accounts/:id', async (req, res) => {
  try {
    if (req.agent && req.params.id !== req.accountId) {
      return res.status(403).json({ error: 'Agent can only access own account' });
    }
    const account = await accountRepo.findById(req.params.id);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    res.json(account);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/accounts', async (req, res) => {
  try {
    const balance = req.body.balance ? new Decimal(req.body.balance) : new Decimal(1000);
    const account = await accountRepo.create({ balance });
    res.status(201).json(account);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

