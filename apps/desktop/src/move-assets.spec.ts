import {
  type AssetFile,
  type AssetFileStore,
  type AssetMoveProgress,
  type AssetStorageMove,
  assetsMoveRefusal,
  copyAssetTree,
  moveAssetStorage,
  throttleProgress,
} from './move-assets';

const OLD = '/instance/assets';
const NEW = '/Volumes/Big/hexly-assets';

/** Stands in for the sha256: the bytes themselves, which is all a spec needs to tell a match from a mismatch. */
function digestOf(bytes: string): string {
  return `sha256(${bytes})`;
}

/**
 * Both Asset roots in one Map, since a move reads one and writes the other. State-holding, so a class rather
 * than a recorder: what a spec asserts is what ended up where, and what was taken back.
 */
class FakeStore implements AssetFileStore {
  readonly written: string[] = [];
  readonly removed: string[] = [];
  /** Paths whose copy lands truncated bytes — a volume that filled up, or a mount that dropped mid-write. */
  readonly truncates = new Set<string>();
  /** Paths the filesystem refuses outright. */
  readonly refuses = new Set<string>();
  /** Run before each copy, so a spec can cancel, or write to the old root, while the move is in flight. */
  onCopy?: (path: string) => void;

  constructor(readonly bytes = new Map<string, string>()) {}

  async list(dir: string): Promise<readonly AssetFile[]> {
    return [...this.bytes.entries()]
      .filter(([path]) => path.startsWith(`${dir}/`))
      .map(([path, bytes]) => ({ path: path.slice(dir.length + 1), size: bytes.length }));
  }

  async copy(from: string, to: string, signal?: AbortSignal): Promise<string> {
    this.onCopy?.(from);
    // The real copy is a stream: an abort rejects it rather than returning politely.
    if (signal?.aborted) throw new Error('The operation was aborted');
    if (this.refuses.has(from)) throw new Error(`ENOSPC: no space left on device, ${to}`);
    const bytes = this.bytes.get(from) ?? '';
    this.bytes.set(to, this.truncates.has(from) ? bytes.slice(0, 1) : bytes);
    this.written.push(to);
    return digestOf(bytes);
  }

  async hash(path: string): Promise<string> {
    return digestOf(this.bytes.get(path) ?? '');
  }

  async remove(path: string): Promise<void> {
    this.bytes.delete(path);
    this.removed.push(path);
  }
}

function storeWithAssets(): FakeStore {
  return new FakeStore(
    new Map([
      [`${OLD}/world-1/aaa.png`, 'a map'],
      [`${OLD}/world-1/aaa.thumb.webp`, 'a thumbnail'],
      [`${OLD}/world-2/bbb.pdf`, 'a rulebook'],
    ]),
  );
}

describe('assetsMoveRefusal', () => {
  it('refuses the folder the Assets are already in, which is an 8 GB copy that changes nothing', () => {
    expect(assetsMoveRefusal(OLD, OLD)).toBe('same-folder');
    expect(assetsMoveRefusal(OLD, `${OLD}/`)).toBe('same-folder');
  });

  it('refuses either folder containing the other, since the old bytes deliberately stay put', () => {
    expect(assetsMoveRefusal(OLD, `${OLD}/inner`)).toBe('nested-folders');
    expect(assetsMoveRefusal(`${NEW}/inner`, NEW)).toBe('nested-folders');
  });

  it('allows a sibling whose name merely starts the same', () => {
    expect(assetsMoveRefusal(OLD, `${OLD}-2`)).toBeUndefined();
  });
});

