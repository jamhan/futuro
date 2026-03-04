package com.futuro.exchange.events;

import com.futuro.exchange.domain.IndexValue;
import lombok.Builder;
import lombok.Data;

import java.time.Instant;
import java.util.UUID;

/**
 * Event emitted when the weather index value is updated.
 */
@Data
@Builder
public class IndexValueUpdatedEvent implements Event {
    private final UUID eventId;
    private final Instant timestamp;
    private final IndexValue indexValue;
    
    public IndexValueUpdatedEvent(UUID eventId, Instant timestamp, IndexValue indexValue) {
        this.eventId = eventId != null ? eventId : UUID.randomUUID();
        this.timestamp = timestamp != null ? timestamp : Instant.now();
        this.indexValue = indexValue;
    }
    
    @Override
    public String getType() {
        return "INDEX_VALUE_UPDATED";
    }
}


