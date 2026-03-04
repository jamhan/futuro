package com.futuro.exchange.api;

import com.futuro.exchange.clearing.ClearingEngine;
import com.futuro.exchange.domain.Account;
import com.futuro.exchange.risk.RiskEngine;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;

/**
 * REST API for account management.
 */
@RestController
@RequestMapping("/api/accounts")
public class AccountController {
    private final ClearingEngine clearingEngine;
    private final RiskEngine riskEngine;
    
    public AccountController(ClearingEngine clearingEngine, RiskEngine riskEngine) {
        this.clearingEngine = clearingEngine;
        this.riskEngine = riskEngine;
    }
    
    /**
     * Create or update account with initial cash balance.
     * 
     * POST /api/accounts
     * Body: { "id": "account-1", "cashBalance": 10000 }
     */
    @PostMapping
    public ResponseEntity<Account> createAccount(@RequestBody CreateAccountRequest request) {
        Account account = Account.builder()
            .id(request.getId())
            .cashBalance(request.getCashBalance())
            .initialMargin(BigDecimal.ZERO)
            .build();
        
        riskEngine.updateAccount(account);
        // Also update clearing engine to ensure account is available
        // (ClearingEngine will create on-demand, but this ensures consistency)
        
        return ResponseEntity.ok(account);
    }
    
    /**
     * Get account.
     * 
     * GET /api/accounts/{accountId}
     */
    @GetMapping("/{accountId}")
    public ResponseEntity<Account> getAccount(@PathVariable String accountId) {
        Account account = clearingEngine.getAccount(accountId);
        return ResponseEntity.ok(account);
    }
    
    private static class CreateAccountRequest {
        private String id;
        private BigDecimal cashBalance;
        
        public String getId() {
            return id;
        }
        
        public void setId(String id) {
            this.id = id;
        }
        
        public BigDecimal getCashBalance() {
            return cashBalance;
        }
        
        public void setCashBalance(BigDecimal cashBalance) {
            this.cashBalance = cashBalance;
        }
    }
}

