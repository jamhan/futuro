package com.futuro.exchange.events;

import com.futuro.exchange.domain.Order;
import lombok.Builder;
import lombok.Data;

import java.time.Instant;
import java.util.UUID;

/**
 * Event emitted when an order is accepted by the matching engine.
 */
@Data
@Builder
public class OrderAcceptedEvent implements Event {
    private final UUID eventId;
    private final Instant timestamp;
    private final Order order;
    
    public OrderAcceptedEvent(UUID eventId, Instant timestamp, Order order) {
        this.eventId = eventId != null ? eventId : UUID.randomUUID();
        this.timestamp = timestamp != null ? timestamp : Instant.now();
        this.order = order;
    }
    
    @Override
    public String getType() {
        return "ORDER_ACCEPTED";
    }
}


