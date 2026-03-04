package com.futuro.exchange.api;

import com.futuro.exchange.clearing.ClearingEngine;
import com.futuro.exchange.domain.Account;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * REST API for balance queries.
 */
@RestController
@RequestMapping("/api/balances")
public class BalanceController {
    private final ClearingEngine clearingEngine;
    
    public BalanceController(ClearingEngine clearingEngine) {
        this.clearingEngine = clearingEngine;
    }
    
    /**
     * Get account balance.
     * 
     * GET /api/balances/{accountId}
     */
    @GetMapping("/{accountId}")
    public ResponseEntity<Account> getBalance(@PathVariable String accountId) {
        Account account = clearingEngine.getAccount(accountId);
        return ResponseEntity.ok(account);
    }
}


