package com.futuro.exchange.clearing;

import com.futuro.exchange.domain.Account;
import com.futuro.exchange.domain.IndexValue;
import com.futuro.exchange.domain.Position;
import com.futuro.exchange.domain.Trade;
import com.futuro.exchange.events.Event;
import com.futuro.exchange.events.EventBus;
import com.futuro.exchange.events.TradeEvent;
import com.futuro.exchange.risk.RiskEngine;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Clearing engine maintains positions and calculates PnL.
 * 
 * Responsibilities:
 * - Maintain positions from trades
 * - Calculate daily PnL based on current index value
 * - Apply variation margin to cash ledger
 * - Support final settlement at expiry
 */
@Component
public class ClearingEngine {
    private static final BigDecimal INITIAL_MARGIN_PER_CONTRACT = new BigDecimal("100");
    
    private final EventBus eventBus;
    private final RiskEngine riskEngine;
    
    // In-memory state (event-sourced)
    private final Map<String, Account> accounts = new ConcurrentHashMap<>();
    private final Map<String, Position> positions = new ConcurrentHashMap<>();
    
    // Current index value for PnL calculation
    private IndexValue currentIndexValue;
    
    public ClearingEngine(EventBus eventBus, RiskEngine riskEngine) {
        this.eventBus = eventBus;
        this.riskEngine = riskEngine;
    }
    
    @PostConstruct
    public void init() {
        // Subscribe to trade events
        eventBus.subscribe(this::handleEvent);
        
        // Replay all events to rebuild state
        eventBus.replayAll(this::handleEvent);
    }
    
    private void handleEvent(Event event) {
        if (event instanceof TradeEvent tradeEvent) {
            handleTrade(tradeEvent.getTrade());
        } else if (event instanceof com.futuro.exchange.events.IndexValueUpdatedEvent indexEvent) {
            handleIndexUpdate(indexEvent.getIndexValue());
        } else if (event instanceof com.futuro.exchange.events.SettlementEvent settlementEvent) {
            handleSettlement(settlementEvent);
        }
    }
    
    /**
     * Handle a trade event - update positions.
     */
    private void handleTrade(Trade trade) {
        // Update buyer position
        updatePosition(
            trade.getBuyAccountId(),
            trade.getQuantity(),
            trade.getPrice()
        );
        
        // Update seller position
        updatePosition(
            trade.getSellAccountId(),
            trade.getQuantity().negate(),
            trade.getPrice()
        );
        
        // Recalculate PnL for both accounts
        recalculatePnL(trade.getBuyAccountId());
        recalculatePnL(trade.getSellAccountId());
    }
    
    /**
     * Update position after a trade.
     */
    private void updatePosition(String accountId, BigDecimal quantityDelta, BigDecimal tradePrice) {
        Position currentPosition = positions.getOrDefault(
            accountId,
            Position.builder()
                .accountId(accountId)
                .quantity(BigDecimal.ZERO)
                .averagePrice(BigDecimal.ZERO)
                .unrealizedPnL(BigDecimal.ZERO)
                .realizedPnL(BigDecimal.ZERO)
                .build()
        );
        
        BigDecimal newQuantity = currentPosition.getQuantity().add(quantityDelta);
        BigDecimal newAveragePrice;
        
        if (newQuantity.compareTo(BigDecimal.ZERO) == 0) {
            // Position closed
            newAveragePrice = BigDecimal.ZERO;
        } else if (currentPosition.getQuantity().compareTo(BigDecimal.ZERO) == 0) {
            // Opening new position
            newAveragePrice = tradePrice;
        } else if ((currentPosition.getQuantity().compareTo(BigDecimal.ZERO) > 0 && 
                    quantityDelta.compareTo(BigDecimal.ZERO) > 0) ||
                   (currentPosition.getQuantity().compareTo(BigDecimal.ZERO) < 0 && 
                    quantityDelta.compareTo(BigDecimal.ZERO) < 0)) {
            // Increasing position - weighted average
            BigDecimal totalValue = currentPosition.getQuantity()
                .multiply(currentPosition.getAveragePrice())
                .add(quantityDelta.multiply(tradePrice));
            newAveragePrice = totalValue.divide(newQuantity, 4, RoundingMode.HALF_UP);
        } else {
            // Reducing position - calculate realized PnL
            BigDecimal closedQuantity = quantityDelta.abs();
            BigDecimal realizedPnL;
            
            if (currentPosition.getQuantity().compareTo(BigDecimal.ZERO) > 0) {
                // Closing long position
                realizedPnL = closedQuantity.multiply(tradePrice.subtract(currentPosition.getAveragePrice()));
            } else {
                // Closing short position
                realizedPnL = closedQuantity.multiply(currentPosition.getAveragePrice().subtract(tradePrice));
            }
            
            currentPosition.setRealizedPnL(
                currentPosition.getRealizedPnL().add(realizedPnL)
            );
            
            // Update average price for remaining position
            if (newQuantity.compareTo(BigDecimal.ZERO) != 0) {
                newAveragePrice = currentPosition.getAveragePrice();
            } else {
                newAveragePrice = BigDecimal.ZERO;
            }
        }
        
        Position newPosition = Position.builder()
            .accountId(accountId)
            .quantity(newQuantity)
            .averagePrice(newAveragePrice)
            .unrealizedPnL(currentPosition.getUnrealizedPnL())
            .realizedPnL(currentPosition.getRealizedPnL())
            .build();
        
        positions.put(accountId, newPosition);
        riskEngine.updatePosition(newPosition);
        
        // Update initial margin requirement
        updateInitialMargin(accountId, newQuantity.abs());
    }
    
