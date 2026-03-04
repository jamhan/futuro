package com.futuro.exchange.domain;

/**
 * Order side (direction).
 */
public enum OrderSide {
    /**
     * Buy side: Taking a long position.
     * Profit when settlement price > trade price.
     */
    BUY,
    
    /**
     * Sell side: Taking a short position.
     * Profit when settlement price < trade price.
     */
    SELL
}


