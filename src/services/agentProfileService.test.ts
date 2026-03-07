import { Prisma } from '@prisma/client';
import {
  formatAdminProfile,
  formatAgentSelfProfile,
  formatAdminListItem,
} from './agentProfileService';
import type { AgentProfile, Account } from '@prisma/client';

const mockProfile = (overrides?: Partial<AgentProfile & { account: Account }>) =>
  ({
    id: 'ap-1',
    name: 'Test Agent',
    apiKeyHash: 'hash',
    apiKeyLookup: 'lookup',
    startingBalance: new Prisma.Decimal(10000),
    status: 'ACTIVE',
    trustTier: 'VERIFIED',
    accountId: 'acc-1',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-02T00:00:00Z'),
    notes: null,
    account: {
      id: 'acc-1',
      balance: new Prisma.Decimal(9500),
      isPaper: true,
      createdAt: new Date('2025-01-01T00:00:00Z'),
    },
    ...overrides,
  }) as AgentProfile & { account: Account };

describe('agentProfileService', () => {
  describe('formatAdminProfile', () => {
    it('formats profile with metrics and returns plain numbers/dates', () => {
      const profile = mockProfile();
      const payload = formatAdminProfile(profile, {
        lastDeployment: new Date('2025-01-03T12:00:00Z'),
        pnl24h: 50,
        exposure: 200,
        nextRefillEta: null,
      });
      expect(payload).toMatchObject({
        id: 'ap-1',
        name: 'Test Agent',
        accountId: 'acc-1',
        status: 'ACTIVE',
        trustTier: 'VERIFIED',
        startingBalance: 10000,
        notes: null,
        lastDeployment: '2025-01-03T12:00:00.000Z',
        pnl24h: 50,
        exposure: 200,
        nextRefillEta: null,
        deploymentCap: '1 order/sec per market',
      });
      expect(payload.account).toEqual({ balance: 9500, isPaper: true });
      expect(typeof payload.createdAt).toBe('string');
      expect(typeof payload.updatedAt).toBe('string');
    });
  });

  describe('formatAgentSelfProfile', () => {
    it('includes drawdown when balance < startingBalance', () => {
      const profile = mockProfile({
        startingBalance: new Prisma.Decimal(10000),
        account: { id: 'acc-1', balance: new Prisma.Decimal(8000), isPaper: true, createdAt: new Date() } as Account,
      });
      const payload = formatAgentSelfProfile(profile, { pnl24h: 0, nextRefillEta: null });
      expect(payload.drawdown).toBe(0.2);
      expect(payload.balance).toBe(8000);
      expect(payload.opsContact).toBeNull();
    });

    it('drawdown is null when balance >= startingBalance', () => {
      const profile = mockProfile({
        startingBalance: new Prisma.Decimal(10000),
        account: {
          ...mockProfile().account,
          balance: new Prisma.Decimal(10500),
        } as Account,
      });
      const payload = formatAgentSelfProfile(profile, { pnl24h: 0, nextRefillEta: null });
      expect(payload.drawdown).toBeNull();
    });
  });

  describe('formatAdminListItem', () => {
    it('formats list item with lastHeartbeat', () => {
      const profile = mockProfile();
      const payload = formatAdminListItem(profile, new Date('2025-01-03T12:00:00Z'));
      expect(payload).toMatchObject({
        id: 'ap-1',
        name: 'Test Agent',
        accountId: 'acc-1',
        status: 'ACTIVE',
        trustTier: 'VERIFIED',
        startingBalance: 10000,
        lastHeartbeat: '2025-01-03T12:00:00.000Z',
        deploymentCap: '1 order/sec per market',
      });
    });

    it('lastHeartbeat is null when no activity', () => {
      const profile = mockProfile();
      const payload = formatAdminListItem(profile, null);
      expect(payload.lastHeartbeat).toBeNull();
    });
  });
});
