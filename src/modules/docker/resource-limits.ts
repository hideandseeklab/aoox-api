/**
 * Docker resource limits from user-facing units (spec: HostConfig / ContainerUpdate).
 * `NanoCpus` = cores × 1e9; `Memory` in bytes, with `MemorySwap` pinned to the
 * same value so the limit is hard (no swap headroom) — like `--memory-swap`.
 * null/0 means "unlimited" and is sent as 0 so an update can *remove* a limit.
 */
export interface ResourceLimits {
  NanoCpus: number;
  Memory: number;
  MemorySwap: number;
}

/**
 * `POST /containers/{id}/update` treats 0 as "leave unchanged", so a limit
 * can be raised or lowered live but never *removed* that way — removing one
 * needs the container recreated with the new HostConfig.
 */
export function limitsRemoved(
  before: { cpuMillicores: number | null; memoryMb: number | null },
  after: { cpuMillicores: number | null; memoryMb: number | null },
): boolean {
  return (
    (!!before.cpuMillicores && !after.cpuMillicores) ||
    (!!before.memoryMb && !after.memoryMb)
  );
}

export function resourceLimits(
  cpuMillicores: number | null | undefined,
  memoryMb: number | null | undefined,
): ResourceLimits {
  const memory = memoryMb ? memoryMb * 1024 * 1024 : 0;
  return {
    NanoCpus: cpuMillicores ? cpuMillicores * 1_000_000 : 0,
    Memory: memory,
    MemorySwap: memory,
  };
}
