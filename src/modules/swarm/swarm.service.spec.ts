import { SWARM_CONSTRAINT } from '../application/application.entity';

describe('SWARM_CONSTRAINT', () => {
  it('accepts scheduler constraints and rejects junk', () => {
    for (const ok of [
      'node.labels.zone==eu',
      'node.role==worker',
      'node.hostname!=web-1',
      'node.platform.arch==x86_64',
      'node.id==abc123',
    ]) {
      expect(SWARM_CONSTRAINT.test(ok)).toBe(true);
    }
    for (const bad of [
      'zone==eu',
      'node.labels==x',
      'node.role=worker',
      'node.role==a b',
      'engine.labels.x==1',
    ]) {
      expect(SWARM_CONSTRAINT.test(bad)).toBe(false);
    }
  });
});
