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
import { getLeaderboard } from '../services/leaderboardService';
import { agentOrdersTotal, agentOrderRejectionsTotal } from '../services/metrics';
import { getIndexValueForMarket } from '../services/indexProviders';
import { MarketLifecycle, Market } from '../domain/market';
import { isFuturesMarket } from '../engine/futuresMatchingGuard';
import { MarketState, MarketType, OrderSide, OrderType, Outcome } from '../domain/types';
import { getPrismaClient } from '../db/client';
import { agentRateLimitMiddleware } from '../middleware/agentRateLimit';
import { requireTrustedAgentMiddleware } from '../middleware/requireTrustedAgent';
import { agentPerMarketRateLimitMiddleware } from '../middleware/agentPerMarketRateLimit';
import { isOrderRejectionError } from '../errors/orderRejection';
import { broadcast } from '../services/wsBroadcast';
import { z } from 'zod';

const router = Router();
const prisma = getPrismaClient();

const exchangeService = new ExchangeService();
const marketRepo = new MarketRepository();
const orderRepo = new OrderRepository();
const tradeRepo = new TradeRepository();
const accountRepo = new AccountRepository();
const oracleService = new OracleService(new MockWeatherOracle());

const decimalToNumber = (value?: Decimal | null): number | null =>
  value != null ? Number(value.toString()) : null;

const buildConfidenceIntervalExample = (market: Market): [number, number] => {
  const marketType = market.marketType ?? MarketType.BINARY;
  if (marketType === MarketType.BINARY) {
    return [0.45, 0.55];
  }
  const min = decimalToNumber(market.minPrice);
  const max = decimalToNumber(market.maxPrice);
  if (min != null && max != null && max > min) {
    const span = max - min;
    const lower = Number((min + span * 0.2).toFixed(2));
    const upper = Number((min + span * 0.35).toFixed(2));
    return [lower, upper];
  }
  return [10, 12];
};

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

const reasonForTradeSchema = z
  .object({
    confidenceInterval: z
      .tuple([z.number(), z.number()])
      .optional()
      .refine((val) => !val || val[0] <= val[1], 'confidenceInterval [lower, upper] must have lower <= upper'),
    reason: z.string().min(1),
    theoreticalPriceMethod: z.string().min(1),
  });

const placeOrderSchema = z.object({
  marketId: z.string(),
  accountId: z.string().optional(), // Optional when using X-Agent-Key
  side: z.enum(['BUY_YES', 'BUY_NO', 'BUY', 'SELL']),
  type: z.enum(['LIMIT', 'MARKET']),
  price: z.number().positive().nullable().optional(),
  quantity: z.number().positive(),
  reasonForTrade: reasonForTradeSchema.optional(),
});

