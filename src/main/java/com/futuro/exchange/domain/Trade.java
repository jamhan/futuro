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
 * Represents a matched trade between two orders.
 * 
 * A trade occurs when a buy order matches with a sell order.
 * The trade price is determined by price-time priority:
 * - Resting orders have price priority
 * - Among same price, oldest order has priority
 */
@Data
@Builder
public class Trade {
    @NonNull
    private final UUID id;
    
    @NonNull
    private final UUID buyOrderId;
    
    @NonNull
    private final UUID sellOrderId;
    
    @NonNull
    private final String buyAccountId;
    
    @NonNull
    private final String sellAccountId;
    
    @NonNull
    private final BigDecimal price;
    
    @NonNull
    private final BigDecimal quantity;
    
    @NonNull
    private final Instant timestamp;
    
    @JsonCreator
    public Trade(
            @JsonProperty("id") UUID id,
            @JsonProperty("buyOrderId") UUID buyOrderId,
            @JsonProperty("sellOrderId") UUID sellOrderId,
            @JsonProperty("buyAccountId") String buyAccountId,
            @JsonProperty("sellAccountId") String sellAccountId,
            @JsonProperty("price") BigDecimal price,
            @JsonProperty("quantity") BigDecimal quantity,
            @JsonProperty("timestamp") Instant timestamp) {
        this.id = id;
        this.buyOrderId = buyOrderId;
        this.sellOrderId = sellOrderId;
        this.buyAccountId = buyAccountId;
        this.sellAccountId = sellAccountId;
        this.price = price;
        this.quantity = quantity;
        this.timestamp = timestamp;
    }
}