describe('copyAssetTree', () => {
  it('copies every file, thumbnails included, and reports what it moved', async () => {
    const store = storeWithAssets();

    const outcome = await copyAssetTree(store, { from: OLD, to: NEW });

    expect(outcome).toEqual({ status: 'moved', to: NEW, files: 3, bytes: 26 });
    expect(store.bytes.get(`${NEW}/world-1/aaa.png`)).toBe('a map');
    expect(store.bytes.get(`${NEW}/world-1/aaa.thumb.webp`)).toBe('a thumbnail');
    expect(store.bytes.get(`${NEW}/world-2/bbb.pdf`)).toBe('a rulebook');
  });

  it('leaves the original bytes in place, so a move that went wrong is recoverable by hand', async () => {
    const store = storeWithAssets();

    await copyAssetTree(store, { from: OLD, to: NEW });

    expect(store.removed).toEqual([]);
    expect(store.bytes.get(`${OLD}/world-1/aaa.png`)).toBe('a map');
  });

  it('moves nothing, happily, from a root the Instance has never written to', async () => {
    const outcome = await copyAssetTree(new FakeStore(), { from: OLD, to: NEW });

    expect(outcome).toEqual({ status: 'moved', to: NEW, files: 0, bytes: 0 });
  });

  it('reports the file in flight and a total the progress can be read against', async () => {
    const store = storeWithAssets();
    const reports: AssetMoveProgress[] = [];

    await copyAssetTree(store, { from: OLD, to: NEW, onProgress: (progress) => void reports.push(progress) });

    expect(reports).toHaveLength(3);
    expect(reports[0]).toEqual({
      file: 'world-1/aaa.png',
      copiedFiles: 0,
      totalFiles: 3,
      copiedBytes: 0,
      totalBytes: 26,
    });
    expect(reports[2]).toEqual({
      file: 'world-2/bbb.pdf',
      copiedFiles: 2,
      totalFiles: 3,
      copiedBytes: 16,
      totalBytes: 26,
    });
  });

  it('fails, naming the file, when what landed does not hash to what was read', async () => {
    const store = storeWithAssets();
    store.truncates.add(`${OLD}/world-2/bbb.pdf`);

    const outcome = await copyAssetTree(store, { from: OLD, to: NEW });

    expect(outcome).toEqual({ status: 'failed', reason: expect.stringContaining('world-2/bbb.pdf') });
  });

  it('takes back everything it wrote when a copy fails, leaving the chosen folder as it found it', async () => {
    const store = storeWithAssets();
    store.refuses.add(`${OLD}/world-2/bbb.pdf`);

    const outcome = await copyAssetTree(store, { from: OLD, to: NEW });

    expect(outcome).toEqual({ status: 'failed', reason: expect.stringContaining('no space left on device') });
    // The file that failed is taken back too: a write that stopped part-way is exactly what leaves a partial one.
    expect(store.removed).toEqual([
      `${NEW}/world-1/aaa.png`,
      `${NEW}/world-1/aaa.thumb.webp`,
      `${NEW}/world-2/bbb.pdf`,
    ]);
    expect([...store.bytes.keys()].filter((path) => path.startsWith(NEW))).toEqual([]);
  });

  it('answers a cancellation as cancelled rather than as the abort error the stream throws', async () => {
    const store = storeWithAssets();
    const cancel = new AbortController();
    store.onCopy = () => void (store.written.length === 1 && cancel.abort());

    const outcome = await copyAssetTree(store, { from: OLD, to: NEW, signal: cancel.signal });

    expect(outcome).toEqual({ status: 'cancelled' });
    // Both: the one that landed, and the one the abort interrupted part-way through.
    expect(store.removed).toEqual([`${NEW}/world-1/aaa.png`, `${NEW}/world-1/aaa.thumb.webp`]);
    expect(store.bytes.get(`${OLD}/world-1/aaa.png`)).toBe('a map');
  });

  it('refuses a folder it must not copy into without touching a byte', async () => {
    const store = storeWithAssets();

    const outcome = await copyAssetTree(store, { from: OLD, to: `${OLD}/inner` });

    // A code, not a sentence: the renderer holds the catalogue that turns it into words (ADR-0070).
    expect(outcome).toEqual({ status: 'refused', refusal: 'nested-folders' });
    expect(store.written).toEqual([]);
  });

  /**
   * The natural second attempt after a move that failed: the same folder, holding some of it already. Undoing
   * our own writes must not turn into deleting the user's files.
   */
  it('never takes back a file that was in the chosen folder before this move', async () => {
    const store = storeWithAssets();
    store.bytes.set(`${NEW}/world-1/aaa.png`, 'a map');
    store.refuses.add(`${OLD}/world-2/bbb.pdf`);

    await copyAssetTree(store, { from: OLD, to: NEW });

    expect(store.removed).not.toContain(`${NEW}/world-1/aaa.png`);
    expect(store.bytes.get(`${NEW}/world-1/aaa.png`)).toBe('a map');
  });

  it('picks up an Asset written to the old root while the copy was running', async () => {
    const store = storeWithAssets();
    store.onCopy = () => {
      if (store.written.length === 1) store.bytes.set(`${OLD}/world-2/ccc.png`, 'a late upload');
    };

    const outcome = await copyAssetTree(store, { from: OLD, to: NEW });

    expect(outcome).toEqual({ status: 'moved', to: NEW, files: 4, bytes: 26 + 'a late upload'.length });
    expect(store.bytes.get(`${NEW}/world-2/ccc.png`)).toBe('a late upload');
  });
});

