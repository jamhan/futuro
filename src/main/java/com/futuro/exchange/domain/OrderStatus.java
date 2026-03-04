package com.futuro.exchange.domain;

/**
 * Order lifecycle status.
 */
public enum OrderStatus {
    /**
     * Order is pending execution or resting in the book.
     */
    PENDING,
    
    /**
     * Order has been partially filled.
     */
    PARTIALLY_FILLED,
    
    /**
     * Order has been fully filled.
     */
    FILLED,
    
    /**
     * Order has been cancelled.
     */
    CANCELLED,
    
    /**
     * Order has been rejected (e.g., by risk engine).
     */
    REJECTED
}


