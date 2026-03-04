package com.futuro.exchange;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Main entry point for the Futuro Rainfall Futures Exchange.
 * 
 * This is a regulated-style derivatives exchange MVP for cash-settled
 * linear rainfall futures.
 */
@SpringBootApplication
public class ExchangeApplication {
    public static void main(String[] args) {
        SpringApplication.run(ExchangeApplication.class, args);
    }
}


