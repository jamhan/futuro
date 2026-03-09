/**
 * Trade event handlers: ledger, positions, and WebSocket broadcast.
 */

import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { LedgerService } from '../services/ledgerService';
import { broadcast } from '../services/wsBroadcast';
import { computeCostBasis } from '../lib/tradeSettlementMath';
import { OrderSide } from '../domain/types';
import { subscribe } from './eventBus';
import type { EventPayload } from './eventBus';

type PrismaTx = Parameters<Parameters<ReturnType<typeof import('../db/client').getPrismaClient>['$transaction']>[0]>[0];

export interface TradeHandlerDeps {
  ledgerService: LedgerService;
}

export function registerTradeHandlers(deps: TradeHandlerDeps): void {
  const { ledgerService } = deps;
  subscribe(async (event: EventPayload, context?: unknown): Promise<void> => {
    if (event.type !== 'TradeEvent') return;
    const { trades } = event.payload;
    const tx = context as PrismaTx;
    if (!tx || trades.length === 0) return;

    const isFutures = trades[0].buyerSide === OrderSide.BUY;
    const balanceDeltaByAccount = new Map<string, Decimal>();
    const positionDeltaByKey = new Map<string, {
      qty: Decimal;
      yesShares: Decimal;
      noShares: Decimal;
      costBasisTrades?: { price: Decimal; qty: Decimal }[];
    }>();

    for (const trade of trades) {
      const cost = trade.price.times(trade.quantity);
      balanceDeltaByAccount.set(
        trade.buyerAccountId,
        (balanceDeltaByAccount.get(trade.buyerAccountId) ?? new Decimal(0)).minus(cost)
      );
      balanceDeltaByAccount.set(
        trade.sellerAccountId,
        (balanceDeltaByAccount.get(trade.sellerAccountId) ?? new Decimal(0)).plus(cost)
      );

      if (isFutures) {
        const qty = trade.quantity;
        const price = trade.price;
        const buyerKey = `${trade.buyerAccountId}:${trade.marketId}`;
        const sellerKey = `${trade.sellerAccountId}:${trade.marketId}`;
        const buyerPos = positionDeltaByKey.get(buyerKey) ?? { qty: new Decimal(0), yesShares: new Decimal(0), noShares: new Decimal(0), costBasisTrades: [] as { price: Decimal; qty: Decimal }[] };
        const sellerPos = positionDeltaByKey.get(sellerKey) ?? { qty: new Decimal(0), yesShares: new Decimal(0), noShares: new Decimal(0), costBasisTrades: [] as { price: Decimal; qty: Decimal }[] };
        buyerPos.qty = buyerPos.qty.plus(qty);
        buyerPos.costBasisTrades!.push({ price, qty });
        sellerPos.qty = sellerPos.qty.minus(qty);
        sellerPos.costBasisTrades!.push({ price, qty: qty.negated() });
        positionDeltaByKey.set(buyerKey, buyerPos);
        positionDeltaByKey.set(sellerKey, sellerPos);
      } else {
        const buyerKey = `${trade.buyerAccountId}:${trade.marketId}`;
        const sellerKey = `${trade.sellerAccountId}:${trade.marketId}`;
        const buyerPos = positionDeltaByKey.get(buyerKey) ?? { qty: new Decimal(0), yesShares: new Decimal(0), noShares: new Decimal(0) };
        const sellerPos = positionDeltaByKey.get(sellerKey) ?? { qty: new Decimal(0), yesShares: new Decimal(0), noShares: new Decimal(0) };
        if (trade.buyerSide === OrderSide.BUY_YES) {
          buyerPos.yesShares = buyerPos.yesShares.plus(trade.quantity);
          sellerPos.noShares = sellerPos.noShares.plus(trade.quantity);
        } else {
          buyerPos.noShares = buyerPos.noShares.plus(trade.quantity);
          sellerPos.yesShares = sellerPos.yesShares.plus(trade.quantity);
        }
        positionDeltaByKey.set(buyerKey, buyerPos);
        positionDeltaByKey.set(sellerKey, sellerPos);
      }
    }

    // Ledger
    const journalLines: { accountId: string; debit: Decimal; credit: Decimal }[] = [];
    for (const [accountId, delta] of balanceDeltaByAccount.entries()) {
      if (delta.gt(0)) {
        journalLines.push({ accountId, debit: new Decimal(0), credit: delta });
      } else if (delta.lt(0)) {
        journalLines.push({ accountId, debit: delta.abs(), credit: new Decimal(0) });
      }
    }
    if (journalLines.length > 0) {
      const refId = trades.length === 1 ? trades[0].id : undefined;
      await ledgerService.postJournal(
        journalLines,
        { description: 'order_fill', refId },
        tx as any
      );
    }

    // Positions
    for (const [key, delta] of positionDeltaByKey.entries()) {
      const [accountId, marketId] = key.split(':');
      const existing = await tx.position.findUnique({
        where: { accountId_marketId: { accountId, marketId } },
      });
      const yes = (existing ? new Decimal(existing.yesShares.toString()) : new Decimal(0)).plus(delta.yesShares);
      const no = (existing ? new Decimal(existing.noShares.toString()) : new Decimal(0)).plus(delta.noShares);
      let qty: Decimal;
      let averagePrice: Prisma.Decimal | null = null;
      let realizedPnl: Prisma.Decimal | null = null;

      if (isFutures) {
        const currentQty = existing?.quantity != null ? new Decimal(existing.quantity.toString()) : new Decimal(0);
        const currentAvg = existing?.averagePrice != null ? new Decimal(existing.averagePrice.toString()) : new Decimal(0);
        const currentRealized = existing?.realizedPnl != null ? new Decimal(existing.realizedPnl.toString()) : new Decimal(0);
        const result = computeCostBasis(currentQty, currentAvg, currentRealized, delta.costBasisTrades ?? []);
        qty = result.quantity;
        averagePrice = new Prisma.Decimal(result.averagePrice.toString());
        realizedPnl = new Prisma.Decimal(result.realizedPnl.toString());
      } else {
        qty = existing && existing.quantity != null
          ? new Decimal(existing.quantity.toString()).plus(delta.qty)
          : delta.qty;
      }

      const quantityDecimal = isFutures ? new Prisma.Decimal(qty.toString()) : null;
      await tx.position.upsert({
        where: { accountId_marketId: { accountId, marketId } },
        create: {
          accountId,
          marketId,
          yesShares: new Prisma.Decimal(yes.toString()),
          noShares: new Prisma.Decimal(no.toString()),
          quantity: quantityDecimal,
          averagePrice: averagePrice ?? undefined,
          realizedPnl: realizedPnl ?? undefined,
        },
        update: {
          yesShares: new Prisma.Decimal(yes.toString()),
          noShares: new Prisma.Decimal(no.toString()),
          ...(isFutures && {
            quantity: quantityDecimal,
            averagePrice: averagePrice!,
            realizedPnl: realizedPnl!,
          }),
        },
      });
    }

    // Broadcast
    const accountIds = [...new Set(trades.flatMap((t: any) => [t.buyerAccountId, t.sellerAccountId]))];
    const agentProfiles = await tx.agentProfile.findMany({
      where: { accountId: { in: accountIds } },
      select: { accountId: true, name: true },
    });
    const accountToName = Object.fromEntries(agentProfiles.map((p) => [p.accountId, p.name]));

    for (const t of trades) {
      broadcast({
        type: 'trade',
        payload: {
          marketId: t.marketId,
          tradeId: t.id,
          price: Number(t.price.toString()),
          quantity: Number(t.quantity.toString()),
          buyerSide: t.buyerSide,
          buyerAgentName: accountToName[t.buyerAccountId] ?? null,
          sellerAgentName: accountToName[t.sellerAccountId] ?? null,
        },
      });
    }
  });
}
