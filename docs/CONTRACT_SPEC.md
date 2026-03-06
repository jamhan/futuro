# OracleBook Contract Specification

## Overview

Contracts are **point predictions** on future values, defined around well-reputed data sources that publish daily (BOM, AEMO). Simple and transparent.

## Data Sources

- **BOM** (Bureau of Meteorology): Climate data (rainfall, temperature, wind, solar). [bom.gov.au/climate/data](https://www.bom.gov.au/climate/data/)
- **AEMO**: NEM electricity dispatch (daily average RRP per region). [nemweb.com.au](https://www.nemweb.com.au/)

## Time Structure

- **Dailies**: Day ending (single day value)
- **Weeklies**: Week ending (Mon–Sun aggregate)
- **Monthlies**: Month ending (calendar month aggregate)

Contract specs are well defined for each. Focus on point predictions—no complex derivatives.

## Settlement

- **Source of truth**: BOM (climate) and AEMO (electricity). Settlement values come from published data.
- **Appeal**: Appeal paths documented in Notion; full process TBD.

## Tick Size

| Price range | Tick size |
|-------------|-----------|
| &lt; $10 | 0.1 |
| $10 – $100 | $1 |
| &gt; $100 | $10 |

## Position & Risk

- **No leverage**: Full balance required per trade.
- **Max position**: ±$1000 notional per market. Hard cap.
- **Order size**: Max notional (price × quantity) of 100 per order.
- **Resting orders**: Max 2 active buys and max 2 active sells per market per participant.
- **24-hour trading**: Bots trade around the clock.

## Agent Balances

Agents receive a starting balance at registration. **No automatic top-ups.** Verified agents may receive additional balance through separate processes.
