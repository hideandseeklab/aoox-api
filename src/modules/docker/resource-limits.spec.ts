import { limitsRemoved, resourceLimits } from './resource-limits';

describe('limitsRemoved', () => {
  const l = (cpuMillicores: number | null, memoryMb: number | null) => ({
    cpuMillicores,
    memoryMb,
  });
  it('is true only when a previously set limit becomes unset', () => {
    expect(limitsRemoved(l(500, 256), l(null, 256))).toBe(true);
    expect(limitsRemoved(l(500, 256), l(500, null))).toBe(true);
    expect(limitsRemoved(l(500, 256), l(1000, 128))).toBe(false);
    expect(limitsRemoved(l(null, null), l(500, 256))).toBe(false);
  });
});

describe('resourceLimits', () => {
  it('converts millicores and MiB into Docker units with hard memory', () => {
    expect(resourceLimits(500, 256)).toEqual({
      NanoCpus: 500_000_000,
      Memory: 268_435_456,
      MemorySwap: 268_435_456,
    });
  });

  it('sends zeros (= unlimited) when a limit is unset, so updates can clear it', () => {
    expect(resourceLimits(null, undefined)).toEqual({
      NanoCpus: 0,
      Memory: 0,
      MemorySwap: 0,
    });
  });
});
