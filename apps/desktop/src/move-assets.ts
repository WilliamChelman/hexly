import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

/**
 * Moving the Asset bytes to a new root, which is the half of `assets.dir` (#324) the knob cannot do for
 * itself: pointing the config somewhere new leaves every Entity referencing files that are not there
 * (ADR-0034). Copy, verify by hash, and only then switch — so a cancelled or failed move leaves both the
 * original pointer and the original bytes exactly as they were.
 */

/** A file under an Assets root, addressed by its path relative to that root — one value names it at both roots. */
export interface AssetFile {
  readonly path: string;
  readonly size: number;
}

/** As much of the filesystem as moving Asset bytes needs, so a spec can stand in for it. */
export interface AssetFileStore {
  /** Every file under `dir`, recursively. A root that does not exist yet is an empty tree, not a failure. */
  list(dir: string): Promise<readonly AssetFile[]>;
  /**
   * Copy `from` to `to`, creating the destination's parents, and answer the sha256 of the bytes that went
   * past. Hashing the read the copy is already doing is what keeps a verified copy at one extra read — of
   * the destination, which is the only side worth re-reading.
   */
  copy(from: string, to: string, signal?: AbortSignal): Promise<string>;
  /** The sha256 of a file on disk, hex-encoded. */
  hash(path: string): Promise<string>;
  /** Take back a copy this move wrote. Best-effort: the failure that triggers it is the one worth reporting. */
  remove(path: string): Promise<void>;
}

/** What the copy is doing right now, for a surface that has to hold a user's attention for minutes. */
export interface AssetMoveProgress {
  /** The file being copied *now*, relative to the old root; the counters are what finished before it. */
  readonly file: string;
  readonly copiedFiles: number;
  readonly totalFiles: number;
  readonly copiedBytes: number;
  readonly totalBytes: number;
}

export interface AssetMovePlan {
  /** The Assets root in effect, as `ASSETS_DIR` resolved it (#324). */
  readonly from: string;
  /** The root the user picked. */
  readonly to: string;
  /** Cancellation, which a user watching an 8 GB copy will reach for. */
  readonly signal?: AbortSignal;
  onProgress?(progress: AssetMoveProgress): void;
}

/**
 * Why a move must not be attempted. A **code**, not a sentence: this one is ours to explain, and the renderer
 * is the half of the app with a translation catalog (ADR-0070) — unlike a filesystem message, which arrives in
 * whatever words the platform used and can only be passed through.
 */
export type AssetMoveRefusal = 'same-folder' | 'nested-folders';

/**
 * `moved` is the only outcome that has earned the right to rewrite `hexly.yml`; every other one means the
 * original root is still the truth. `reason` names what failed, since the user's next move is to fix it.
 */
export type AssetMoveOutcome =
  | { readonly status: 'moved'; readonly to: string; readonly files: number; readonly bytes: number }
  | { readonly status: 'cancelled' }
  | { readonly status: 'refused'; readonly refusal: AssetMoveRefusal }
  | { readonly status: 'failed'; readonly reason: string };

/**
 * How many times the old root is re-listed. The first pass can run for minutes, so a second one picks up an
 * Asset written while it ran — otherwise the switch would strand exactly the bytes the user just added, and
 * "no Asset is missing afterwards" would hold only for a move nobody was working through.
 */
const PASSES = 2;

/**
 * Why a move must not even be attempted, or `undefined` if it may be. Both roots being the same is a no-op
 * dressed as an 8 GB copy, and one nested inside the other makes "the old bytes stay put" (which is the
 * recovery story) mean a new root that contains its own predecessor.
 */
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
 * Copy every Asset byte from one root to the other, verifying each file by hash as it lands, and report
 * progress. Resolves `moved` only when the whole tree is present and verified at the new root — the caller's
 * licence to rewrite the config and relaunch (ADR-0034).
 *
 * The old bytes are never deleted: a move that went wrong is then recoverable by hand, and content-addressed
 * write-once files cost only disk. What *is* taken back is what this move wrote at the new root, so a
 * cancelled copy does not leave gigabytes of unexplained files in a folder the user picked.
 */
