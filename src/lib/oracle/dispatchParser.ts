/**
 * Parse AEMO NEMWeb PUBLIC_DISPATCH CSV.
 * Extracts RRP (Regional Reference Price) for a given REGIONID and SETTLEMENTDATE.
 */

/** Row from PUBLIC_DISPATCH CSV */
export interface DispatchRow {
  SETTLEMENTDATE: string;
  REGIONID: string;
  RRP?: string | number;
  [key: string]: unknown;
}

/**
 * Parse NEMWeb dispatch CSV content.
 * Format: row 0 = table type, row 1 = column names, row 2+ = data.
 * Returns array of row objects keyed by column name.
 */
export function parseDispatchCsv(csv: string): DispatchRow[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headerLine = lines[1];
  const headers = parseCsvLine(headerLine);
  const rows: DispatchRow[] = [];

  for (let i = 2; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? '';
    }
    rows.push(row as DispatchRow);
  }

  return rows;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Extract price for a region and settlement date/interval.
 * SETTLEMENTDATE format: "YYYY/MM/DD HH:MM:00" (NEM market time, 24h).
 * intervalTarget: ISO string or partial match for the 5-min interval.
 */
export function extractPriceForInterval(
  rows: DispatchRow[],
  regionId: string,
  intervalTarget: string
): number | null {
  for (const row of rows) {
    if (row.REGIONID !== regionId) continue;
    const sd = row.SETTLEMENTDATE;
    if (!sd) continue;
    if (!matchesInterval(sd, intervalTarget)) continue;

    const rrp = row.RRP;
    if (rrp == null || rrp === '' || rrp === '-') continue;
    const n = typeof rrp === 'number' ? rrp : parseFloat(String(rrp));
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

/**
 * Check if SETTLEMENTDATE matches target interval.
 * NEM uses "YYYY/MM/DD HH:MM:00" (5-min intervals). Target may be ISO "YYYY-MM-DDTHH:MM:00+11:00".
 */
function matchesInterval(settlementDate: string, target: string): boolean {
  const sdNorm = settlementDate.replace(/\//g, '-').replace(' ', 'T').slice(0, 16);
  const targetNorm = target.replace(/\+.*$/, '').slice(0, 16);
  return sdNorm === targetNorm || sdNorm.startsWith(targetNorm);
}

/**
 * Extract daily average RRP for a region and date.
 * Averages all 288 five-minute RRP values for that calendar day (NEM market time).
 * dateTarget: "YYYY-MM-DD" or ISO string; we match rows whose SETTLEMENTDATE falls on that day.
 */
export function extractDailyAverageRRP(
  rows: DispatchRow[],
  regionId: string,
  dateTarget: string
): number | null {
  const dateStr = dateTarget.slice(0, 10).replace(/-/g, '');
  const sum = { total: 0, count: 0 };
  for (const row of rows) {
    if (row.REGIONID !== regionId) continue;
    const sd = row.SETTLEMENTDATE;
    if (!sd) continue;
    const rowDate = sd.replace(/\//g, '-').slice(0, 10).replace(/-/g, '');
    if (rowDate !== dateStr) continue;

    const rrp = row.RRP;
    if (rrp == null || rrp === '' || rrp === '-') continue;
    const n = typeof rrp === 'number' ? rrp : parseFloat(String(rrp));
    if (!Number.isNaN(n)) {
      sum.total += n;
      sum.count++;
    }
  }
  if (sum.count === 0) return null;
  return sum.total / sum.count;
}
