# Futuro Rainfall Futures Exchange

A regulated-style derivatives exchange MVP for cash-settled linear rainfall futures.

## Architecture

This is an event-sourced exchange system built with:
- **Java 21** with Spring Boot
- **Chronicle Queue** for append-only event log
- **Central Limit Order Book** with price-time priority matching
- **Event sourcing** - all state mutations originate from events
- **Full replayability** from event log

### Core Components

1. **Matching Engine**: Central Limit Order Book with price-time priority
2. **Risk Engine**: Pre-trade checks (max order size, max position, initial margin)
3. **Clearing Engine**: Position tracking, PnL calculation, variation margin
4. **Weather Index Engine**: BoM CSV ingestion, monthly rainfall calculation
5. **Settlement Engine**: Final settlement at contract expiry
6. **Event Bus**: Chronicle Queue-based event log

### Instrument Definition

- **Product**: Linear rainfall futures
- **Underlying**: Monthly total rainfall (mm)
- **Data Source**: Bureau of Meteorology CSV
- **Settlement**: Cash
- **Payoff**: contract_size × total_rainfall_mm
- **Contract**: One station (Sydney Observatory Hill), one maturity (January 2026)

## Building

```bash
./gradlew build
```

## Running

```bash
./gradlew bootRun
```

The API will be available at `http://localhost:8080`

## API Endpoints

### Orders

- `POST /api/orders` - Submit an order
  ```json
  {
    "accountId": "account-1",
    "type": "LIMIT",
    "side": "BUY",
    "quantity": 10,
    "limitPrice": 95.0
  }
  ```

- `DELETE /api/orders/{orderId}?accountId=account-1` - Cancel an order

### Positions

- `GET /api/positions/{accountId}` - Get position for an account

### Balances

- `GET /api/balances/{accountId}` - Get account balance

### Accounts

- `POST /api/accounts` - Create account with initial cash
  ```json
  {
    "id": "account-1",
    "cashBalance": 10000
  }
  ```

- `GET /api/accounts/{accountId}` - Get account

### Admin

- `POST /api/admin/settle` - Trigger final settlement
- `POST /api/admin/index/override` - Manually override index value
  ```json
  {
    "totalRainfallMm": 150.5
  }
  ```
- `POST /api/admin/index/ingest` - Ingest BoM CSV file
  ```json
  {
    "csvPath": "/path/to/rainfall.csv"
  }
  ```

## Testing

Run integration tests:

```bash
./gradlew test
```

The integration test simulates two participants trading rainfall futures:
1. Account 1 buys 10 contracts at 95mm
2. Account 2 sells 10 contracts at 95mm (matches)
3. Index value updates to 105mm
4. Verify PnL calculations
5. Final settlement at 105mm
6. Verify positions are flat and PnL is realized

## Event Sourcing

All state mutations originate from events:
- `ORDER_ACCEPTED` - Order accepted into order book
- `ORDER_REJECTED` - Order rejected by risk engine
- `TRADE` - Trade occurred (orders matched)
- `ORDER_CANCELLED` - Order cancelled
- `INDEX_VALUE_UPDATED` - Weather index value updated
- `SETTLEMENT` - Final settlement at expiry

Events are stored in Chronicle Queue at `chronicle-data/events/`.

To replay events:

```java
eventBus.replayAll(event -> {
    // Process event
});
```

## Risk Limits (Hard-coded for MVP)

- Max order size: 1000 contracts
- Max position: 5000 contracts
- Initial margin: 100 per contract

## Example Workflow

1. **Create accounts**:
   ```bash
   curl -X POST http://localhost:8080/api/accounts \
     -H "Content-Type: application/json" \
     -d '{"id":"account-1","cashBalance":10000}'
   ```

2. **Set initial index value**:
   ```bash
   curl -X POST http://localhost:8080/api/admin/index/override \
     -H "Content-Type: application/json" \
     -d '{"totalRainfallMm":100.0}'
   ```

3. **Submit buy order**:
   ```bash
   curl -X POST http://localhost:8080/api/orders \
     -H "Content-Type: application/json" \
     -d '{
       "accountId":"account-1",
       "type":"LIMIT",
       "side":"BUY",
       "quantity":10,
       "limitPrice":95.0
     }'
   ```

4. **Submit sell order** (matches):
   ```bash
   curl -X POST http://localhost:8080/api/orders \
     -H "Content-Type: application/json" \
     -d '{
       "accountId":"account-2",
       "type":"LIMIT",
       "side":"SELL",
       "quantity":10,
       "limitPrice":95.0
     }'
   ```

5. **Check positions**:
   ```bash
   curl http://localhost:8080/api/positions/account-1
   ```

6. **Update index value**:
   ```bash
   curl -X POST http://localhost:8080/api/admin/index/override \
     -H "Content-Type: application/json" \
     -d '{"totalRainfallMm":105.0}'
   ```

7. **Final settlement**:
   ```bash
   curl -X POST http://localhost:8080/api/admin/settle
   ```

## Notes

- This is an MVP - production system would need:
  - Authentication and authorization
  - Database persistence (currently in-memory)
  - WebSocket support for real-time updates
  - More sophisticated risk management
  - Multiple contracts and stations
  - Historical data and analytics

- The matching engine is a basic implementation. For production, consider using a proven matching engine library or implementing more sophisticated order types.

- Chronicle Queue provides durable, append-only event storage. Events can be replayed to rebuild state.


