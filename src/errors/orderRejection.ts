/**
 * Structured order rejection errors for API consumers.
 * Clients can branch on `code` and display `message`; `details` holds optional context.
 */

export const ORDER_REJECTION_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  MARKET_NOT_FOUND: 'MARKET_NOT_FOUND',
  TRADING_NOT_ALLOWED: 'TRADING_NOT_ALLOWED',
  PRICE_BELOW_MIN: 'PRICE_BELOW_MIN',
  PRICE_ABOVE_MAX: 'PRICE_ABOVE_MAX',
  INVALID_TICK_SIZE: 'INVALID_TICK_SIZE',
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  DEPLOYMENT_CAP_EXCEEDED: 'DEPLOYMENT_CAP_EXCEEDED',
  ORDER_SIZE_EXCEEDS_LIMIT: 'ORDER_SIZE_EXCEEDS_LIMIT',
  EXPOSURE_LIMIT_EXCEEDED: 'EXPOSURE_LIMIT_EXCEEDED',
  POSITION_LIMIT_EXCEEDED: 'POSITION_LIMIT_EXCEEDED',
} as const;

export type OrderRejectionCode = (typeof ORDER_REJECTION_CODES)[keyof typeof ORDER_REJECTION_CODES];

export interface OrderRejectionDetails {
  marketMin?: number;
  marketMax?: number;
  maxQuantity?: number;
  maxPosition?: number;
  marketState?: string;
  [key: string]: unknown;
}

export class OrderRejectionError extends Error {
  constructor(
    public readonly code: OrderRejectionCode,
    message: string,
    public readonly details?: OrderRejectionDetails
  ) {
    super(message);
    this.name = 'OrderRejectionError';
    Object.setPrototypeOf(this, OrderRejectionError.prototype);
  }

  toJSON(): { code: OrderRejectionCode; message: string; details?: OrderRejectionDetails } {
    return {
      code: this.code,
      message: this.message,
      ...(this.details && Object.keys(this.details).length > 0 && { details: this.details }),
    };
  }
}

export function isOrderRejectionError(err: unknown): err is OrderRejectionError {
  return err instanceof OrderRejectionError;
}
