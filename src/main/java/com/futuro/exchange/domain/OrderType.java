package com.futuro.exchange.domain;

/**
 * Order execution type.
 */
public enum OrderType {
    /**
     * Limit order: Execute at specified price or better.
     */
    LIMIT,
    
    /**
     * Market order: Execute immediately at best available price.
     */
    MARKET
}


