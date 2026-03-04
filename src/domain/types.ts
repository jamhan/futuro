import Decimal from 'decimal.js';

/**
 * Market states follow a strict lifecycle:
 * DRAFT -> OPEN -> LOCKED -> RESOLVED -> SETTLED
 * 
 * - DRAFT: Market created but not yet open for trading
 * - OPEN: Active trading allowed
 * - LOCKED: Trading stopped, awaiting resolution
 * - RESOLVED: Outcome determined by oracle
 * - SETTLED: All positions settled, final state
 */
export enum MarketState {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  LOCKED = 'LOCKED',
  RESOLVED = 'RESOLVED',
  SETTLED = 'SETTLED',
}

/**
 * Binary outcomes for weather prediction markets
 */
export enum Outcome {
  YES = 'YES',
  NO = 'NO',
}

/**
 * Market type: binary (YES/NO) or futures (index-settled)
 */
export enum MarketType {
  BINARY = 'BINARY',
  FUTURES = 'FUTURES',
}

/**
 * Index type for climate weekly futures (BoM data)
 */
export enum IndexType {
  /** Weekly rainfall total (mm) */
  WEATHER_RAINFALL = 'weather_rainfall',
  /** Weekly max / high temperature (°C) – e.g. max of daily max temps */
  TEMPERATURE_HIGH = 'temperature_high',
  /** Weekly min / low temperature (°C) – e.g. min of daily min temps */
  TEMPERATURE_LOW = 'temperature_low',
  /** Max wind gust during week (km/h) */
  WIND_GUST_MAX = 'wind_gust_max',
  /** Weekly total solar exposure (MJ/m²) – sum of daily values */
  SOLAR_EXPOSURE = 'solar_exposure',
  /** Legacy */
  SOLAR_GHI = 'solar_ghi',
}

/**
 * Order types supported by the exchange
 */
export enum OrderType {
  LIMIT = 'LIMIT',
  MARKET = 'MARKET',
}

/**
 * Order side: binary (YES/NO) or futures (BUY/SELL)
 * - Binary: BUY_YES, BUY_NO
 * - Futures: BUY, SELL (single instrument, price in index units)
 */
export enum OrderSide {
  BUY_YES = 'BUY_YES',
  BUY_NO = 'BUY_NO',
  BUY = 'BUY',    // Futures: long
  SELL = 'SELL',  // Futures: short
}

/**
 * Order status
 */
export enum OrderStatus {
  PENDING = 'PENDING',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
}

/**
 * Price is always a Decimal between 0.00 and 1.00
 * Represents the probability/price of the outcome
 */
export type Price = Decimal;

/**
 * Quantity is always a positive Decimal
 * Represents number of shares/contracts
 */
export type Quantity = Decimal;

/**
 * Market identifier
 */
export type MarketId = string;

/**
 * Order identifier
 */
export type OrderId = string;

/**
 * User/Account identifier
 */
export type AccountId = string;

/**
 * Trade identifier
 */
export type TradeId = string;

