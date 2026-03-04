package com.futuro.exchange.settlement;

import com.futuro.exchange.domain.IndexValue;
import com.futuro.exchange.events.EventBus;
import com.futuro.exchange.events.SettlementEvent;
import com.futuro.exchange.index.WeatherIndexEngine;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

/**
 * Settlement engine for final settlement at contract expiry.
 * 
 * Responsibilities:
 * - Lock index value at expiry
 * - Publish final settlement price
 * - Close all open positions (handled by clearing engine)
 */
@Component
public class SettlementEngine {
    private final EventBus eventBus;
    private final WeatherIndexEngine indexEngine;
    
    private boolean settled = false;
    private BigDecimal finalSettlementPrice;
    
    public SettlementEngine(EventBus eventBus, WeatherIndexEngine indexEngine) {
        this.eventBus = eventBus;
        this.indexEngine = indexEngine;
    }
    
    /**
     * Trigger final settlement (admin function).
     * 
     * This locks the current index value and publishes a settlement event.
     */
    public void settle() {
        if (settled) {
            throw new IllegalStateException("Contract already settled");
        }
        
        // Get current index value
        IndexValue indexValue = indexEngine.getCurrentIndexValue()
            .orElseThrow(() -> new IllegalStateException("No index value available for settlement"));
        
        // Lock settlement price
        finalSettlementPrice = indexValue.getTotalRainfallMm();
        settled = true;
        
        // Publish settlement event
        eventBus.publish(SettlementEvent.builder()
            .stationId(indexEngine.getStationId())
            .month(indexEngine.getContractMonth())
            .finalSettlementPrice(finalSettlementPrice)
            .build());
    }
    
    /**
     * Check if contract is settled.
     */
    public boolean isSettled() {
        return settled;
    }
    
    /**
     * Get final settlement price (if settled).
     */
    public BigDecimal getFinalSettlementPrice() {
        if (!settled) {
            throw new IllegalStateException("Contract not yet settled");
        }
        return finalSettlementPrice;
    }
}


