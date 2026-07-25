import { Injectable } from '@nestjs/common';

/** Whether the bytes at a World-scoped address are on disk right now. */
export type AssetBytesProbe = (worldId: string, hash: string, ext: string) => boolean;

/**
 * The read-time byte-presence hook behind Missing Bytes (#325, ADR-0034): `AssetsService`, sole holder of the
 * resolved `ASSETS_DIR`, registers a probe at startup, so `entities` marks the state without learning where
 * bytes live and `assets` keeps importing `entities` rather than the reverse.
 *
 * Fails present — no probe, or an incomplete address, reports nothing missing — because a false "your file is
 * gone" would cost the state its only value.
 */
@Injectable()
export class AssetBytesRegistry {
  private probe: AssetBytesProbe | null = null;

  /** Register the probe the Assets subsystem answers presence with. Last registration wins. */
  register(probe: AssetBytesProbe): void {
    this.probe = probe;
  }

  /** An unprobeable or incomplete address reads as present. */
  missing(worldId: string, hash: string | null | undefined, ext: string | null | undefined): boolean {
    if (!this.probe || !hash || !ext) return false;
    return !this.probe(worldId, hash, ext);
  }
}
