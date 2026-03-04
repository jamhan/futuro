import { Request, Response } from 'express';
import { agentPerMarketRateLimitMiddleware } from './agentPerMarketRateLimit';
import * as tokenBucket from '../lib/rateLimit/tokenBucket';

jest.mock('../lib/rateLimit/tokenBucket');

const mockTryConsume = tokenBucket.tryConsume as jest.MockedFunction<
  typeof tokenBucket.tryConsume
>;

function mockReq(overrides: Partial<Request> = {}): Partial<Request> {
  return {
    agent: { id: 'agent-1', name: 'Test', accountId: 'acc-1' },
    body: { marketId: 'market-1' },
    ...overrides,
  };
}

function mockRes(): Partial<Response> & { statusMock: jest.Mock; jsonMock: jest.Mock } {
  const statusMock = jest.fn().mockReturnThis();
  const jsonMock = jest.fn().mockReturnThis();
  return {
    status: statusMock,
    json: jsonMock,
    set: jest.fn().mockReturnThis(),
    statusMock,
    jsonMock,
  };
}

describe('agentPerMarketRateLimitMiddleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls next when not an agent request', () => {
    const next = jest.fn();
    const req = mockReq({ agent: undefined }) as Request;
    const res = mockRes() as unknown as Response;

    agentPerMarketRateLimitMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockTryConsume).not.toHaveBeenCalled();
  });

  it('calls next when marketId is missing', () => {
    const next = jest.fn();
    const req = mockReq({ body: {} }) as Request;
    const res = mockRes() as unknown as Response;

    agentPerMarketRateLimitMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockTryConsume).not.toHaveBeenCalled();
  });

  it('returns 429 with ERR_RATE_LIMIT_PER_MARKET when rate limited', () => {
    mockTryConsume.mockReturnValue({ ok: false, retryAfterMs: 1000 });

    const next = jest.fn();
    const req = mockReq() as Request;
    const res = mockRes() as unknown as Response;

    agentPerMarketRateLimitMiddleware(req, res, next);

    expect(mockTryConsume).toHaveBeenCalledWith('agent-1:market-1', 1, 1);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'ERR_RATE_LIMIT_PER_MARKET',
        message: 'Rate limit exceeded: max 1 order/sec on market market-1.',
        retry_after_ms: 1000,
      },
    });
  });

  it('calls next when tryConsume returns ok', () => {
    mockTryConsume.mockReturnValue({ ok: true });

    const next = jest.fn();
    const req = mockReq() as Request;
    const res = mockRes() as unknown as Response;

    agentPerMarketRateLimitMiddleware(req, res, next);

    expect(mockTryConsume).toHaveBeenCalledWith('agent-1:market-1', 1, 1);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
