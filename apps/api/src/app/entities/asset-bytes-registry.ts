import { Injectable } from '@nestjs/common';

/** Whether the bytes at a World-scoped {@link AssetBytesRef} address are on disk right now. */
export type AssetBytesProbe = (worldId: string, hash: string, ext: string) => boolean;

/**
 * The read-time byte-presence hook (#325, ADR-0034). `EntitiesService` owns the read model and the derived
 * dedup index, but must not learn where Asset bytes live; `AssetsService` — the one holder of the resolved
 * `ASSETS_DIR` — registers a probe here at startup, exactly as it registers its deletion reaper
 * ({@link EntityDeletionRegistry}). The dependency stays one-way: `assets` imports `entities`, never the
 * reverse.
 *
 * Fail-**present**, deliberately: no registered probe (a test module without the Assets subsystem) or an
 * unknown address (an index row written before the `ext` column existed) reports nothing missing. A false
 * "your file is gone" is worse than a missed indicator — the whole point of the state is that the user can
 * trust it to mean "elsewhere, not lost".
 */
@Injectable()
export class AssetBytesRegistry {
  private probe: AssetBytesProbe | null = null;

  /** Register the probe the Assets subsystem answers presence with. Last registration wins. */
  register(probe: AssetBytesProbe): void {
    this.probe = probe;
  }

  /** Whether the bytes at this address are absent. An unprobeable or incomplete address reads as present. */
  missing(worldId: string, hash: string | null | undefined, ext: string | null | undefined): boolean {
    if (!this.probe || !hash || !ext) return false;
    return !this.probe(worldId, hash, ext);
  }
}
