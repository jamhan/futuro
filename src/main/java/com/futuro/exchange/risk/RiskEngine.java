package com.futuro.exchange.risk;

import com.futuro.exchange.domain.Account;
import com.futuro.exchange.domain.Order;
import com.futuro.exchange.domain.Position;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Pre-trade risk engine.
 * 
 * Performs risk checks before orders are submitted to the matching engine:
 * - Max order size
 * - Max position per account
 * - Initial margin requirement
 * - Available balance check
 */
@Component
public class RiskEngine {
    // Configuration (hard-coded for MVP)
    private static final BigDecimal MAX_ORDER_SIZE = new BigDecimal("1000");
    private static final BigDecimal MAX_POSITION = new BigDecimal("5000");
    private static final BigDecimal INITIAL_MARGIN_PER_CONTRACT = new BigDecimal("100");
    
    // In-memory state (would be event-sourced in production)
    private final Map<String, Account> accounts = new ConcurrentHashMap<>();
    private final Map<String, Position> positions = new ConcurrentHashMap<>();
    
    /**
     * Validate an order against risk limits.
     * 
     * @param order The order to validate
     * @return RiskCheckResult with pass/fail and reason
     */
    public RiskCheckResult validateOrder(Order order) {
        // Check max order size
        if (order.getQuantity().compareTo(MAX_ORDER_SIZE) > 0) {
            return RiskCheckResult.reject(
                "Order size " + order.getQuantity() + " exceeds maximum " + MAX_ORDER_SIZE
            );
        }
        
        // Get or create account
        Account account = accounts.computeIfAbsent(
            order.getAccountId(),
            id -> Account.builder()
                .id(id)
                .cashBalance(BigDecimal.ZERO)
                .initialMargin(BigDecimal.ZERO)
                .build()
        );
        
        // Get current position
        Position position = positions.getOrDefault(
            order.getAccountId(),
            Position.builder()
                .accountId(order.getAccountId())
                .quantity(BigDecimal.ZERO)
                .averagePrice(BigDecimal.ZERO)
                .unrealizedPnL(BigDecimal.ZERO)
                .realizedPnL(BigDecimal.ZERO)
                .build()
        );
        
        // Calculate new position after order
        BigDecimal newPositionQuantity;
        if (order.getSide() == com.futuro.exchange.domain.OrderSide.BUY) {
            newPositionQuantity = position.getQuantity().add(order.getQuantity());
        } else {
            newPositionQuantity = position.getQuantity().subtract(order.getQuantity());
        }
        
        // Check max position
        BigDecimal absNewPosition = newPositionQuantity.abs();
        if (absNewPosition.compareTo(MAX_POSITION) > 0) {
            return RiskCheckResult.reject(
                "New position " + absNewPosition + " would exceed maximum " + MAX_POSITION
            );
        }
        
        // Check initial margin requirement
        BigDecimal requiredMargin = absNewPosition.multiply(INITIAL_MARGIN_PER_CONTRACT);
        BigDecimal availableBalance = account.getAvailableBalance();
        
        if (requiredMargin.compareTo(availableBalance) > 0) {
            return RiskCheckResult.reject(
                "Insufficient margin. Required: " + requiredMargin + 
                ", Available: " + availableBalance
            );
        }
        
        return RiskCheckResult.accept();
    }
    
    /**
     * Update account balance (called by clearing engine).
     */
    public void updateAccount(Account account) {
        accounts.put(account.getId(), account);
    }
    
    /**
     * Update position (called by clearing engine).
     */
    public void updatePosition(Position position) {
        positions.put(position.getAccountId(), position);
    }
    
    /**
     * Result of a risk check.
     */
    public static class RiskCheckResult {
        private final boolean passed;
        private final String rejectionReason;
        
        private RiskCheckResult(boolean passed, String rejectionReason) {
            this.passed = passed;
            this.rejectionReason = rejectionReason;
        }
        
        public static RiskCheckResult accept() {
            return new RiskCheckResult(true, null);
        }
        
        public static RiskCheckResult reject(String reason) {
            return new RiskCheckResult(false, reason);
        }
        
        public boolean isPassed() {
            return passed;
        }
        
        public String getRejectionReason() {
            return rejectionReason;
        }
    }
}


