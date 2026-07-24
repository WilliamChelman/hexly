/**
 * The Draw Steel **Monsters** importer's injected fetch port (ADR-0061). The port is the one seam the
 * importer touches the outside world through: it yields the pinned pack's raw actor `_source` documents,
 * and the pure transform ({@link toMonsterRecord}) turns those into Import Records. Isolating the network
 * and the archive here keeps the transform and the whole import pipe fixture-testable offline — a test
 * backs the importer with {@link fixtureFetchPort} and never hits GitHub.
 *
 * Not vendored: the *Monsters* content is MCDM's, reused under the Draw Steel Creator License, so the
 * pack is fetched at import time from a pinned commit-SHA codeload tarball, transformed, and discarded
 * (ADR-0061). Neither the repo nor the deployed artifact carries the bulk content.
 */

import { ImportContext } from '@hexly/domain';
import { gunzipSync } from 'fflate';

/**
 * The Draw Steel repo the *Monsters* pack lives in, pinned to a **commit SHA** (branch `1.1.x`) — not the
 * moving branch — so imports are reproducible and the committed fixtures stay aligned with a live import
 * (ADR-0061). Bumping the pack is a deliberate code change here.
 */
export const MONSTERS_PINNED_SHA = '86c23ef1473fdc6fc67e4e30ed0d610cc98aaa4a';

/** The codeload tarball of the pinned ref — an HTTPS archive of the repo at {@link MONSTERS_PINNED_SHA} (ADR-0061). */
export const MONSTERS_TARBALL_URL = `https://codeload.github.com/MetaMorphic-Digital/draw-steel/tar.gz/${MONSTERS_PINNED_SHA}`;

/**
 * The injected fetch port (ADR-0061): fetches the pinned *Monsters* pack and yields each actor's raw
 * `_source` document, untouched. The importer owns the transform; this owns only the fetch, so a test can
 * substitute {@link fixtureFetchPort} and drive the whole pipe with no network.
 */
export interface MonstersFetchPort {
  /** The pinned pack's raw actor documents; a fetch failure rejects, surfacing as a failed run (ADR-0060). */
  fetchMonsters(ctx: ImportContext): Promise<readonly unknown[]>;
}

/** The `fetch` subset this port needs — narrowed so the port depends on a hook, not the DOM `fetch` typing. */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; statusText: string; arrayBuffer(): Promise<ArrayBuffer> }>;

/**
 * The production fetch port: pull the pinned codeload tarball over HTTPS, gunzip and untar it in memory,
 * and return every Monsters-pack actor document — the bulk content never lands on disk (ADR-0061). A
 * non-2xx response throws, so the reconcile lands the run as failed rather than importing nothing.
 * `fetchImpl` is injectable only so a test need not monkeypatch the global.
 */
export function githubTarballFetchPort(
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): MonstersFetchPort {
  return {
    async fetchMonsters(ctx: ImportContext): Promise<readonly unknown[]> {
      const res = await fetchImpl(MONSTERS_TARBALL_URL, { signal: ctx.signal });
      if (!res.ok) {
        throw new Error(`Draw Steel monsters fetch failed: ${res.status} ${res.statusText}`);
      }
      const tar = gunzipSync(new Uint8Array(await res.arrayBuffer()));
      const decoder = new TextDecoder();
      const docs: unknown[] = [];
      for (const entry of readTar(tar)) {
        if (isMonsterActorPath(entry.path)) docs.push(JSON.parse(decoder.decode(entry.bytes)));
      }
      return docs;
    },
  };
}

/** A pack file we import: a Monsters-pack `npc_*.json` actor source, not a `Folder_*.json` or other pack. */
function isMonsterActorPath(path: string): boolean {
  const file = path.slice(path.lastIndexOf('/') + 1);
  return path.includes('/src/packs/monsters/') && file.startsWith('npc_') && file.endsWith('.json');
}

/** One extracted tar entry: its full path and raw bytes. */
interface TarEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/**
 * Walk a POSIX tar's 512-byte blocks, yielding each regular file (ADR-0061 fetches a `git archive`
 * tarball). Handles the three ways such an archive states a path too long for the 100-byte header name:
 * the ustar `prefix` field, a GNU `L` long-name block, and a pax `x` extended header's `path=` record.
 * Directories and metadata blocks are skipped; two zero blocks end the archive.
 */
function* readTar(tar: Uint8Array): Generator<TarEntry> {
  const decoder = new TextDecoder();
  let offset = 0;
  let pathOverride: string | undefined; // a pending GNU long-name / pax path for the next file entry
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break; // end-of-archive marker
    const size = parseOctal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156]);
    const contentStart = offset + 512;
    const content = tar.subarray(contentStart, contentStart + size);
    offset = contentStart + Math.ceil(size / 512) * 512; // header + content, padded to a block boundary

    if (typeflag === 'L') {
      pathOverride = trimNul(decoder.decode(content)); // GNU long name for the following entry
      continue;
    }
    if (typeflag === 'x' || typeflag === 'g') {
      const path = paxPath(decoder.decode(content));
      if (typeflag === 'x' && path) pathOverride = path; // pax per-file path override
      continue;
    }
    if (typeflag !== '0' && typeflag !== '\0') {
      pathOverride = undefined; // a dir or other type consumes any pending override
      continue;
    }
    yield { path: pathOverride ?? ustarName(header, decoder), bytes: content };
    pathOverride = undefined;
  }
}

/** A tar header's ustar path — `prefix` (offset 345) joined to `name` (offset 0), each NUL-terminated. */
function ustarName(header: Uint8Array, decoder: TextDecoder): string {
  const name = trimNul(decoder.decode(header.subarray(0, 100)));
  const prefix = trimNul(decoder.decode(header.subarray(345, 500)));
  return prefix ? `${prefix}/${name}` : name;
}

/** Read a tar header's ASCII-octal number field (how tar encodes sizes), NUL/space-padded. */
function parseOctal(header: Uint8Array, offset: number, length: number): number {
  const text = trimNul(new TextDecoder().decode(header.subarray(offset, offset + length))).trim();
  return text ? parseInt(text, 8) : 0;
}

/** The `path=` value from a pax extended header, whose records are `"<len> key=value\n"`. */
function paxPath(record: string): string | undefined {
  for (const line of record.split('\n')) {
    const match = /^\d+ path=(.*)$/.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

/** A NUL-terminated C string up to its first NUL. */
function trimNul(value: string): string {
  const nul = value.indexOf('\0');
  return nul === -1 ? value : value.slice(0, nul);
}
