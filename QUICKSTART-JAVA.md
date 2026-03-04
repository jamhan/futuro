# Quick Start Guide - Java Exchange

## Prerequisites

- Java 21 or higher
- Gradle 8.5+ (or use the Gradle wrapper)

## Building

```bash
./gradlew build
```

If you don't have the Gradle wrapper, install Gradle and run:
```bash
gradle wrapper
```

## Running

```bash
./gradlew bootRun
```

The exchange will start on `http://localhost:8080`

## Quick Test

1. **Create two accounts**:
```bash
curl -X POST http://localhost:8080/api/accounts \
  -H "Content-Type: application/json" \
  -d '{"id":"account-1","cashBalance":10000}'

curl -X POST http://localhost:8080/api/accounts \
  -H "Content-Type: application/json" \
  -d '{"id":"account-2","cashBalance":10000}'
```

2. **Set initial index value (100mm)**:
```bash
curl -X POST http://localhost:8080/api/admin/index/override \
  -H "Content-Type: application/json" \
  -d '{"totalRainfallMm":100.0}'
```

3. **Account 1 buys 10 contracts at 95mm**:
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

4. **Account 2 sells 10 contracts at 95mm (matches!)**:
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
curl http://localhost:8080/api/positions/account-2
```

You should see:
- Account 1: long 10 contracts
- Account 2: short 10 contracts

6. **Update index to 105mm** (price increased):
```bash
curl -X POST http://localhost:8080/api/admin/index/override \
  -H "Content-Type: application/json" \
  -d '{"totalRainfallMm":105.0}'
```

7. **Check positions again** (PnL updated):
```bash
curl http://localhost:8080/api/positions/account-1
curl http://localhost:8080/api/positions/account-2
```

Account 1 should show unrealized profit of 100 (10 contracts × (105-95))
Account 2 should show unrealized loss of -100

8. **Final settlement**:
```bash
curl -X POST http://localhost:8080/api/admin/settle
```

9. **Verify final positions** (should be flat):
```bash
curl http://localhost:8080/api/positions/account-1
curl http://localhost:8080/api/positions/account-2
```

Both positions should be flat (quantity = 0) with realized PnL.

## Running Tests

```bash
./gradlew test
```

The integration test (`ExchangeIntegrationTest`) simulates the above workflow automatically.

## Event Log

Events are stored in `chronicle-data/events/`. This is an append-only log that can be replayed to rebuild all state.

## Architecture Notes

- **Event Sourcing**: All state changes originate from events
- **Deterministic Matching**: Price-time priority matching engine
- **Risk Management**: Pre-trade checks for order size, position limits, margin
- **Clearing**: Automatic position tracking and PnL calculation
- **Settlement**: Final cash settlement at contract expiry

## Next Steps

- Review `README-JAVA.md` for full API documentation
- Check `src/test/java/com/futuro/exchange/ExchangeIntegrationTest.java` for example usage
- Explore the event log in `chronicle-data/events/`

