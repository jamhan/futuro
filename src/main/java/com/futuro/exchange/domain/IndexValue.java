package com.futuro.exchange.domain;

import lombok.Builder;
import lombok.Data;
import lombok.NonNull;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.Instant;

/**
 * Represents a weather index value for a specific month.
 * 
 * The index value is the total monthly rainfall in millimeters (mm)
 * for a specific weather station and month.
 */
@Data
@Builder
public class IndexValue {
    @NonNull
    private final String stationId;
    
    @NonNull
    private final LocalDate month; // First day of the month
    
    @NonNull
    private final BigDecimal totalRainfallMm;
    
    @NonNull
    private final Instant calculatedAt;
    
    /**
     * Version number for tracking updates (manual overrides increment this).
     */
    private final int version;
    
    /**
     * Whether this value was manually overridden (vs calculated from CSV).
     */
    private final boolean manualOverride;
    
    public IndexValue(
            String stationId,
            LocalDate month,
            BigDecimal totalRainfallMm,
            Instant calculatedAt,
            int version,
            boolean manualOverride) {
        this.stationId = stationId;
        this.month = month;
        this.totalRainfallMm = totalRainfallMm != null ? totalRainfallMm : BigDecimal.ZERO;
        this.calculatedAt = calculatedAt != null ? calculatedAt : Instant.now();
        this.version = version;
        this.manualOverride = manualOverride;
    }
}


