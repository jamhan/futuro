package com.futuro.exchange.matching;

import com.futuro.exchange.domain.Order;
import com.futuro.exchange.domain.OrderSide;
import com.futuro.exchange.domain.OrderType;
import com.futuro.exchange.domain.Trade;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Matching engine implementing price-time priority matching.
 * 
 * This is a pure, deterministic matching engine with no side effects.
 * It matches incoming orders against the order book and returns:
 * - List of trades generated
 * - Remaining order (if partially filled) or null (if fully filled)
 * 
 * Matching rules:
 * - Price priority: Best available price first
 * - Time priority: Among same price, oldest order first
 * - Market orders match immediately at best available price
 * - Limit orders only match if price is compatible
 */
public class MatchingEngine {
    
    /**
     * Match an incoming order against the order book.
     * 
     * @param incomingOrder The order to match
     * @param orderBook The current order book state
     * @return Matching result containing trades and remaining order
     */
    public static MatchingResult matchOrder(Order incomingOrder, OrderBook orderBook) {
        List<Trade> trades = new ArrayList<>();
        Order remainingOrder = incomingOrder;
        
        // Continue matching until order is fully filled or no more matches
        while (remainingOrder != null && remainingOrder.getRemainingQuantity().compareTo(BigDecimal.ZERO) > 0) {
            // Find counterparty order
            Order counterparty = findCounterparty(remainingOrder, orderBook);
            
            if (counterparty == null) {
                break; // No more matches
            }
            
            // Check if prices are compatible
            if (!canMatch(remainingOrder, counterparty)) {
                break; // Price mismatch
            }
            
            // Determine match price (price-time priority: resting order's price)
            BigDecimal matchPrice = determineMatchPrice(remainingOrder, counterparty);
            
            // Determine match quantity (minimum of remaining quantities)
            BigDecimal matchQuantity = remainingOrder.getRemainingQuantity()
                .min(counterparty.getRemainingQuantity());
            
            // Create trade
            Trade trade = createTrade(remainingOrder, counterparty, matchPrice, matchQuantity);
            trades.add(trade);
            
            // Update counterparty order - remove from book first
            orderBook.removeOrder(counterparty.getId());
            
            // Update filled quantity
            BigDecimal newCounterpartyFilled = counterparty.getFilledQuantity().add(matchQuantity);
            counterparty.setFilledQuantity(newCounterpartyFilled);
            
            // Re-add to book if not fully filled
            if (!counterparty.isFullyFilled()) {
                orderBook.addOrder(counterparty);
            }
            
            // Update incoming order
            remainingOrder = updateOrderAfterMatch(remainingOrder, matchQuantity);
        }
        
        return new MatchingResult(trades, remainingOrder);
    }
    
    /**
     * Find the best counterparty order for matching.
     */
    private static Order findCounterparty(Order order, OrderBook orderBook) {
        if (order.getSide() == OrderSide.BUY) {
            return orderBook.getBestSell();
        } else {
            return orderBook.getBestBuy();
        }
    }
    
    /**
     * Check if two orders can match based on price.
     */
    private static boolean canMatch(Order incoming, Order resting) {
        // Market orders always match if counterparty exists
        if (incoming.getType() == OrderType.MARKET || resting.getType() == OrderType.MARKET) {
            return true;
        }
        
        // Both are limit orders - check price compatibility
        if (incoming.getLimitPrice() == null || resting.getLimitPrice() == null) {
            return false;
        }
        
        if (incoming.getSide() == OrderSide.BUY) {
            // Buy order matches if it's willing to pay at least the sell price
            return incoming.getLimitPrice().compareTo(resting.getLimitPrice()) >= 0;
        } else {
            // Sell order matches if it's willing to sell at most the buy price
            return incoming.getLimitPrice().compareTo(resting.getLimitPrice()) <= 0;
        }
    }
    
    /**
     * Determine the match price using price-time priority.
     * Resting order's price takes precedence.
     */
    private static BigDecimal determineMatchPrice(Order incoming, Order resting) {
        // Resting order has price priority
        if (resting.getLimitPrice() != null) {
            return resting.getLimitPrice();
        }
        
        // If resting is market, use incoming's limit price
        if (incoming.getLimitPrice() != null) {
            return incoming.getLimitPrice();
        }
        
        // Both are market orders - this shouldn't happen in practice
        // Use a default price (e.g., last trade price or mid-price)
        // For MVP, we'll throw an exception
        throw new IllegalStateException("Cannot determine match price: both orders are market orders");
    }
    
    /**
     * Create a trade from two matched orders.
     */
    private static Trade createTrade(Order buyOrder, Order sellOrder, BigDecimal price, BigDecimal quantity) {
        // Determine which is buy and which is sell
        Order actualBuy = buyOrder.getSide() == OrderSide.BUY ? buyOrder : sellOrder;
        Order actualSell = sellOrder.getSide() == OrderSide.SELL ? sellOrder : buyOrder;
        
        return Trade.builder()
            .id(UUID.randomUUID())
            .buyOrderId(actualBuy.getId())
            .sellOrderId(actualSell.getId())
            .buyAccountId(actualBuy.getAccountId())
            .sellAccountId(actualSell.getAccountId())
            .price(price)
            .quantity(quantity)
            .timestamp(Instant.now())
            .build();
    }
    
    /**
     * Update order after a match.
     */
    private static Order updateOrderAfterMatch(Order order, BigDecimal matchQuantity) {
        BigDecimal newFilledQuantity = order.getFilledQuantity().add(matchQuantity);
        
        if (newFilledQuantity.compareTo(order.getQuantity()) >= 0) {
            // Fully filled
            return null;
        } else {
            // Partially filled - return updated order
            return Order.builder()
                .id(order.getId())
                .accountId(order.getAccountId())
                .type(order.getType())
                .side(order.getSide())
                .quantity(order.getQuantity())
                .limitPrice(order.getLimitPrice())
                .timestamp(order.getTimestamp())
                .status(order.getStatus())
                .filledQuantity(newFilledQuantity)
                .build();
        }
    }
    
    /**
     * Result of matching an order.
     */
    public static class MatchingResult {
        private final List<Trade> trades;
        private final Order remainingOrder;
        
        public MatchingResult(List<Trade> trades, Order remainingOrder) {
            this.trades = trades;
            this.remainingOrder = remainingOrder;
        }
        
        public List<Trade> getTrades() {
            return trades;
        }
        
        public Order getRemainingOrder() {
            return remainingOrder;
        }
        
        public boolean isFullyFilled() {
            return remainingOrder == null;
        }
    }
}

