import { Counter, Gauge, register } from 'prom-client';

export const agentOrdersTotal = new Counter({
  name: 'agent_orders_total',
  help: 'Total orders placed by agents',
  labelNames: ['agent_id'],
});

export const agentOrderRejectionsTotal = new Counter({
  name: 'agent_order_rejections_total',
  help: 'Total order rejections for agents',
  labelNames: ['reason'],
});

export const agentLiquidationsTotal = new Counter({
  name: 'agent_liquidations_total',
  help: 'Total paper top-ups (liquidations) for agents',
  labelNames: ['agent_id'],
});

export const auctionClearingPrice = new Gauge({
  name: 'auction_clearing_price',
  help: 'Auction clearing price per market',
  labelNames: ['market_id', 'interval_id'],
});

export const auctionVolume = new Gauge({
  name: 'auction_volume',
  help: 'Auction volume per market',
  labelNames: ['market_id', 'interval_id'],
});

export const ledgerJournalsTotal = new Counter({
  name: 'ledger_journals_total',
  help: 'Total journal entries posted',
  labelNames: ['description'],
});

export async function getMetrics(): Promise<string> {
  return register.metrics();
}

export function getContentType(): string {
  return register.contentType;
}
