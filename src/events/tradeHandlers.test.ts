/**
 * Trade handler unit tests. Mocks LedgerService, Prisma tx, and broadcast.
 */
import Decimal from 'decimal.js';
import { createTrade } from '../domain/trade';
import { createOrder } from '../domain/order';
import { OrderSide, OrderType } from '../domain/types';
import { registerTradeHandlers } from './tradeHandlers';
import { emit, _resetHandlersForTesting } from './eventBus';
import * as wsBroadcast from '../services/wsBroadcast';

const MARKET_ID = 'market_1';

jest.mock('../services/wsBroadcast', () => ({
  broadcast: jest.fn(),
}));

function makeTrade(buyerAccountId: string, sellerAccountId: string, price: number, quantity: number, buyerSide: OrderSide = OrderSide.BUY) {
  const buyOrder = createOrder({
    marketId: MARKET_ID,
    accountId: buyerAccountId,
    side: buyerSide,
    type: OrderType.LIMIT,
    price: new Decimal(price),
    quantity: new Decimal(quantity),
  });
  const sellSide = buyerSide === OrderSide.BUY ? OrderSide.SELL : buyerSide === OrderSide.BUY_YES ? OrderSide.BUY_NO : OrderSide.BUY_YES;
  const sellOrder = createOrder({
    marketId: MARKET_ID,
    accountId: sellerAccountId,
    side: sellSide,
    type: OrderType.LIMIT,
    price: new Decimal(price),
    quantity: new Decimal(quantity),
  });
  return createTrade(
    { id: buyOrder.id, accountId: buyerAccountId, side: buyerSide },
    { id: sellOrder.id, accountId: sellerAccountId, side: sellOrder.side },
    new Decimal(price),
    new Decimal(quantity),
    MARKET_ID
  );
}

describe('tradeHandlers', () => {
  let mockPostJournal: jest.Mock;
  let mockLedgerService: { postJournal: jest.Mock };
  let mockTx: {
    position: { findUnique: jest.Mock; upsert: jest.Mock };
    agentProfile: { findMany: jest.Mock };
  };

  beforeEach(() => {
    _resetHandlersForTesting();
    jest.clearAllMocks();
    mockPostJournal = jest.fn().mockResolvedValue(undefined);
    mockLedgerService = { postJournal: mockPostJournal };
    mockTx = {
      position: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
      agentProfile: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    registerTradeHandlers({ ledgerService: mockLedgerService as any });
  });

  it('posts journal with buyer debit and seller credit for futures trade', async () => {
    const trade = makeTrade('acc-buy', 'acc-sell', 50, 2, OrderSide.BUY);
    await emit({ type: 'TradeEvent', payload: { trades: [trade] } }, mockTx as any);

    expect(mockPostJournal).toHaveBeenCalledTimes(1);
    const [lines, meta, tx] = mockPostJournal.mock.calls[0];
    expect(lines).toHaveLength(2);
    const buyerLine = lines.find((l: any) => l.accountId === 'acc-buy');
    const sellerLine = lines.find((l: any) => l.accountId === 'acc-sell');
    expect(buyerLine.debit.toNumber()).toBe(100); // 50 * 2
    expect(buyerLine.credit.toNumber()).toBe(0);
    expect(sellerLine.credit.toNumber()).toBe(100);
    expect(sellerLine.debit.toNumber()).toBe(0);
    expect(meta).toMatchObject({ description: 'order_fill' });
    expect(tx).toBe(mockTx);
  });

  it('posts journal for binary trade (BUY_YES)', async () => {
    const trade = makeTrade('acc-buy', 'acc-sell', 0.5, 10, OrderSide.BUY_YES);
    await emit({ type: 'TradeEvent', payload: { trades: [trade] } }, mockTx as any);

    expect(mockPostJournal).toHaveBeenCalledTimes(1);
    const [lines] = mockPostJournal.mock.calls[0];
    const buyerLine = lines.find((l: any) => l.accountId === 'acc-buy');
    expect(buyerLine.debit.toNumber()).toBe(5); // 0.5 * 10
  });

  it('upserts positions for futures trade', async () => {
    const trade = makeTrade('acc-buy', 'acc-sell', 50, 2, OrderSide.BUY);
    await emit({ type: 'TradeEvent', payload: { trades: [trade] } }, mockTx as any);

    expect(mockTx.position.upsert).toHaveBeenCalledTimes(2); // buyer + seller
    const buyerUpsert = mockTx.position.upsert.mock.calls.find((c: any) => c[0].create.accountId === 'acc-buy');
    expect(buyerUpsert[0].create).toMatchObject({
      accountId: 'acc-buy',
      marketId: MARKET_ID,
      quantity: expect.anything(),
      averagePrice: expect.anything(),
      realizedPnl: expect.anything(),
    });
  });

  it('broadcasts trade to WebSocket', async () => {
    mockTx.agentProfile.findMany.mockResolvedValue([
      { accountId: 'acc-buy', name: 'Buyer' },
      { accountId: 'acc-sell', name: 'Seller' },
    ]);
    const trade = makeTrade('acc-buy', 'acc-sell', 50, 2, OrderSide.BUY);
    await emit({ type: 'TradeEvent', payload: { trades: [trade] } }, mockTx as any);

    expect(wsBroadcast.broadcast).toHaveBeenCalledTimes(1);
    expect(wsBroadcast.broadcast).toHaveBeenCalledWith({
      type: 'trade',
      payload: {
        marketId: MARKET_ID,
        tradeId: trade.id,
        price: 50,
        quantity: 2,
        buyerSide: OrderSide.BUY,
        buyerAgentName: 'Buyer',
        sellerAgentName: 'Seller',
      },
    });
  });

  it('ignores non-TradeEvent', async () => {
    await emit({ type: 'OrderAcceptedEvent', payload: {} as any }, mockTx as any);
    expect(mockPostJournal).not.toHaveBeenCalled();
    expect(mockTx.position.upsert).not.toHaveBeenCalled();
  });

  it('ignores when context (tx) is missing', async () => {
    const trade = makeTrade('acc-buy', 'acc-sell', 50, 2, OrderSide.BUY);
    await emit({ type: 'TradeEvent', payload: { trades: [trade] } });
    expect(mockPostJournal).not.toHaveBeenCalled();
  });

  it('ignores when trades array is empty', async () => {
    await emit({ type: 'TradeEvent', payload: { trades: [] } }, mockTx as any);
    expect(mockPostJournal).not.toHaveBeenCalled();
  });
});
