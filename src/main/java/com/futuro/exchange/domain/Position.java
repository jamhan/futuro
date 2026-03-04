package com.futuro.exchange.domain;

import lombok.Builder;
import lombok.Data;
import lombok.NonNull;

import java.math.BigDecimal;

/**
 * Represents a position (long or short) in the rainfall futures contract.
 * 
 * Positions are maintained by the clearing engine:
 * - Long position: Net quantity of contracts bought
 * - Short position: Net quantity of contracts sold
 * - Average price: Weighted average of all trades
 */
@Data
@Builder
public class Position {
    @NonNull
    private final String accountId;
    
    /**
     * Net position quantity.
     * Positive = long, Negative = short, Zero = flat
     */
    @NonNull
    private BigDecimal quantity;
    
    /**
     * Average entry price (weighted by quantity).
     */
    @NonNull
    private BigDecimal averagePrice;
    
    /**
     * Unrealized PnL based on current index value.
     */
    @NonNull
    private BigDecimal unrealizedPnL;
    
    /**
     * Realized PnL from closed positions.
     */
    @NonNull
    private BigDecimal realizedPnL;
    
    public Position(
            String accountId,
            BigDecimal quantity,
            BigDecimal averagePrice,
            BigDecimal unrealizedPnL,
            BigDecimal realizedPnL) {
        this.accountId = accountId;
        this.quantity = quantity != null ? quantity : BigDecimal.ZERO;
        this.averagePrice = averagePrice != null ? averagePrice : BigDecimal.ZERO;
        this.unrealizedPnL = unrealizedPnL != null ? unrealizedPnL : BigDecimal.ZERO;
        this.realizedPnL = realizedPnL != null ? realizedPnL : BigDecimal.ZERO;
    }
    
    public boolean isLong() {
        return quantity.compareTo(BigDecimal.ZERO) > 0;
    }
    
    public boolean isShort() {
        return quantity.compareTo(BigDecimal.ZERO) < 0;
    }
    
    public boolean isFlat() {
        return quantity.compareTo(BigDecimal.ZERO) == 0;
    }
}


