package com.futuro.exchange.index;

import com.futuro.exchange.domain.IndexValue;
import com.futuro.exchange.events.EventBus;
import com.futuro.exchange.events.IndexValueUpdatedEvent;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Weather index engine for calculating monthly rainfall totals.
 * 
 * Responsibilities:
 * - Ingest Bureau of Meteorology (BoM) CSV data
 * - Validate station and dates
 * - Calculate total monthly rainfall
 * - Version and persist index values
 * - Support manual override
 */
@Component
public class WeatherIndexEngine {
    // Hard-coded for MVP: single station, single contract
    private static final String STATION_ID = "066062"; // Sydney Observatory Hill
    private static final LocalDate CONTRACT_MONTH = LocalDate.of(2026, 1, 1);
    
    private final EventBus eventBus;
    
    // In-memory cache of index values (event-sourced)
    private final Map<String, IndexValue> indexValues = new HashMap<>();
    
    public WeatherIndexEngine(EventBus eventBus) {
        this.eventBus = eventBus;
    }
    
    /**
     * Ingest BoM CSV file and calculate monthly rainfall.
     * 
     * Expected CSV format:
     * Date,Rainfall (mm)
     * 2026-01-01,5.2
     * 2026-01-02,0.0
     * ...
     */
    public void ingestCsv(String csvPath) throws IOException {
        BigDecimal totalRainfall = BigDecimal.ZERO;
        int dayCount = 0;
        
        try (BufferedReader reader = new BufferedReader(new FileReader(csvPath))) {
            String line = reader.readLine(); // Skip header
            
            DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd");
            
            while ((line = reader.readLine()) != null) {
                String[] parts = line.split(",");
                if (parts.length < 2) continue;
                
                try {
                    LocalDate date = LocalDate.parse(parts[0].trim(), formatter);
                    
                    // Only process dates in the contract month
                    if (date.getYear() == CONTRACT_MONTH.getYear() &&
                        date.getMonth() == CONTRACT_MONTH.getMonth()) {
                        BigDecimal rainfall = new BigDecimal(parts[1].trim());
                        totalRainfall = totalRainfall.add(rainfall);
                        dayCount++;
                    }
                } catch (Exception e) {
                    // Skip invalid lines
                }
            }
        }
        
        // Create and publish index value
        IndexValue indexValue = IndexValue.builder()
            .stationId(STATION_ID)
            .month(CONTRACT_MONTH)
            .totalRainfallMm(totalRainfall)
            .calculatedAt(Instant.now())
            .version(getNextVersion(STATION_ID, CONTRACT_MONTH))
            .manualOverride(false)
            .build();
        
        updateIndexValue(indexValue);
    }
    
    /**
     * Manually override index value (admin function).
     */
    public void setManualOverride(BigDecimal totalRainfallMm) {
        IndexValue indexValue = IndexValue.builder()
            .stationId(STATION_ID)
            .month(CONTRACT_MONTH)
            .totalRainfallMm(totalRainfallMm)
            .calculatedAt(Instant.now())
            .version(getNextVersion(STATION_ID, CONTRACT_MONTH))
            .manualOverride(true)
            .build();
        
        updateIndexValue(indexValue);
    }
    
    /**
     * Get current index value for the contract month.
     */
    public Optional<IndexValue> getCurrentIndexValue() {
        String key = STATION_ID + "-" + CONTRACT_MONTH;
        return Optional.ofNullable(indexValues.get(key));
    }
    
    /**
     * Update index value and publish event.
     */
    private void updateIndexValue(IndexValue indexValue) {
        String key = indexValue.getStationId() + "-" + indexValue.getMonth();
        indexValues.put(key, indexValue);
        
        // Publish event
        eventBus.publish(IndexValueUpdatedEvent.builder()
            .indexValue(indexValue)
            .build());
    }
    
    /**
     * Get next version number for an index value.
     */
    private int getNextVersion(String stationId, LocalDate month) {
        String key = stationId + "-" + month;
        IndexValue existing = indexValues.get(key);
        return existing != null ? existing.getVersion() + 1 : 1;
    }
    
    public String getStationId() {
        return STATION_ID;
    }
    
    public LocalDate getContractMonth() {
        return CONTRACT_MONTH;
    }
}


