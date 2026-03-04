package com.futuro.exchange.events;

import lombok.Builder;
import lombok.Data;

import java.time.Instant;
import java.util.UUID;

/**
 * Event emitted when an order is rejected (e.g., by risk engine).
 */
@Data
@Builder
public class OrderRejectedEvent implements Event {
    private final UUID eventId;
    private final Instant timestamp;
    private final UUID orderId;
    private final String accountId;
    private final String reason;
    
    public OrderRejectedEvent(UUID eventId, Instant timestamp, UUID orderId, String accountId, String reason) {
        this.eventId = eventId != null ? eventId : UUID.randomUUID();
        this.timestamp = timestamp != null ? timestamp : Instant.now();
        this.orderId = orderId;
        this.accountId = accountId;
        this.reason = reason;
    }
    
    @Override
    public String getType() {
        return "ORDER_REJECTED";
    }
}


