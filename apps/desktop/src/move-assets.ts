import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

/**
 * Moving the Asset bytes a new `assets.dir` (#324) would otherwise leave behind: copy, verify by hash, and
 * only then switch, so a cancelled or failed move leaves both pointer and bytes as they were (ADR-0034).
 */

/** Addressed relative to its root, so one value names the file at both roots. */
export interface AssetFile {
  readonly path: string;
  readonly size: number;
}

/** As much of the filesystem as moving Asset bytes needs, so a spec can stand in for it. */
export interface AssetFileStore {
  /** A root that does not exist yet is an empty tree, not a failure. */
  list(dir: string): Promise<readonly AssetFile[]>;
  /** Answers the sha256 of the bytes that went past: hashing the copy's own read keeps verification at one extra read. */
  copy(from: string, to: string, signal?: AbortSignal): Promise<string>;
  /** Hex-encoded sha256 of a file on disk. */
  hash(path: string): Promise<string>;
  /** Best-effort: the failure that triggered the rollback is the one worth reporting. */
  remove(path: string): Promise<void>;
}

export interface AssetMoveProgress {
  /** Relative to the old root; the counters are what finished before this file. */
  readonly file: string;
  readonly copiedFiles: number;
  readonly totalFiles: number;
  readonly copiedBytes: number;
  readonly totalBytes: number;
}

export interface AssetMovePlan {
  /** The Assets root in effect, as `ASSETS_DIR` resolved it (#324). */
  readonly from: string;
  readonly to: string;
  readonly signal?: AbortSignal;
  onProgress?(progress: AssetMoveProgress): void;
}

/** A **code**, not a sentence: the renderer is the half of the app with a translation catalog (ADR-0070). */
export type AssetMoveRefusal = 'same-folder' | 'nested-folders';

/** Only `moved` licenses rewriting `hexly.yml`; every other status means the original root is still the truth. */
export type AssetMoveOutcome =
  | { readonly status: 'moved'; readonly to: string; readonly files: number; readonly bytes: number }
  | { readonly status: 'cancelled' }
  | { readonly status: 'refused'; readonly refusal: AssetMoveRefusal }
  | { readonly status: 'failed'; readonly reason: string };

/** A second pass picks up Assets written while the first one ran, which can take minutes. */
const PASSES = 2;

/** Nested roots are refused because the old bytes staying put would make the new root contain its predecessor. */
export function assetsMoveRefusal(from: string, to: string): AssetMoveRefusal | undefined {
  const oldRoot = resolve(from);
  const newRoot = resolve(to);
  if (oldRoot === newRoot) return 'same-folder';
  if (encloses(oldRoot, newRoot) || encloses(newRoot, oldRoot)) return 'nested-folders';
  return undefined;
}

