import { getPrismaClient } from '../db/client';
import { isFuturesMarket } from '../engine/futuresMatchingGuard';
import type {
  ExposureSnapshot,
  AgentExposure,
  OpenOrder,
  ExposurePosition,
} from '../types/exposure';

const prisma = getPrismaClient();

export async function getExposureSnapshot(options: {
  agentId?: string;
  marketId?: string;
}): Promise<ExposureSnapshot> {
  const { agentId, marketId } = options;
  const generatedAt = new Date().toISOString();

  const profiles = await prisma.agentProfile.findMany({
    where: {
      status: 'ACTIVE',
      ...(agentId && { id: agentId }),
    },
    include: { account: true },
  });

  if (profiles.length === 0) {
    return { generatedAt, agents: [] };
  }

  const accountIds = profiles.map((p) => p.accountId);

  const [orders, positions] = await Promise.all([
    prisma.order.findMany({
      where: {
        accountId: { in: accountIds },
        status: { in: ['PENDING', 'PARTIALLY_FILLED'] },
        ...(marketId && { marketId }),
      },
      include: { market: true },
    }),
    prisma.position.findMany({
      where: {
        accountId: { in: accountIds },
        ...(marketId && { marketId }),
      },
      include: { market: true },
    }),
  ]);

  const agents: AgentExposure[] = profiles.map((profile) => {
    const accId = profile.accountId;
    const balance = profile.account.balance.toString();

    const agentOrders = orders
      .filter((o) => o.accountId === accId)
      .map(
        (o): OpenOrder => ({
          marketId: o.marketId,
          marketDescription: o.market?.description,
          eventDate: o.market?.eventDate?.toISOString(),
          side: o.side,
          quantity: o.quantity.toString(),
          price: o.price != null ? o.price.toString() : '',
        })
      );

    const agentPositions = positions
      .filter((p) => p.accountId === accId)
      .map((p): ExposurePosition => {
        const maxPrice = p.market.maxPrice != null
          ? Number(p.market.maxPrice.toString())
          : 1;
        let netContracts: string;
        let notional: number;
        if (isFuturesMarket(p.market)) {
          const qty = p.quantity != null ? Number(p.quantity.toString()) : 0;
          netContracts = p.quantity != null ? p.quantity.toString() : '0';
          notional = Math.abs(qty) * maxPrice;
        } else {
          const yes = Number(p.yesShares.toString());
          const no = Number(p.noShares.toString());
          netContracts = `${p.yesShares.toString()}/${p.noShares.toString()}`;
          notional = (yes + no) * maxPrice;
        }
        return {
          marketId: p.marketId,
          description: p.market.description,
          eventDate: p.market.eventDate?.toISOString(),
          netContracts,
          notional: String(notional),
          lastUpdated: generatedAt,
        };
      });

    return {
      agentId: profile.id,
      name: profile.name,
      accountId: accId,
      balance,
      openOrders: agentOrders,
      positions: agentPositions,
    };
  });

  return { generatedAt, agents };
}
