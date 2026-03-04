package com.futuro.exchange.api;

import com.futuro.exchange.index.WeatherIndexEngine;
import com.futuro.exchange.settlement.SettlementEngine;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;

/**
 * Admin REST API for settlement and index management.
 */
@RestController
@RequestMapping("/api/admin")
public class AdminController {
    private final SettlementEngine settlementEngine;
    private final WeatherIndexEngine indexEngine;
    
    public AdminController(SettlementEngine settlementEngine, WeatherIndexEngine indexEngine) {
        this.settlementEngine = settlementEngine;
        this.indexEngine = indexEngine;
    }
    
    /**
     * Trigger final settlement.
     * 
     * POST /api/admin/settle
     */
    @PostMapping("/settle")
    public ResponseEntity<?> settle() {
        try {
            settlementEngine.settle();
            return ResponseEntity.ok("Settlement completed. Final price: " + 
                settlementEngine.getFinalSettlementPrice());
        } catch (Exception e) {
            return ResponseEntity.status(500)
                .body("Settlement failed: " + e.getMessage());
        }
    }
    
    /**
     * Manually override index value.
     * 
     * POST /api/admin/index/override
     * Body: { "totalRainfallMm": 150.5 }
     */
    @PostMapping("/index/override")
    public ResponseEntity<?> overrideIndex(@RequestBody OverrideIndexRequest request) {
        try {
            indexEngine.setManualOverride(request.getTotalRainfallMm());
            return ResponseEntity.ok("Index value overridden to: " + request.getTotalRainfallMm() + " mm");
        } catch (Exception e) {
            return ResponseEntity.status(500)
                .body("Index override failed: " + e.getMessage());
        }
    }
    
    /**
     * Ingest CSV file.
     * 
     * POST /api/admin/index/ingest
     * Body: { "csvPath": "/path/to/file.csv" }
     */
    @PostMapping("/index/ingest")
    public ResponseEntity<?> ingestCsv(@RequestBody IngestCsvRequest request) {
        try {
            indexEngine.ingestCsv(request.getCsvPath());
            return ResponseEntity.ok("CSV ingested successfully");
        } catch (Exception e) {
            return ResponseEntity.status(500)
                .body("CSV ingestion failed: " + e.getMessage());
        }
    }
    
    private static class OverrideIndexRequest {
        private BigDecimal totalRainfallMm;
        
        public BigDecimal getTotalRainfallMm() {
            return totalRainfallMm;
        }
        
        public void setTotalRainfallMm(BigDecimal totalRainfallMm) {
            this.totalRainfallMm = totalRainfallMm;
        }
    }
    
    private static class IngestCsvRequest {
        private String csvPath;
        
        public String getCsvPath() {
            return csvPath;
        }
        
        public void setCsvPath(String csvPath) {
            this.csvPath = csvPath;
        }
    }
}


