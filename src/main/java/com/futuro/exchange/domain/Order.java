package com.futuro.exchange.domain;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Builder;
import lombok.Data;
import lombok.NonNull;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Represents a trading order in the exchange.
 * 
 * Orders can be:
 * - LIMIT: Execute at specified price or better
 * - MARKET: Execute immediately at best available price
 * 
 * Orders have a side:
 * - BUY: Taking a long position (profit when rainfall > settlement price)
 * - SELL: Taking a short position (profit when rainfall < settlement price)
 */
@Data
@Builder
public class Order {
    @NonNull
    private final UUID id;
    
    @NonNull
    private final String accountId;
    
    @NonNull
    private final OrderType type;
    
    @NonNull
    private final OrderSide side;
    
    @NonNull
    private final BigDecimal quantity;
    
    // Nullable for market orders
    private final BigDecimal limitPrice;
    
    @NonNull
    private final Instant timestamp;
    
    @NonNull
    private OrderStatus status;
    
    @NonNull
    private BigDecimal filledQuantity;
    
    @JsonCreator
    public Order(
            @JsonProperty("id") UUID id,
            @JsonProperty("accountId") String accountId,
            @JsonProperty("type") OrderType type,
            @JsonProperty("side") OrderSide side,
            @JsonProperty("quantity") BigDecimal quantity,
            @JsonProperty("limitPrice") BigDecimal limitPrice,
            @JsonProperty("timestamp") Instant timestamp,
            @JsonProperty("status") OrderStatus status,
            @JsonProperty("filledQuantity") BigDecimal filledQuantity) {
        this.id = id;
        this.accountId = accountId;
        this.type = type;
        this.side = side;
        this.quantity = quantity;
        this.limitPrice = limitPrice;
        this.timestamp = timestamp;
        this.status = status != null ? status : OrderStatus.PENDING;
        this.filledQuantity = filledQuantity != null ? filledQuantity : BigDecimal.ZERO;
    }
    
    public BigDecimal getRemainingQuantity() {
        return quantity.subtract(filledQuantity);
    }
    
    public boolean isFullyFilled() {
        return filledQuantity.compareTo(quantity) >= 0;
    }
}

