package com.futuro.exchange.api.dto;

import com.futuro.exchange.domain.Order;
import com.futuro.exchange.domain.OrderStatus;
import lombok.Builder;
import lombok.Data;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Response DTO for order information.
 */
@Data
@Builder
public class OrderResponse {
    private UUID id;
    private String accountId;
    private String type;
    private String side;
    private BigDecimal quantity;
    private BigDecimal limitPrice;
    private Instant timestamp;
    private OrderStatus status;
    private BigDecimal filledQuantity;
}


