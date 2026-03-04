package com.futuro.exchange.api;

import com.futuro.exchange.clearing.ClearingEngine;
import com.futuro.exchange.domain.Position;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * REST API for position queries.
 */
@RestController
@RequestMapping("/api/positions")
public class PositionController {
    private final ClearingEngine clearingEngine;
    
    public PositionController(ClearingEngine clearingEngine) {
        this.clearingEngine = clearingEngine;
    }
    
    /**
     * Get position for an account.
     * 
     * GET /api/positions/{accountId}
     */
    @GetMapping("/{accountId}")
    public ResponseEntity<Position> getPosition(@PathVariable String accountId) {
        Position position = clearingEngine.getPosition(accountId);
        return ResponseEntity.ok(position);
    }
}


