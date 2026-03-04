import Decimal from 'decimal.js';
import { SettlementService } from './settlement';
import { Outcome, MarketType } from '../domain/types';
import { Position } from '../domain/account';

describe('SettlementService', () => {
  const service = new SettlementService();

  describe('calculateBinaryPayout', () => {
    it('pays yesShares when outcome is YES', () => {
      const pos: Position = {
        accountId: 'a1',
        marketId: 'm1',
        yesShares: new Decimal(10),
        noShares: new Decimal(0),
        quantity: null,
      };
      expect(service.calculateBinaryPayout(pos, Outcome.YES).toNumber()).toBe(10);
    });

    it('pays noShares when outcome is NO', () => {
      const pos: Position = {
        accountId: 'a1',
        marketId: 'm1',
        yesShares: new Decimal(0),
        noShares: new Decimal(5),
        quantity: null,
      };
      expect(service.calculateBinaryPayout(pos, Outcome.NO).toNumber()).toBe(5);
    });
  });

  describe('calculateFuturesPayout', () => {
    it('credits long position (positive quantity) at index value', () => {
      const pos: Position = {
        accountId: 'a1',
        marketId: 'm1',
        yesShares: new Decimal(0),
        noShares: new Decimal(0),
        quantity: new Decimal(10),
      };
      const payout = service.calculateFuturesPayout(pos, new Decimal(25.5));
      expect(payout.toNumber()).toBe(255);
    });

    it('debits short position (negative quantity) at index value', () => {
      const pos: Position = {
        accountId: 'a1',
        marketId: 'm1',
        yesShares: new Decimal(0),
        noShares: new Decimal(0),
        quantity: new Decimal(-10),
      };
      const payout = service.calculateFuturesPayout(pos, new Decimal(25.5));
      expect(payout.toNumber()).toBe(-255);
    });

    it('treats null quantity as zero', () => {
      const pos: Position = {
        accountId: 'a1',
        marketId: 'm1',
        yesShares: new Decimal(0),
        noShares: new Decimal(0),
        quantity: null,
      };
      expect(service.calculateFuturesPayout(pos, new Decimal(100)).toNumber()).toBe(0);
    });
  });

  describe('calculateSettlements (futures)', () => {
    it('is zero-sum across positions for futures', () => {
      const positions: Position[] = [
        { accountId: 'a1', marketId: 'm1', yesShares: new Decimal(0), noShares: new Decimal(0), quantity: new Decimal(10) },
        { accountId: 'a2', marketId: 'm1', yesShares: new Decimal(0), noShares: new Decimal(0), quantity: new Decimal(-10) },
      ];
      const indexValue = new Decimal(30);
      const settlements = service.calculateSettlements(
        positions,
        Outcome.YES,
        { marketType: MarketType.FUTURES, indexValue }
      );
      expect(settlements.get('a1')?.toNumber()).toBe(300);
      expect(settlements.get('a2')?.toNumber()).toBe(-300);
      const total = Array.from(settlements.values()).reduce((s, d) => s.plus(d), new Decimal(0));
      expect(total.toNumber()).toBe(0);
    });
  });

  describe('calculateSettlements', () => {
    it('returns empty map for no positions', () => {
      const settlements = service.calculateSettlements(
        [],
        Outcome.YES,
        { marketType: MarketType.FUTURES, indexValue: new Decimal(10) }
      );
      expect(settlements.size).toBe(0);
    });
  });

  describe('applySettlements', () => {
    it('adds payout to existing balance', () => {
      const settlements = new Map<string, Decimal>([
        ['a1', new Decimal(100)],
        ['a2', new Decimal(-50)],
      ]);
      const balances = new Map<string, Decimal>([
        ['a1', new Decimal(1000)],
        ['a2', new Decimal(500)],
      ]);
      const newBalances = service.applySettlements(settlements, balances);
      expect(newBalances.get('a1')?.toNumber()).toBe(1100);
      expect(newBalances.get('a2')?.toNumber()).toBe(450);
    });

    it('treats missing account balance as zero', () => {
      const settlements = new Map<string, Decimal>([['a1', new Decimal(50)]]);
      const balances = new Map<string, Decimal>([]);
      const newBalances = service.applySettlements(settlements, balances);
      expect(newBalances.get('a1')?.toNumber()).toBe(50);
    });
  });
});
