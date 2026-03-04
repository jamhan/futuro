package com.futuro.exchange.api.dto;

import com.futuro.exchange.domain.OrderSide;
import com.futuro.exchange.domain.OrderType;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import lombok.Data;

import java.math.BigDecimal;

/**
 * Request DTO for submitting an order.
 */
@Data
public class SubmitOrderRequest {
    @NotNull
    private String accountId;
    
    @NotNull
    private OrderType type;
    
    @NotNull
    private OrderSide side;
    
    @NotNull
    @Positive
    private BigDecimal quantity;
    
    // Required for LIMIT orders, optional for MARKET orders
    private BigDecimal limitPrice;
}


