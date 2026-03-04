package com.futuro.exchange.events;

import com.futuro.exchange.domain.Trade;
import lombok.Builder;
import lombok.Data;

import java.time.Instant;
import java.util.UUID;

/**
 * Event emitted when a trade occurs (orders matched).
 */
@Data
@Builder
public class TradeEvent implements Event {
    private final UUID eventId;
    private final Instant timestamp;
    private final Trade trade;
    
    public TradeEvent(UUID eventId, Instant timestamp, Trade trade) {
        this.eventId = eventId != null ? eventId : UUID.randomUUID();
        this.timestamp = timestamp != null ? timestamp : Instant.now();
        this.trade = trade;
    }
    
    @Override
    public String getType() {
        return "TRADE";
    }
}