export async function copyAssetTree(store: AssetFileStore, plan: AssetMovePlan): Promise<AssetMoveOutcome> {
  const refusal = assetsMoveRefusal(plan.from, plan.to);
  if (refusal) return { status: 'refused', refusal };

  /** Verified at the new root. The pass filter and the progress counters both mean *finished*. */
  const copied = new Set<string>();
  /** Everything this move has written to, recorded *before* the write: an abort mid-file leaves a partial one. */
  const attempted = new Set<string>();
  let copiedBytes = 0;

  try {
    // What was at the new root before this move: a folder the user has moved into before, most likely. Not ours
    // to take back on a cancel, which is the difference between undoing our own writes and deleting their files.
    const theirs = new Set((await store.list(plan.to)).map((file) => file.path));
    for (let pass = 0; pass < PASSES; pass++) {
      const remaining = (await store.list(plan.from)).filter((file) => !copied.has(file.path));
      if (!remaining.length) break;
      // Re-totalled per pass: a file that arrived mid-copy is work the user should see, not a bar stuck at 100%.
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
    // An aborted stream fails rather than stopping politely, and the user's gesture is the better explanation.
    if (plan.signal?.aborted) return await abandon(store, plan.to, attempted, { status: 'cancelled' });
    return await abandon(store, plan.to, attempted, { status: 'failed', reason: describe(err) });
  }
  return { status: 'moved', to: plan.to, files: copied.size, bytes: copiedBytes };
}

/**
 * Wrap `report` so it fires at most once per `intervalMs` — the first one straight away, then no more than one
 * per window. A folder of ten thousand small files would otherwise send ten thousand messages to the surface
 * drawing them, each costing a change-detection pass, to move a bar by fractions of a pixel. The report that
 * gets dropped is never the last word: the outcome is.
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

/** What one move of the Asset storage needs from the shell around it. */
export interface AssetStorageMove {
  /** Where the bytes are now, as the `ASSETS_DIR` token resolved it (#324) — the resolved truth, not the key. */
  readonly from: string;
  readonly store: AssetFileStore;
  /** The native folder picker: the folder chosen, or `undefined` when the user dismissed it. */
  chooseFolder(): Promise<string | undefined>;
  /** Point `assets.dir` at the new root. The switch, and reached only once every byte is verified there. */
  recordNewRoot(dir: string): void;
  onProgress?(progress: AssetMoveProgress): void;
  readonly signal?: AbortSignal;
}

/** A picker the user closed without choosing is neither a failure nor something to report back at them. */
export type AssetStorageMoveOutcome = AssetMoveOutcome | { readonly status: 'dismissed' };

/**
 * Pick a folder, copy the Asset bytes into it, and — only if every one of them verified — record it as the
 * new `assets.dir`. Relaunching into it is the caller's, so the surface that asked can be told the move
 * succeeded before the process it is running in goes away (ADR-0070).
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
    // The bytes are all at the new root and the config still names the old one — nothing is lost, and the
    // user is the only one who can fix a `hexly.yml` that will not take a write, so say so rather than relaunch.
    return {
      status: 'failed',
      reason: `The Assets were copied to ${to}, but hexly.yml could not be updated: ${describe(err)}`,
    };
  }
  return outcome;
}

/**
 * One file, copied and then read back. The destination's own bytes are hashed rather than trusting the write:
 * a truncated copy on a volume that filled up, or a network mount that dropped, is precisely the failure this
 * gate exists to catch before it becomes a config pointing at half a tree.
 */
async function copyVerified(store: AssetFileStore, plan: AssetMovePlan, path: string): Promise<void> {
  const read = await store.copy(join(plan.from, path), join(plan.to, path), plan.signal);
  const landed = await store.hash(join(plan.to, path));
  if (landed !== read) throw new Error(`${path} does not match at ${plan.to}: read ${read}, landed ${landed}`);
}

/**
 * Undo this move's writes and report why it stopped. A file that will not delete is not worth failing over —
 * the reason we are here is the one worth reporting. Empty folders are left: they hold nothing.
 */
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
        // A root the Instance has never written to holds no Assets, which is a move of nothing, not an error.
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