    /**
     * Recalculate unrealized PnL based on current index value.
     */
    private void recalculatePnL(String accountId) {
        Position position = positions.get(accountId);
        if (position == null || currentIndexValue == null) {
            return;
        }
        
        BigDecimal unrealizedPnL = BigDecimal.ZERO;
        if (!position.isFlat()) {
            BigDecimal currentPrice = currentIndexValue.getTotalRainfallMm();
            if (position.isLong()) {
                unrealizedPnL = position.getQuantity()
                    .multiply(currentPrice.subtract(position.getAveragePrice()));
            } else {
                unrealizedPnL = position.getQuantity().abs()
                    .multiply(position.getAveragePrice().subtract(currentPrice));
            }
        }
        
        position.setUnrealizedPnL(unrealizedPnL);
        
        // Apply variation margin to cash balance
        applyVariationMargin(accountId, unrealizedPnL);
    }
    
    /**
     * Apply variation margin (daily PnL) to cash balance.
     */
    private void applyVariationMargin(String accountId, BigDecimal unrealizedPnL) {
        Account account = accounts.computeIfAbsent(
            accountId,
            id -> Account.builder()
                .id(id)
                .cashBalance(BigDecimal.ZERO)
                .initialMargin(BigDecimal.ZERO)
                .build()
        );
        
        // Variation margin = change in unrealized PnL
        // For MVP, we simply set cash balance based on realized + unrealized PnL
        // In production, this would track daily changes
        
        Position position = positions.get(accountId);
        if (position != null) {
            BigDecimal totalPnL = position.getRealizedPnL().add(position.getUnrealizedPnL());
            // Assume initial cash balance was sufficient for margin
            // For MVP, we track PnL separately
        }
        
        riskEngine.updateAccount(account);
    }
    
    /**
     * Update initial margin requirement.
     */
    private void updateInitialMargin(String accountId, BigDecimal positionSize) {
        Account account = accounts.computeIfAbsent(
            accountId,
            id -> Account.builder()
                .id(id)
                .cashBalance(BigDecimal.ZERO)
                .initialMargin(BigDecimal.ZERO)
                .build()
        );
        
        BigDecimal requiredMargin = positionSize.multiply(INITIAL_MARGIN_PER_CONTRACT);
        account.setInitialMargin(requiredMargin);
        
        accounts.put(accountId, account);
        riskEngine.updateAccount(account);
    }
    
    /**
     * Handle index value update - recalculate all PnL.
     */
    private void handleIndexUpdate(IndexValue indexValue) {
        this.currentIndexValue = indexValue;
        
        // Recalculate PnL for all positions
        for (String accountId : positions.keySet()) {
            recalculatePnL(accountId);
        }
    }
    
    /**
     * Handle final settlement at expiry.
     */
    private void handleSettlement(com.futuro.exchange.events.SettlementEvent settlementEvent) {
        BigDecimal finalPrice = settlementEvent.getFinalSettlementPrice();
        
        // Close all positions at final settlement price
        for (Position position : positions.values()) {
            if (!position.isFlat()) {
                // Calculate final PnL
                BigDecimal finalPnL;
                if (position.isLong()) {
                    finalPnL = position.getQuantity()
                        .multiply(finalPrice.subtract(position.getAveragePrice()));
                } else {
                    finalPnL = position.getQuantity().abs()
                        .multiply(position.getAveragePrice().subtract(finalPrice));
                }
                
                // Add to realized PnL
                position.setRealizedPnL(position.getRealizedPnL().add(finalPnL));
                position.setUnrealizedPnL(BigDecimal.ZERO);
                position.setQuantity(BigDecimal.ZERO);
                
                // Update account
                Account account = accounts.get(position.getAccountId());
                if (account != null) {
                    account.setCashBalance(
                        account.getCashBalance().add(finalPnL)
                    );
                    account.setInitialMargin(BigDecimal.ZERO);
                }
            }
        }
    }
    
    /**
     * Get position for an account.
     */
    public Position getPosition(String accountId) {
        return positions.getOrDefault(
            accountId,
            Position.builder()
                .accountId(accountId)
                .quantity(BigDecimal.ZERO)
                .averagePrice(BigDecimal.ZERO)
                .unrealizedPnL(BigDecimal.ZERO)
                .realizedPnL(BigDecimal.ZERO)
                .build()
        );
    }
    
    /**
     * Get account.
     */
    public Account getAccount(String accountId) {
        return accounts.getOrDefault(
            accountId,
            Account.builder()
                .id(accountId)
                .cashBalance(BigDecimal.ZERO)
                .initialMargin(BigDecimal.ZERO)
                .build()
        );
    }
}


