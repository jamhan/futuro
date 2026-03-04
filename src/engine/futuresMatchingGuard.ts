import { MarketType } from '../domain/types';

/**
 * Determines whether a market should use the OSS matching engine (nodejs-order-book)
 * with BUY/SELL and index-unit pricing. Used by ExchangeService to route orders.
 *
 * All such markets MUST use the OSS adapter; using the binary matching engine
 * would put BUY_YES/BUY_NO on the wrong sides and break matching.
 */
export function isFuturesMarket(market: {
  marketType?: string | null;
  indexType?: string | null;
}): boolean {
  return (
    market.marketType === MarketType.FUTURES ||
    (market.indexType != null && market.indexType !== '')
  );
}