describe('moveAssetStorage', () => {
  /** The shell around one move: a picker that answers `chosen`, and a `hexly.yml` write that is recorded. */
  function shell(store: FakeStore, chosen: string | undefined, options: { refuseWrite?: string } = {}) {
    const recorded: string[] = [];
    const move: AssetStorageMove = {
      from: OLD,
      store,
      chooseFolder: async () => chosen,
      recordNewRoot: (dir) => {
        if (options.refuseWrite) throw new Error(options.refuseWrite);
        recorded.push(dir);
      },
    };
    return { move, recorded };
  }

  it('records the new root once every byte has landed and verified', async () => {
    const store = storeWithAssets();
    const { move, recorded } = shell(store, NEW);

    const outcome = await moveAssetStorage(move);

    expect(outcome).toEqual({ status: 'moved', to: NEW, files: 3, bytes: 26 });
    expect(recorded).toEqual([NEW]);
  });

  it('leaves the config alone when the user dismisses the picker, without reading a folder', async () => {
    const store = storeWithAssets();
    const { move, recorded } = shell(store, undefined);

    expect(await moveAssetStorage(move)).toEqual({ status: 'dismissed' });
    expect(store.written).toEqual([]);
    expect(recorded).toEqual([]);
  });

  /** The safety property in one assertion: a failed copy never becomes a pointer at half a tree. */
  it('leaves the original location in effect when a copy fails', async () => {
    const store = storeWithAssets();
    store.truncates.add(`${OLD}/world-1/aaa.png`);
    const { move, recorded } = shell(store, NEW);

    expect(await moveAssetStorage(move)).toMatchObject({ status: 'failed' });
    expect(recorded).toEqual([]);
  });

  it('leaves the original location in effect when the user cancels', async () => {
    const store = storeWithAssets();
    const cancel = new AbortController();
    store.onCopy = () => cancel.abort();
    const { move, recorded } = shell(store, NEW);

    expect(await moveAssetStorage({ ...move, signal: cancel.signal })).toEqual({ status: 'cancelled' });
    expect(recorded).toEqual([]);
  });

  /**
   * The one state a relaunch must not paper over: the bytes are all at the new root and the config still names
   * the old one. Nothing is lost, but only the user can fix a file that will not take a write.
   */
  it('names the copied-but-unswitched state when hexly.yml will not take the write', async () => {
    const store = storeWithAssets();
    const { move } = shell(store, NEW, { refuseWrite: 'EACCES: permission denied' });

    expect(await moveAssetStorage(move)).toEqual({
      status: 'failed',
      reason: expect.stringContaining('EACCES: permission denied'),
    });
  });
});

describe('throttleProgress', () => {
  const REPORT: AssetMoveProgress = {
    file: 'world-1/aaa.png',
    copiedFiles: 1,
    totalFiles: 4,
    copiedBytes: 1,
    totalBytes: 4,
  };

  /** A clock a spec winds by hand, rather than a spec that waits. */
  function at(times: number[]): () => number {
    let index = 0;
    return () => times[index++];
  }

  it('reports the first one straight away, so a surface is never blank while work is happening', () => {
    const reported: AssetMoveProgress[] = [];
    const report = throttleProgress((progress) => void reported.push(progress), 100, at([0]));

    report(REPORT);

    expect(reported).toEqual([REPORT]);
  });

  it('drops what falls inside the window and resumes after it', () => {
    const reported: AssetMoveProgress[] = [];
    const report = throttleProgress((progress) => void reported.push(progress), 100, at([1000, 1050, 1099, 1100]));

    for (let i = 0; i < 4; i++) report({ ...REPORT, copiedFiles: i });

    // Ten thousand small files must not buy ten thousand change-detection passes; the outcome has the last word.
    expect(reported.map((progress) => progress.copiedFiles)).toEqual([0, 3]);
  });
});