const createAccountSchema = z.object({
  balance: z.coerce.number().min(0).optional().default(1000),
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
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
    const entries = await getLeaderboard(limit);
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

router.get('/markets/:id/reason-schema', async (req, res) => {
  try {
    const market = await marketRepo.findById(req.params.id);
    if (!market) {
      return res.status(404).json({ error: 'Market not found' });
    }
    const marketType = market.marketType ?? MarketType.BINARY;
    const priceMin = decimalToNumber(market.minPrice) ?? (marketType === MarketType.BINARY ? 0 : null);
    const priceMax = decimalToNumber(market.maxPrice) ?? (marketType === MarketType.BINARY ? 1 : null);
    const priceUnits = marketType === MarketType.BINARY ? 'probability (0-1)' : 'index units (same as the settlement feed)';
    const ciUnits = marketType === MarketType.BINARY ? 'probability (0-1)' : 'index units (e.g., mm, °C, MJ/m²)';
    const confidenceExample = buildConfidenceIntervalExample(market);

    return res.json({
      marketId: market.id,
      marketType,
      description: market.description,
      location: market.location,
      requiresReasonForTrade: true,
      priceRange: {
        min: priceMin,
        max: priceMax,
        units: priceUnits,
      },
      confidenceInterval: {
        required: true,
        units: ciUnits,
        example: confidenceExample,
        description:
          marketType === MarketType.BINARY
            ? 'Provide lower/upper probabilities on the 0-1 scale.'
            : 'Provide lower/upper bounds in the same units the contract settles in (see market description).',
      },
      fields: [
        {
          name: 'reason',
          type: 'string',
          required: true,
          description: 'Plain-language summary of the thesis or signal.',
        },
        {
          name: 'theoreticalPriceMethod',
          type: 'string',
          required: true,
          description: 'Model or data method used to derive the quote.',
        },
        {
          name: 'confidenceInterval',
          type: '[number, number]',
          required: true,
          description:
            marketType === MarketType.BINARY
              ? 'Lower/upper probabilities that bracket the outcome.'
              : 'Lower/upper settlement values you expect (same units as the index).',
        },
      ],
    });
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

router.post('/orders', agentPerMarketRateLimitMiddleware, agentRateLimitMiddleware, requireTrustedAgentMiddleware, async (req, res) => {
  try {
    const data = placeOrderSchema.parse(req.body);
    const effectiveAccountId = req.accountId ?? data.accountId;
    if (!effectiveAccountId) {
      return res.status(400).json({ error: 'accountId required (or use X-Agent-Key)' });
    }
    if (req.agent && data.accountId && data.accountId !== req.accountId) {
      return res.status(403).json({ error: 'Agent can only trade on own account' });
    }
    if (req.agent && !data.reasonForTrade) {
      return res.status(400).json({
        error: 'reasonForTrade required for agent orders',
        code: 'REASON_FOR_TRADE_REQUIRED',
        hint: 'Include reasonForTrade: { reason, theoreticalPriceMethod, confidenceInterval }. BINARY: [lower, upper] in 0-1; FUTURES: index units (e.g. [8, 12] for mm)',
      });
    }
    if (req.agent && data.reasonForTrade && !data.reasonForTrade.confidenceInterval) {
      return res.status(400).json({
        error: 'confidenceInterval required for agent orders',
        code: 'REASON_FOR_TRADE_REQUIRED',
        hint: 'Include confidenceInterval: [lower, upper]. BINARY: 0-1 (probability); FUTURES: index units (e.g. [8, 12] for mm rainfall)',
      });
    }
    const result = await exchangeService.placeOrder({
      marketId: data.marketId,
      accountId: effectiveAccountId,
      side: data.side as OrderSide,
      type: data.type as OrderType,
      price: data.price !== null && data.price !== undefined ? new Decimal(data.price) : null,
      quantity: new Decimal(data.quantity),
      reasonForTrade: data.reasonForTrade ?? undefined,
    });
    if (req.agent) {
      agentOrdersTotal.inc({ agent_id: req.agent.id });
    }
    const { order } = result;
    const resting = order.status === 'PENDING' || order.status === 'PARTIALLY_FILLED';
    if (resting) {
      broadcast({
        type: 'order_book_delta',
        payload: { marketId: order.marketId, orderId: order.id, action: 'create' },
      });
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

router.delete('/orders/:id', requireTrustedAgentMiddleware, async (req, res) => {
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
    broadcast({
      type: 'order_book_delta',
      payload: { marketId: order.marketId, orderId: order.id, action: 'cancel' },
    });
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
    const accountIds = [
      ...new Set(trades.flatMap((t) => [t.buyerAccountId, t.sellerAccountId])),
    ];
    const agentProfiles = await prisma.agentProfile.findMany({
      where: { accountId: { in: accountIds } },
      select: { accountId: true, name: true },
    });
    const accountToName = Object.fromEntries(
      agentProfiles.map((p) => [p.accountId, p.name])
    );
    const tradesWithNames = trades.map((t) => ({
      ...t,
      price: t.price.toString(),
      quantity: t.quantity.toString(),
      buyerAgentName: accountToName[t.buyerAccountId] ?? null,
      sellerAgentName: accountToName[t.sellerAccountId] ?? null,
    }));
    res.json(tradesWithNames);
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
    const parsed = createAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors });
    }
    const balance = new Decimal(parsed.data.balance);
    const account = await accountRepo.create({ balance });
    res.status(201).json(account);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

