package com.futuro.exchange.events;

import lombok.Builder;
import lombok.Data;

import java.time.Instant;
import java.util.UUID;

/**
 * Event emitted when an order is cancelled.
 */
@Data
@Builder
public class OrderCancelledEvent implements Event {
    private final UUID eventId;
    private final Instant timestamp;
    private final UUID orderId;
    private final String accountId;
    
    public OrderCancelledEvent(UUID eventId, Instant timestamp, UUID orderId, String accountId) {
        this.eventId = eventId != null ? eventId : UUID.randomUUID();
        this.timestamp = timestamp != null ? timestamp : Instant.now();
        this.orderId = orderId;
        this.accountId = accountId;
    }
    
    @Override
    public String getType() {
        return "ORDER_CANCELLED";
    }
}


