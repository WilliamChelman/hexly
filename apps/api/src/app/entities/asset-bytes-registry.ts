import { Injectable } from '@nestjs/common';

/** Whether the bytes at a World-scoped {@link AssetBytesRef} address are on disk right now. */
export type AssetBytesProbe = (worldId: string, hash: string, ext: string) => boolean;

/**
 * The read-time byte-presence hook behind **Missing Bytes** (#325, ADR-0034). `AssetsService` — the one
 * holder of the resolved `ASSETS_DIR` — registers a probe here at startup, exactly as it registers its
 * deletion reaper ({@link EntityDeletionRegistry}), so `entities` marks the state without learning where
 * bytes live and `assets` keeps importing `entities` rather than the reverse.
 *
 * Fail-**present**: no registered probe (a test module without the Assets subsystem) or an incomplete
 * address (an index row predating the `ext` column) reports nothing missing — a false "your file is gone"
 * would cost the state the trust that is its only value.
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
