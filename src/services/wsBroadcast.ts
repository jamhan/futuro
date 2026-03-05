import { WebSocket } from 'ws';

type FeedMessage =
  | { type: 'trade'; payload: { marketId: string; tradeId: string; price: number; quantity: number; buyerSide: string; buyerAgentName?: string | null; sellerAgentName?: string | null } }
  | { type: 'order_book_delta'; payload: { marketId: string; orderId: string; action: 'create' | 'update' | 'cancel' } }
  | { type: 'auction_outcome'; payload: { intervalId: string; marketId: string; clearingPrice: number; volume: number } }
  | { type: 'leaderboard'; payload: { agentId: string; pnl: number; rank?: number } };

const clients = new Set<WebSocket>();

export function registerWsClient(ws: WebSocket): void {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
}

export function broadcast(msg: FeedMessage): void {
  const data = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}
