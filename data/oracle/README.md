# Oracle Data

This directory stores oracle observation files ingested from BOM (Bureau of Meteorology) and AEMO (energy dispatch) sources. The oracle ingestor reads these files and writes values to `OracleObservation`, then triggers resolve for LOCKED prediction markets.

## Week Definition (OracleBook Markets)

**No ambiguity**: OracleBook climate markets use a **Mon–Sun calendar week**.

- **Window**: Monday 00:00:00 through Sunday 23:59:59 (local / station timezone)
- **Matches seed**: Uses `getWeekEnding` from `src/data/bomStations.ts`
- **Example**: `--week-ending 2026-03-23` = week of Mon 17 Mar – Sun 23 Mar
- **BOM vs OracleBook**: BOM may use other windows (e.g. 9am–9am). We aggregate only days whose **date** falls in our Mon–Sun window.

---

## BOM (Bureau of Meteorology)

### Product IDs by State

| State | Product ID |
|-------|------------|
| NSW, ACT | IDN60801 |
| VIC | IDV60801 |
| QLD | IDQ60801 |
| WA | IDW60801 |
| SA | IDS60801 |
| TAS | IDT60801 |
| NT | IDD60801 |

### Station IDs (from seed)

| ID | Location |
|----|----------|
| 066062 | Sydney Observatory Hill |
| 086338 | Melbourne (Olympic Park) |
| 040842 | Brisbane Aero |
| 009021 | Perth Airport |
| 023034 | Adelaide Airport |
| 014015 | Darwin Airport |
| 094029 | Hobart (Ellerslie Road) |
| 070351 | Canberra Airport |

### Fetch Script

```bash
npx tsx scripts/fetch-bom.ts --station 066062 --week-ending 2026-03-23
```

Or via npm:

```bash
npm run fetch:bom -- --station 066062 --week-ending 2026-03-23
```

### Output Format

Files are written as `{indexId}.json`, e.g. `066062_weather_rainfall_2026-03-23.json`:

```json
{
  "indexId": "066062_weather_rainfall_2026-03-23",
  "stationId": "066062",
  "metric": "rainfall_mm",
  "value": 12.4,
  "collected_at": "2026-03-20T00:05:00+11:00"
}
```

### Weekly Aggregation

BOM provides daily data. For weekly markets we aggregate:

- **Rainfall**: sum
- **Max temperature**: max
- **Min temperature**: min
- **Solar exposure**: sum
- **Wind gust**: max

---

## AEMO (NEM Dispatch)

### NEM Regions

NSW1, QLD1, VIC1, SA1, TAS1

### 5-Minute RRP (single interval)

```bash
npx tsx scripts/fetch-dispatch-price.ts \
  --zip-url "https://www.nemweb.com.au/Reports/Current/Dispatch_Reports/PUBLIC_DISPATCH_202603041805_20260304180017_LEGACY.zip" \
  --region NSW1 \
  --interval "2026-03-04T18:00:00+11:00" \
  --market-id NSW_CAP_20260304_1800
```

### Daily Average RRP (agents can bet on this)

Creates one oracle file per region with the arithmetic mean of 288 five-minute RRPs for the day. Agents trade via `X-Agent-Key` on markets seeded with `npm run seed:markets` or `npm run seed:aemo-daily-rrp`.

```bash
# 1. Seed markets (seed:markets creates all; seed:aemo-daily-rrp is additive only)
npm run seed:markets

# 2. Fetch daily average (provide zip(s) covering the full day from Dispatch_Reports or Archive)
npx tsx scripts/fetch-daily-rrp.ts \
  --zip-url "https://..." \
  --date 2026-03-20

# 3. Lock the market(s) before/after event date, then oracle import
curl -X POST http://localhost:3000/api/admin/oracle/import \
  -H "Authorization: Bearer $FUTURO_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### SETTLEMENTDATE Format

AEMO uses `YYYY/MM/DD HH:MM:00` in NEM market time (AEDT/AEST). Dispatch intervals are 5 minutes.

---

## Oracle Import (Admin API)

After fetching, run ingestion to load files into the database:

```bash
curl -X POST http://localhost:3000/api/admin/oracle/import \
  -H "Authorization: Bearer $FUTURO_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Optional: pass a custom data directory:

```json
{ "dataDir": "/path/to/data/oracle" }
```
