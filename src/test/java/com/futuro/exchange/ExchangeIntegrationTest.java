package com.futuro.exchange;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.futuro.exchange.api.dto.SubmitOrderRequest;
import com.futuro.exchange.clearing.ClearingEngine;
import com.futuro.exchange.domain.Account;
import com.futuro.exchange.domain.OrderSide;
import com.futuro.exchange.domain.OrderType;
import com.futuro.exchange.domain.Position;
import com.futuro.exchange.index.WeatherIndexEngine;
import com.futuro.exchange.settlement.SettlementEngine;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureWebMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Integration test simulating two participants trading rainfall futures.
 * 
 * This test:
 * - Sets up two accounts with initial balances
 * - Submits orders from both participants
 * - Verifies trades occur
 * - Checks positions and PnL
 * - Tests final settlement
 */
@SpringBootTest
@AutoConfigureWebMvc
public class ExchangeIntegrationTest {
    @Autowired
    private WebApplicationContext webApplicationContext;
    
    @Autowired
    private ClearingEngine clearingEngine;
    
    @Autowired
    private WeatherIndexEngine indexEngine;
    
    @Autowired
    private SettlementEngine settlementEngine;
    
    private MockMvc mockMvc;
    private ObjectMapper objectMapper;
    
    private static final String ACCOUNT_1 = "account-1";
    private static final String ACCOUNT_2 = "account-2";
    
    @BeforeEach
    public void setup() throws Exception {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext).build();
        objectMapper = new ObjectMapper();
        
        // Initialize accounts with cash
        createAccount(ACCOUNT_1, new BigDecimal("10000"));
        createAccount(ACCOUNT_2, new BigDecimal("10000"));
    }
    
    private void createAccount(String accountId, BigDecimal cashBalance) throws Exception {
        String requestBody = String.format(
            "{\"id\":\"%s\",\"cashBalance\":%s}",
            accountId, cashBalance
        );
        
        mockMvc.perform(post("/api/accounts")
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody))
                .andExpect(status().isOk());
    }
    
    @Test
    public void testTwoParticipantsTrading() throws Exception {
        // Step 1: Set initial index value (simulate current rainfall)
        indexEngine.setManualOverride(new BigDecimal("100.0")); // 100mm
        
        // Step 2: Account 1 buys 10 contracts at 95mm
        SubmitOrderRequest buyOrder = new SubmitOrderRequest();
        buyOrder.setAccountId(ACCOUNT_1);
        buyOrder.setType(OrderType.LIMIT);
        buyOrder.setSide(OrderSide.BUY);
        buyOrder.setQuantity(new BigDecimal("10"));
        buyOrder.setLimitPrice(new BigDecimal("95.0"));
        
        mockMvc.perform(post("/api/orders")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(buyOrder)))
                .andExpect(status().isOk());
        
        // Step 3: Account 2 sells 10 contracts at 95mm (matches)
        SubmitOrderRequest sellOrder = new SubmitOrderRequest();
        sellOrder.setAccountId(ACCOUNT_2);
        sellOrder.setType(OrderType.LIMIT);
        sellOrder.setSide(OrderSide.SELL);
        sellOrder.setQuantity(new BigDecimal("10"));
        sellOrder.setLimitPrice(new BigDecimal("95.0"));
        
        mockMvc.perform(post("/api/orders")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(sellOrder)))
                .andExpect(status().isOk());
        
        // Step 4: Verify positions
        Position pos1 = clearingEngine.getPosition(ACCOUNT_1);
        assertNotNull(pos1);
        assertEquals(0, pos1.getQuantity().compareTo(new BigDecimal("10")), "Account 1 should be long 10");
        
        Position pos2 = clearingEngine.getPosition(ACCOUNT_2);
        assertNotNull(pos2);
        assertEquals(0, pos2.getQuantity().compareTo(new BigDecimal("-10")), "Account 2 should be short 10");
        
        // Step 5: Update index value to 105mm (price increased)
        indexEngine.setManualOverride(new BigDecimal("105.0"));
        
        // Step 6: Verify PnL
        // Account 1 (long): profit = 10 * (105 - 95) = 100
        pos1 = clearingEngine.getPosition(ACCOUNT_1);
        assertTrue(pos1.getUnrealizedPnL().compareTo(new BigDecimal("100")) >= 0, 
            "Account 1 should have unrealized profit");
        
        // Account 2 (short): loss = 10 * (95 - 105) = -100
        pos2 = clearingEngine.getPosition(ACCOUNT_2);
        assertTrue(pos2.getUnrealizedPnL().compareTo(new BigDecimal("-100")) <= 0,
            "Account 2 should have unrealized loss");
        
        // Step 7: Final settlement at 105mm
        settlementEngine.settle();
        
        // Step 8: Verify final positions are flat
        pos1 = clearingEngine.getPosition(ACCOUNT_1);
        pos2 = clearingEngine.getPosition(ACCOUNT_2);
        
        assertEquals(0, pos1.getQuantity().compareTo(BigDecimal.ZERO), 
            "Account 1 position should be flat after settlement");
        assertEquals(0, pos2.getQuantity().compareTo(BigDecimal.ZERO),
            "Account 2 position should be flat after settlement");
        
        // Step 9: Verify realized PnL
        assertTrue(pos1.getRealizedPnL().compareTo(new BigDecimal("100")) >= 0,
            "Account 1 should have realized profit of 100");
        assertTrue(pos2.getRealizedPnL().compareTo(new BigDecimal("-100")) <= 0,
            "Account 2 should have realized loss of 100");
    }
    
    @Test
    public void testRiskLimits() throws Exception {
        // Test max order size
        SubmitOrderRequest largeOrder = new SubmitOrderRequest();
        largeOrder.setAccountId(ACCOUNT_1);
        largeOrder.setType(OrderType.LIMIT);
        largeOrder.setSide(OrderSide.BUY);
        largeOrder.setQuantity(new BigDecimal("2000")); // Exceeds max of 1000
        largeOrder.setLimitPrice(new BigDecimal("100.0"));
        
        mockMvc.perform(post("/api/orders")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(largeOrder)))
                .andExpect(status().isForbidden())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("exceeds maximum")));
    }
}

