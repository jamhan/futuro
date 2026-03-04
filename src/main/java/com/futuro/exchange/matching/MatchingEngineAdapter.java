package com.futuro.exchange.matching;

import com.futuro.exchange.domain.Order;
import com.futuro.exchange.domain.Trade;
import com.futuro.exchange.events.EventBus;
import com.futuro.exchange.events.OrderAcceptedEvent;
import com.futuro.exchange.events.OrderRejectedEvent;
import com.futuro.exchange.events.TradeEvent;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * Matching engine adapter that wraps the matching engine and emits events.
 * 
 * This adapter:
 * - Accepts orders and attempts to match them
 * - Emits OrderAccepted, OrderRejected, and Trade events
 * - Maintains the order book state
 * - No business logic - pure matching only
 */
@Component
public class MatchingEngineAdapter {
    private final OrderBook orderBook;
    private final EventBus eventBus;
    
    public MatchingEngineAdapter(EventBus eventBus) {
        this.orderBook = new OrderBook();
        this.eventBus = eventBus;
    }
    
    /**
     * Submit an order for matching.
     * 
     * @param order The order to submit
     * @return true if order was accepted, false if rejected
     */
    public boolean submitOrder(Order order) {
        // Validate order
        if (order.getQuantity().compareTo(java.math.BigDecimal.ZERO) <= 0) {
            rejectOrder(order.getId(), order.getAccountId(), "Order quantity must be positive");
            return false;
        }
        
        if (order.getType() == com.futuro.exchange.domain.OrderType.LIMIT && 
            order.getLimitPrice() == null) {
            rejectOrder(order.getId(), order.getAccountId(), "Limit orders must have a price");
            return false;
        }
        
        // Attempt to match the order
        MatchingEngine.MatchingResult result = MatchingEngine.matchOrder(order, orderBook);
        
        // Emit trade events
        for (Trade trade : result.getTrades()) {
            eventBus.publish(TradeEvent.builder()
                .trade(trade)
                .build());
        }
        
        // Handle remaining order
        if (result.getRemainingOrder() != null) {
            // Partially or not filled - add to book
            orderBook.addOrder(result.getRemainingOrder());
            eventBus.publish(OrderAcceptedEvent.builder()
                .order(result.getRemainingOrder())
                .build());
        } else {
            // Fully filled
            eventBus.publish(OrderAcceptedEvent.builder()
                .order(order)
                .build());
        }
        
        return true;
    }
    
    /**
     * Cancel an order.
     */
    public boolean cancelOrder(UUID orderId, String accountId) {
        boolean removed = orderBook.removeOrder(orderId);
        if (removed) {
            // Emit cancellation event (handled by event bus subscribers)
            return true;
        }
        return false;
    }
    
    private void rejectOrder(UUID orderId, String accountId, String reason) {
        eventBus.publish(OrderRejectedEvent.builder()
            .orderId(orderId)
            .accountId(accountId)
            .reason(reason)
            .build());
    }
    
    /**
     * Get current order book state (for debugging/display).
     */
    public OrderBook getOrderBook() {
        return orderBook;
    }
}


