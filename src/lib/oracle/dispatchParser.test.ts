import { parseDispatchCsv, extractPriceForInterval, extractDailyAverageRRP } from './dispatchParser';

describe('dispatchParser', () => {
  const sampleCsv = `DISPATCHREGIONSUM
"SETTLEMENTDATE","REGIONID","RRP"
"2026/03/04 18:00:00","NSW1","45.23"
"2026/03/04 18:00:00","QLD1","38.50"
"2026/03/04 18:05:00","NSW1","52.10"
"2026/03/04 18:05:00","QLD1","41.00"`;

  describe('parseDispatchCsv', () => {
    it('parses header and data rows', () => {
      const rows = parseDispatchCsv(sampleCsv);
      expect(rows).toHaveLength(4);
      expect(rows[0].SETTLEMENTDATE).toBe('2026/03/04 18:00:00');
      expect(rows[0].REGIONID).toBe('NSW1');
      expect(rows[0].RRP).toBe('45.23');
    });

    it('returns empty array for empty CSV', () => {
      expect(parseDispatchCsv('')).toEqual([]);
      expect(parseDispatchCsv('DISPATCHREGIONSUM\nI,"SETTLEMENTDATE"')).toEqual([]);
    });
  });

  describe('extractPriceForInterval', () => {
    const rows = parseDispatchCsv(sampleCsv);

    it('extracts price for matching region and interval', () => {
      const price = extractPriceForInterval(
        rows,
        'NSW1',
        '2026-03-04T18:00:00+11:00'
      );
      expect(price).toBe(45.23);
    });

    it('extracts price for 18:05 interval', () => {
      const price = extractPriceForInterval(
        rows,
        'NSW1',
        '2026-03-04T18:05:00'
      );
      expect(price).toBe(52.10);
    });

    it('returns null when no match', () => {
      const price = extractPriceForInterval(
        rows,
        'VIC1',
        '2026-03-04T18:00:00'
      );
      expect(price).toBeNull();
    });

    it('returns null for wrong region', () => {
      const price = extractPriceForInterval(
        rows,
        'NSW1',
        '2026-03-04T19:00:00'
      );
      expect(price).toBeNull();
    });
  });

  describe('extractDailyAverageRRP', () => {
    const dailyCsv = `DISPATCHREGIONSUM
"SETTLEMENTDATE","REGIONID","RRP"
"2026/03/04 00:00:00","NSW1","40"
"2026/03/04 00:05:00","NSW1","50"
"2026/03/04 00:10:00","NSW1","60"`;
    const rows = parseDispatchCsv(dailyCsv);

    it('averages RRP for matching region and date', () => {
      const avg = extractDailyAverageRRP(rows, 'NSW1', '2026-03-04');
      expect(avg).toBe(50); // (40+50+60)/3
    });

    it('returns null for wrong region', () => {
      expect(extractDailyAverageRRP(rows, 'VIC1', '2026-03-04')).toBeNull();
    });

    it('returns null for wrong date', () => {
      expect(extractDailyAverageRRP(rows, 'NSW1', '2026-03-05')).toBeNull();
    });
  });
});
