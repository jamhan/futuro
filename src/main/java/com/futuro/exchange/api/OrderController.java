package com.futuro.exchange.api;

import com.futuro.exchange.api.dto.OrderResponse;
import com.futuro.exchange.api.dto.SubmitOrderRequest;
import com.futuro.exchange.domain.Order;
import com.futuro.exchange.domain.OrderStatus;
import com.futuro.exchange.domain.OrderType;
import com.futuro.exchange.events.OrderRejectedEvent;
import com.futuro.exchange.matching.MatchingEngineAdapter;
import com.futuro.exchange.risk.RiskEngine;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import jakarta.validation.Valid;
import java.time.Instant;
import java.util.UUID;

/**
 * REST API for order management.
 */
@RestController
@RequestMapping("/api/orders")
public class OrderController {
    private final MatchingEngineAdapter matchingEngine;
    private final RiskEngine riskEngine;
    
    public OrderController(MatchingEngineAdapter matchingEngine, RiskEngine riskEngine) {
        this.matchingEngine = matchingEngine;
        this.riskEngine = riskEngine;
    }
    
    /**
     * Submit an order.
     * 
     * POST /api/orders
     */
    @PostMapping
    public ResponseEntity<?> submitOrder(@Valid @RequestBody SubmitOrderRequest request) {
        // Create order
        Order order = Order.builder()
            .id(UUID.randomUUID())
            .accountId(request.getAccountId())
            .type(request.getType())
            .side(request.getSide())
            .quantity(request.getQuantity())
            .limitPrice(request.getLimitPrice())
            .timestamp(Instant.now())
            .status(OrderStatus.PENDING)
            .filledQuantity(java.math.BigDecimal.ZERO)
            .build();
        
        // Validate limit price for limit orders
        if (order.getType() == OrderType.LIMIT && order.getLimitPrice() == null) {
            return ResponseEntity.badRequest()
                .body("Limit price is required for LIMIT orders");
        }
        
        // Pre-trade risk check
        RiskEngine.RiskCheckResult riskCheck = riskEngine.validateOrder(order);
        if (!riskCheck.isPassed()) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body("Order rejected: " + riskCheck.getRejectionReason());
        }
        
        // Submit to matching engine
        boolean accepted = matchingEngine.submitOrder(order);
        
        if (accepted) {
            return ResponseEntity.ok(toOrderResponse(order));
        } else {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body("Order submission failed");
        }
    }
    
    /**
     * Cancel an order.
     * 
     * DELETE /api/orders/{orderId}?accountId=...
     */
    @DeleteMapping("/{orderId}")
    public ResponseEntity<?> cancelOrder(
            @PathVariable UUID orderId,
            @RequestParam String accountId) {
        boolean cancelled = matchingEngine.cancelOrder(orderId, accountId);
        
        if (cancelled) {
            return ResponseEntity.ok().build();
        } else {
            return ResponseEntity.notFound().build();
        }
    }
    
    private OrderResponse toOrderResponse(Order order) {
        return OrderResponse.builder()
            .id(order.getId())
            .accountId(order.getAccountId())
            .type(order.getType().name())
            .side(order.getSide().name())
            .quantity(order.getQuantity())
            .limitPrice(order.getLimitPrice())
            .timestamp(order.getTimestamp())
            .status(order.getStatus())
            .filledQuantity(order.getFilledQuantity())
            .build();
    }
}


