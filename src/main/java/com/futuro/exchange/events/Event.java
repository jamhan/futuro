package com.futuro.exchange.events;

import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;

import java.time.Instant;
import java.util.UUID;

/**
 * Base interface for all events in the event-sourced system.
 * 
 * All state mutations must originate from events.
 * Events are immutable and append-only.
 */
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type")
@JsonSubTypes({
    @JsonSubTypes.Type(value = OrderAcceptedEvent.class, name = "ORDER_ACCEPTED"),
    @JsonSubTypes.Type(value = OrderRejectedEvent.class, name = "ORDER_REJECTED"),
    @JsonSubTypes.Type(value = TradeEvent.class, name = "TRADE"),
    @JsonSubTypes.Type(value = OrderCancelledEvent.class, name = "ORDER_CANCELLED"),
    @JsonSubTypes.Type(value = IndexValueUpdatedEvent.class, name = "INDEX_VALUE_UPDATED"),
    @JsonSubTypes.Type(value = SettlementEvent.class, name = "SETTLEMENT")
})
public interface Event {
    /**
     * Unique event ID.
     */
    UUID getEventId();
    
    /**
     * Timestamp when the event occurred.
     */
    Instant getTimestamp();
    
    /**
     * Event type identifier.
     */
    String getType();
}