function encloses(parent: string, child: string): boolean {
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/**
 * Resolves `moved` only when the whole tree is verified at the new root — the caller's licence to rewrite the
 * config (ADR-0034). The old bytes are never deleted, so a move that went wrong stays recoverable by hand;
 * only what this move wrote at the new root is taken back.
 */
export async function copyAssetTree(store: AssetFileStore, plan: AssetMovePlan): Promise<AssetMoveOutcome> {
  const refusal = assetsMoveRefusal(plan.from, plan.to);
  if (refusal) return { status: 'refused', refusal };

  /** Verified at the new root: both the pass filter and the counters mean *finished*. */
  const copied = new Set<string>();
  /** Recorded *before* the write: an abort mid-file leaves a partial file to take back. */
  const attempted = new Set<string>();
  let copiedBytes = 0;

  try {
    // Files already at the new root are not ours to take back on a cancel.
    const theirs = new Set((await store.list(plan.to)).map((file) => file.path));
    for (let pass = 0; pass < PASSES; pass++) {
      const remaining = (await store.list(plan.from)).filter((file) => !copied.has(file.path));
      if (!remaining.length) break;
      // Re-totalled per pass: a file that arrived mid-copy is work the user should see.
      const totalFiles = copied.size + remaining.length;
      const totalBytes = copiedBytes + remaining.reduce((sum, file) => sum + file.size, 0);
      for (const file of remaining) {
        if (plan.signal?.aborted) return await abandon(store, plan.to, attempted, { status: 'cancelled' });
        plan.onProgress?.({ file: file.path, copiedFiles: copied.size, totalFiles, copiedBytes, totalBytes });
        if (!theirs.has(file.path)) attempted.add(file.path);
        await copyVerified(store, plan, file.path);
        copied.add(file.path);
        copiedBytes += file.size;
      }
    }
  } catch (err) {
    // An aborted stream fails rather than stopping politely; the user's gesture is the better explanation.
    if (plan.signal?.aborted) return await abandon(store, plan.to, attempted, { status: 'cancelled' });
    return await abandon(store, plan.to, attempted, { status: 'failed', reason: describe(err) });
  }
  return { status: 'moved', to: plan.to, files: copied.size, bytes: copiedBytes };
}

/**
 * Fires `report` at most once per `intervalMs`, the first one straight away: a folder of ten thousand small
 * files would otherwise cost the surface drawing the bar a change-detection pass each.
 */
export function throttleProgress(
  report: (progress: AssetMoveProgress) => void,
  intervalMs: number,
  /** A `Date.now`, so a spec drives the clock instead of waiting on it. */
  now: () => number = Date.now,
): (progress: AssetMoveProgress) => void {
  let last: number | undefined;
  return (progress) => {
    const at = now();
    if (last !== undefined && at - last < intervalMs) return;
    last = at;
    report(progress);
  };
}

export interface AssetStorageMove {
  /** As the `ASSETS_DIR` token resolved it (#324) — the resolved path, not the key. */
  readonly from: string;
  readonly store: AssetFileStore;
  /** `undefined` when the user dismissed the picker. */
  chooseFolder(): Promise<string | undefined>;
  /** Reached only once every byte is verified at the new root. */
  recordNewRoot(dir: string): void;
  onProgress?(progress: AssetMoveProgress): void;
  readonly signal?: AbortSignal;
}

/** `dismissed`: a picker the user closed is neither a failure nor something to report back at them. */
export type AssetStorageMoveOutcome = AssetMoveOutcome | { readonly status: 'dismissed' };

/**
 * Records the new `assets.dir` only once every byte verified. Relaunching into it is the caller's, so the
 * surface that asked can be told before the process it runs in goes away (ADR-0070).
 */
export async function moveAssetStorage(move: AssetStorageMove): Promise<AssetStorageMoveOutcome> {
  const to = await move.chooseFolder();
  if (!to) return { status: 'dismissed' };

  const outcome = await copyAssetTree(move.store, {
    from: move.from,
    to,
    signal: move.signal,
    onProgress: move.onProgress?.bind(move),
  });
  if (outcome.status !== 'moved') return outcome;

  try {
    move.recordNewRoot(to);
  } catch (err) {
    // Nothing is lost, and only the user can fix a `hexly.yml` that will not take a write, so say so rather
    // than relaunch.
    return {
      status: 'failed',
      reason: `The Assets were copied to ${to}, but hexly.yml could not be updated: ${describe(err)}`,
    };
  }
  return outcome;
}

/**
 * The destination's own bytes are hashed rather than trusting the write, so a truncated copy fails here rather
 * than becoming a config pointing at half a tree.
 */
async function copyVerified(store: AssetFileStore, plan: AssetMovePlan, path: string): Promise<void> {
  const read = await store.copy(join(plan.from, path), join(plan.to, path), plan.signal);
  const landed = await store.hash(join(plan.to, path));
  if (landed !== read) throw new Error(`${path} does not match at ${plan.to}: read ${read}, landed ${landed}`);
}

/** A file that will not delete is not worth failing over — the reason we are here is the one worth reporting. */
async function abandon(
  store: AssetFileStore,
  to: string,
  attempted: ReadonlySet<string>,
  outcome: AssetMoveOutcome,
): Promise<AssetMoveOutcome> {
  for (const path of attempted) await store.remove(join(to, path)).catch(() => undefined);
  return outcome;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The real filesystem, in the shape {@link copyAssetTree} asks for. */
export function assetFileStore(): AssetFileStore {
  return {
    list: async (dir) => {
      let entries;
      try {
        entries = await readdir(dir, { recursive: true, withFileTypes: true });
      } catch (err) {
        // A root the Instance never wrote to holds no Assets, which is a move of nothing, not an error.
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
      }
      const files = entries.filter((entry) => entry.isFile());
      return Promise.all(
        files.map(async (entry) => {
          const path = join(entry.parentPath, entry.name);
          return { path: relative(dir, path), size: (await stat(path)).size };
        }),
      );
    },

    copy: async (from, to, signal) => {
      await mkdir(dirname(to), { recursive: true });
      const digest = createHash('sha256');
      await pipeline(
        createReadStream(from),
        async function* (source) {
          for await (const chunk of source) {
            digest.update(chunk);
            yield chunk;
          }
        },
        createWriteStream(to),
        { signal },
      );
      return digest.digest('hex');
    },

    hash: async (path) => {
      const digest = createHash('sha256');
      for await (const chunk of createReadStream(path)) digest.update(chunk);
      return digest.digest('hex');
    },

    remove: (path) => rm(path, { force: true }),
  };
}
