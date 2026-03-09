/**
 * In-process synchronous event bus. Used to decouple matching from ledger, positions, and broadcast.
 */

export type TradeEventPayload = { trades: any[] };
export type OrderAcceptedEventPayload = { order: any };
export type OrderCancelledEventPayload = { orderId: string; marketId: string };

export type EventPayload =
  | { type: 'TradeEvent'; payload: TradeEventPayload }
  | { type: 'OrderAcceptedEvent'; payload: OrderAcceptedEventPayload }
  | { type: 'OrderCancelledEvent'; payload: OrderCancelledEventPayload };

type EventHandler = (event: EventPayload, context?: unknown) => void | Promise<void>;

const handlers: EventHandler[] = [];

/**
 * Subscribe a handler to all events. Handlers run in order of subscription.
 */
export function subscribe(handler: EventHandler): void {
  handlers.push(handler);
}

/**
 * Emit an event. All handlers are invoked and awaited.
 */
export async function emit(event: EventPayload, context?: unknown): Promise<void> {
  for (const h of handlers) {
    await h(event, context);
  }
}

/**
 * Clear all handlers. For test isolation only.
 */
export function _resetHandlersForTesting(): void {
  handlers.length = 0;
}
