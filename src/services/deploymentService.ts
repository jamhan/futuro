import Decimal from 'decimal.js';
import { getPrismaClient } from '../db/client';

const DEPLOYED_CAP = parseFloat(process.env.AGENT_DEPLOYED_CAP ?? '500');

/**
 * Computes deployed cash for an account: sum of |position.quantity| * markPrice over all markets.
 * Mark price = last trade price for the market (or 0 if no trades).
 */
export class DeploymentService {
  private prisma = getPrismaClient();

  async getDeployedCash(accountId: string): Promise<Decimal> {
    const positions = await this.prisma.position.findMany({
      where: { accountId },
      include: { market: true },
    });

    let total = new Decimal(0);
    for (const pos of positions) {
      const qty = pos.quantity != null ? new Decimal(pos.quantity.toString()) : new Decimal(0);
      if (qty.isZero()) continue;
      const markPrice = await this.getLastTradePrice(pos.marketId);
      const mult = pos.market.contractMultiplier != null
        ? new Decimal(pos.market.contractMultiplier.toString())
        : new Decimal(1);
      total = total.plus(qty.abs().times(markPrice).times(mult));
    }
    return total;
  }

  async getLastTradePrice(marketId: string): Promise<Decimal> {
    const last = await this.prisma.trade.findFirst({
      where: { marketId },
      orderBy: { createdAt: 'desc' },
      select: { price: true },
    });
    return last ? new Decimal(last.price.toString()) : new Decimal(0);
  }

  getCap(): Decimal {
    return new Decimal(DEPLOYED_CAP.toString());
  }

  /** True if deployed + additionalCost >= cap (for buy orders that increase exposure). */
  async wouldExceedCap(
    accountId: string,
    additionalCost: Decimal
  ): Promise<boolean> {
    const deployed = await this.getDeployedCash(accountId);
    const cap = this.getCap();
    return deployed.plus(additionalCost).gte(cap);
  }

  /**
   * Exposure = sum of |position.quantity| * markPrice over positions in a correlation group.
   * Returns map of correlationGroupId -> total notional.
   */
  async getExposureByGroup(accountId: string): Promise<Map<string, Decimal>> {
    const positions = await this.prisma.position.findMany({
      where: { accountId },
      include: { market: true },
    });
    const byGroup = new Map<string, Decimal>();
    for (const pos of positions) {
      const groupId = pos.market.correlationGroupId ?? pos.marketId;
      const qty = pos.quantity != null ? new Decimal(pos.quantity.toString()) : new Decimal(0);
      if (qty.isZero()) continue;
      const markPrice = await this.getLastTradePrice(pos.marketId);
      const notional = qty.abs().times(markPrice);
      byGroup.set(groupId, (byGroup.get(groupId) ?? new Decimal(0)).plus(notional));
    }
    return byGroup;
  }

  /** True if exposure in group + additionalNotional would exceed EXPOSURE_CAP_PCT of equity. */
  async wouldExceedExposureCap(
    accountId: string,
    correlationGroupId: string,
    additionalNotional: Decimal,
    equity: Decimal
  ): Promise<boolean> {
    const exposureCapPct = parseFloat(process.env.EXPOSURE_CAP_PCT ?? '20');
    const cap = equity.times(exposureCapPct / 100);
    const byGroup = await this.getExposureByGroup(accountId);
    const current = byGroup.get(correlationGroupId) ?? new Decimal(0);
    return current.plus(additionalNotional).gt(cap);
  }
}

