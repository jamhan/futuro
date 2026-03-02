# Futuro Exchange

A minimum viable product for a peer-to-peer weather prediction exchange. This is **not** a sportsbook—it behaves like a real stock exchange with an order book, matching engine, and deterministic settlement.

## Architecture Overview

### Core Principles

1. **Correctness and Determinism**: The matching engine is pure and deterministic, fully unit-tested
2. **Reliability and Auditability**: All trades and settlements are recorded immutably
3. **Clear Domain Modeling**: Explicit types for Market, Order, Trade, Outcome, OracleResult, Account
4. **Simple but Extensible**: Clean separation of concerns, easy to extend
5. **Minimal UI**: Functional interface for order placement and order book viewing

### Domain Model

- **Market**: Binary outcome contract (e.g., "Will NYC rainfall on 2026-01-15 be ≥ 5mm?")
- **Order**: Trading intent (Limit or Market, buying YES or NO)
- **Trade**: Matched order pair with price and quantity
- **Outcome**: YES or NO (determined by oracle)
- **OracleResult**: Immutable resolution of a market
- **Account**: User balance and positions

### Market Lifecycle

```
DRAFT → OPEN → LOCKED → RESOLVED → SETTLED
```

- **DRAFT**: Market created but not yet open
- **OPEN**: Active trading allowed
- **LOCKED**: Trading stopped, awaiting resolution
- **RESOLVED**: Outcome determined by oracle
- **SETTLED**: All positions settled

### Matching Engine

- **Price-time priority**: Orders matched by best price first, then oldest first
- **Binary market matching**: BUY_YES orders match with BUY_NO orders
- **Pure function**: No side effects, fully deterministic, unit-tested
- **Separate from persistence**: Matching logic is independent of database

### Settlement

- **Winning outcome**: Pays 1.00 per share
- **Losing outcome**: Pays 0.00 per share
- **Idempotent**: Can be run multiple times safely
- **Zero-sum**: All balances reconcile correctly

## Tech Stack

- **Backend**: TypeScript, Node.js, Express
- **Database**: PostgreSQL with Prisma ORM
- **Decimal arithmetic**: `decimal.js` (no floating point bugs)
- **Validation**: Zod for API input validation
- **Frontend**: Vanilla JavaScript (minimal, functional UI)

## Setup

### Prerequisites

- Node.js 18+
- PostgreSQL 12+

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env and set DATABASE_URL
   ```

4. Generate Prisma client:
   ```bash
   npm run prisma:generate
   ```

5. Run migrations:
   ```bash
   npm run prisma:migrate
   ```

6. Seed the database:
   ```bash
   npm run prisma:seed
   ```

### Running

Start the development server:
```bash
npm run dev
```

The API will be available at `http://localhost:3000/api`
The UI will be available at `http://localhost:3000`

## API Endpoints

### Markets

- `GET /api/markets` - List all markets
- `GET /api/markets/:id` - Get market details
- `POST /api/markets` - Create a new market
- `POST /api/markets/:id/open` - Open market for trading
- `POST /api/markets/:id/lock` - Lock market (stop trading)
- `POST /api/markets/:id/resolve` - Resolve market using oracle

### Orders

- `GET /api/markets/:marketId/orders` - List orders for a market
- `POST /api/orders` - Place an order
- `DELETE /api/orders/:id?accountId=...` - Cancel an order

### Trades

- `GET /api/markets/:marketId/trades` - List recent trades

### Accounts

- `GET /api/accounts/:id` - Get account details
- `POST /api/accounts` - Create a new account

## Usage Example

1. **Create an account**:
   ```bash
   curl -X POST http://localhost:3000/api/accounts \
     -H "Content-Type: application/json" \
     -d '{"balance": 1000}'
   ```

2. **Place a limit order** (buying YES at 0.6):
   ```bash
   curl -X POST http://localhost:3000/api/orders \
     -H "Content-Type: application/json" \
     -d '{
       "marketId": "market-id-here",
       "accountId": "account-id-here",
       "side": "BUY_YES",
       "type": "LIMIT",
       "price": 0.6,
       "quantity": 10
     }'
   ```

3. **View order book**:
   ```bash
   curl http://localhost:3000/api/markets/:marketId/orders
   ```

4. **Resolve market** (after locking):
   ```bash
   curl -X POST http://localhost:3000/api/markets/:id/resolve
   ```

## Testing

Run unit tests:
```bash
npm test
```

The matching engine has comprehensive unit tests covering:
- Price-time priority matching
- Partial fills
- Market orders
- Order book sorting

## Architecture Decisions

### Why Decimal.js?

Floating point arithmetic is unreliable for financial calculations. `decimal.js` provides exact decimal arithmetic, preventing rounding errors that could lead to incorrect settlements.

### Why Separate Matching Engine?

The matching engine is a pure function with no database dependencies. This makes it:
- Easy to test
- Deterministic
- Possible to run in different contexts (e.g., simulation, backtesting)

### Why Binary Markets Only?

Binary markets are the simplest case and demonstrate the core exchange mechanics. Extending to multi-outcome markets would require more complex matching logic but follows the same principles.

### Why Mock Oracle?

The oracle interface is abstracted, allowing easy swapping of implementations. The mock oracle provides deterministic values for development and testing. In production, this would connect to NOAA API or similar.

### Tradeoffs

- **No real-time updates**: The UI polls the API. For production, WebSockets would be needed.
- **Simplified position tracking**: Positions are updated on each trade. A more sophisticated system would track cost basis.
- **No margin/leverage**: Accounts must have sufficient balance for each trade.
- **Single market focus**: The UI shows one market at a time.

## Future Extensions

- WebSocket support for real-time order book updates
- Multi-outcome markets (not just binary)
- Advanced order types (stop-loss, iceberg, etc.)
- Position cost basis tracking
- Margin trading
- Historical data and analytics
- Integration with real weather APIs (NOAA, OpenWeatherMap)

## License

MIT

# futuro
