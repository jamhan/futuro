/**
 * Pure functions for trade settlement math: cost-basis and realized PnL.
 */

import Decimal from 'decimal.js';

const D_ZERO = new Decimal(0);

export interface CostBasisTrade {
  price: Decimal;
  qty: Decimal;
}

export interface CostBasisResult {
  quantity: Decimal;
  averagePrice: Decimal;
  realizedPnl: Decimal;
}

/**
 * Compute new position state (quantity, average price, realized PnL) after applying cost-basis trades.
 * Used for futures positions.
 */
export function computeCostBasis(
  currentQty: Decimal,
  currentAvg: Decimal,
  currentRealized: Decimal,
  costBasisTrades: CostBasisTrade[]
): CostBasisResult {
  let qty = currentQty;
  let avg = currentAvg;
  let realized = currentRealized;

  for (const { price, qty: tradeQty } of costBasisTrades) {
    const newQty = qty.plus(tradeQty);
    if (qty.eq(0)) {
      avg = price;
    } else if (qty.gt(0) && tradeQty.gt(0)) {
      avg = qty.times(avg).plus(tradeQty.times(price)).div(qty.plus(tradeQty));
    } else if (qty.lt(0) && tradeQty.lt(0)) {
      avg = qty.times(avg).plus(tradeQty.times(price)).div(qty.plus(tradeQty));
    } else {
      const closedQty = Decimal.min(qty.abs(), tradeQty.abs());
      if (qty.gt(0)) {
        realized = realized.plus(closedQty.times(price.minus(avg)));
      } else {
        realized = realized.plus(closedQty.times(avg.minus(price)));
      }
    }
    qty = newQty;
    if (qty.eq(0)) avg = D_ZERO;
  }

  return { quantity: qty, averagePrice: avg, realizedPnl: realized };
}
