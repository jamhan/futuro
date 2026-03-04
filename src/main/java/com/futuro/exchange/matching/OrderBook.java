package com.futuro.exchange.matching;

import com.futuro.exchange.domain.Order;
import com.futuro.exchange.domain.OrderSide;

import java.math.BigDecimal;
import java.util.*;
import java.util.UUID;

/**
 * Central Limit Order Book (CLOB) with price-time priority.
 * 
 * Orders are sorted by:
 * - Price priority: Best price first
 *   * Buy orders: Highest price first (willing to pay more)
 *   * Sell orders: Lowest price first (willing to sell for less)
 * - Time priority: Among same price, oldest order first
 */
public class OrderBook {
    // Buy orders: TreeMap sorted by price (descending), then by timestamp, then by order ID
    private final TreeMap<PriceTimeKey, Order> buyOrders = new TreeMap<>(
        (a, b) -> {
            int priceCompare = b.price.compareTo(a.price); // Descending
            if (priceCompare != 0) return priceCompare;
            int timeCompare = a.timestamp.compareTo(b.timestamp); // Ascending (oldest first)
            if (timeCompare != 0) return timeCompare;
            return a.orderId.compareTo(b.orderId); // For uniqueness
        }
    );
    
    // Sell orders: TreeMap sorted by price (ascending), then by timestamp, then by order ID
    private final TreeMap<PriceTimeKey, Order> sellOrders = new TreeMap<>(
        (a, b) -> {
            int priceCompare = a.price.compareTo(b.price); // Ascending
            if (priceCompare != 0) return priceCompare;
            int timeCompare = a.timestamp.compareTo(b.timestamp); // Ascending (oldest first)
            if (timeCompare != 0) return timeCompare;
            return a.orderId.compareTo(b.orderId); // For uniqueness
        }
    );
    
    /**
     * Add an order to the book.
     * Note: If order already exists (same ID), it will be replaced.
     */
    public void addOrder(Order order) {
        // Remove existing order with same ID if present
        removeOrder(order.getId());
        
        PriceTimeKey key = new PriceTimeKey(
            order.getLimitPrice() != null ? order.getLimitPrice() : BigDecimal.ZERO,
            order.getTimestamp(),
            order.getId()
        );
        
        if (order.getSide() == OrderSide.BUY) {
            buyOrders.put(key, order);
        } else {
            sellOrders.put(key, order);
        }
    }
    
    /**
     * Remove an order from the book.
     */
    public boolean removeOrder(UUID orderId) {
        return buyOrders.values().removeIf(o -> o.getId().equals(orderId)) ||
               sellOrders.values().removeIf(o -> o.getId().equals(orderId));
    }
    
    /**
     * Get the best buy order (highest price, oldest first).
     */
    public Order getBestBuy() {
        return buyOrders.isEmpty() ? null : buyOrders.firstEntry().getValue();
    }
    
    /**
     * Get the best sell order (lowest price, oldest first).
     */
    public Order getBestSell() {
        return sellOrders.isEmpty() ? null : sellOrders.firstEntry().getValue();
    }
    
    /**
     * Get all buy orders (for display/debugging).
     */
    public List<Order> getBuyOrders() {
        return new ArrayList<>(buyOrders.values());
    }
    
    /**
     * Get all sell orders (for display/debugging).
     */
    public List<Order> getSellOrders() {
        return new ArrayList<>(sellOrders.values());
    }
    
    /**
     * Key for sorting orders by price-time priority.
     * Includes order ID to ensure uniqueness.
     */
    private static class PriceTimeKey {
        final BigDecimal price;
        final java.time.Instant timestamp;
        final UUID orderId;
        
        PriceTimeKey(BigDecimal price, java.time.Instant timestamp, UUID orderId) {
            this.price = price;
            this.timestamp = timestamp;
            this.orderId = orderId;
        }
    }
}

