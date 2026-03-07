import {
  getDeploymentCapDescription,
} from './leaderboardService';

describe('leaderboardService', () => {
  describe('getDeploymentCapDescription', () => {
    it('returns 1 order per 300s for UNVERIFIED (default)', () => {
      const orig = process.env.AGENT_UNVERIFIED_ORDER_INTERVAL_SEC;
      delete process.env.AGENT_UNVERIFIED_ORDER_INTERVAL_SEC;
      expect(getDeploymentCapDescription('UNVERIFIED')).toBe(
        '1 order per 300s (unverified agent)'
      );
      if (orig) process.env.AGENT_UNVERIFIED_ORDER_INTERVAL_SEC = orig;
    });

    it('returns 1 order/sec for VERIFIED', () => {
      expect(getDeploymentCapDescription('VERIFIED')).toBe('1 order/sec per market');
    });

    it('returns 1 order/sec for TRUSTED', () => {
      expect(getDeploymentCapDescription('TRUSTED')).toBe('1 order/sec per market');
    });
  });
});
