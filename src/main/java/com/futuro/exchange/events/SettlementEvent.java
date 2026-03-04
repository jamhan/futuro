package com.futuro.exchange.events;

import lombok.Builder;
import lombok.Data;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Event emitted when final settlement occurs at contract expiry.
 */
@Data
@Builder
public class SettlementEvent implements Event {
    private final UUID eventId;
    private final Instant timestamp;
    private final String stationId;
    private final java.time.LocalDate month;
    private final BigDecimal finalSettlementPrice;
    
    public SettlementEvent(UUID eventId, Instant timestamp, String stationId, 
                          java.time.LocalDate month, BigDecimal finalSettlementPrice) {
        this.eventId = eventId != null ? eventId : UUID.randomUUID();
        this.timestamp = timestamp != null ? timestamp : Instant.now();
        this.stationId = stationId;
        this.month = month;
        this.finalSettlementPrice = finalSettlementPrice;
    }
    
    @Override
    public String getType() {
        return "SETTLEMENT";
    }
}


