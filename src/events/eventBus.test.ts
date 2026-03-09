import { subscribe, emit, _resetHandlersForTesting } from './eventBus';

describe('EventBus', () => {
  beforeEach(() => {
    _resetHandlersForTesting();
  });

  it('invokes handler when event is emitted', async () => {
    const handler = jest.fn();
    subscribe(handler);
    await emit({ type: 'TradeEvent', payload: { trades: [] } });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      { type: 'TradeEvent', payload: { trades: [] } },
      undefined
    );
  });

  it('passes context to handlers', async () => {
    const handler = jest.fn();
    subscribe(handler);
    const ctx = { tx: 'mock-tx' };
    await emit({ type: 'TradeEvent', payload: { trades: [] } }, ctx);
    expect(handler).toHaveBeenCalledWith(
      { type: 'TradeEvent', payload: { trades: [] } },
      ctx
    );
  });

  it('invokes multiple handlers in order', async () => {
    const order: number[] = [];
    subscribe(() => { order.push(1); });
    subscribe(() => { order.push(2); });
    subscribe(() => { order.push(3); });
    await emit({ type: 'TradeEvent', payload: { trades: [] } });
    expect(order).toEqual([1, 2, 3]);
  });

  it('awaits async handlers', async () => {
    let resolved = false;
    subscribe(async () => {
      await new Promise((r) => setTimeout(r, 10));
      resolved = true;
    });
    const p = emit({ type: 'TradeEvent', payload: { trades: [] } });
    expect(resolved).toBe(false);
    await p;
    expect(resolved).toBe(true);
  });

  it('invokes handler for OrderAcceptedEvent', async () => {
    const handler = jest.fn();
    subscribe(handler);
    const order = { id: 'o1', status: 'PENDING' };
    await emit({ type: 'OrderAcceptedEvent', payload: { order } });
    expect(handler).toHaveBeenCalledWith(
      { type: 'OrderAcceptedEvent', payload: { order } },
      undefined
    );
  });

  it('invokes handler for OrderCancelledEvent', async () => {
    const handler = jest.fn();
    subscribe(handler);
    await emit({
      type: 'OrderCancelledEvent',
      payload: { orderId: 'o1', marketId: 'm1' },
    });
    expect(handler).toHaveBeenCalledWith(
      { type: 'OrderCancelledEvent', payload: { orderId: 'o1', marketId: 'm1' } },
      undefined
    );
  });

  it('no handlers does not throw', async () => {
    await expect(
      emit({ type: 'TradeEvent', payload: { trades: [] } })
    ).resolves.not.toThrow();
  });
});
