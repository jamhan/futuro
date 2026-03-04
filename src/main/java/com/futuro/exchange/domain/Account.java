package com.futuro.exchange.domain;

import lombok.Builder;
import lombok.Data;
import lombok.NonNull;

import java.math.BigDecimal;

/**
 * Represents an account with cash balance and margin requirements.
 * 
 * Accounts maintain:
 * - Cash balance: Available funds for trading and margin
 * - Initial margin: Required margin for open positions
 * - Variation margin: Daily PnL adjustments
 */
@Data
@Builder
public class Account {
    @NonNull
    private final String id;
    
    /**
     * Cash balance in the account.
     */
    @NonNull
    private BigDecimal cashBalance;
    
    /**
     * Initial margin requirement for open positions.
     */
    @NonNull
    private BigDecimal initialMargin;
    
    /**
     * Available balance = cashBalance - initialMargin
     */
    public BigDecimal getAvailableBalance() {
        return cashBalance.subtract(initialMargin);
    }
    
    public Account(String id, BigDecimal cashBalance, BigDecimal initialMargin) {
        this.id = id;
        this.cashBalance = cashBalance != null ? cashBalance : BigDecimal.ZERO;
        this.initialMargin = initialMargin != null ? initialMargin : BigDecimal.ZERO;
    }
}


