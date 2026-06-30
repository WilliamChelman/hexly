import { Provider } from '@angular/core';
import type {
  Client,
  Filter,
  FilterOrComposite,
  ListOpts,
  ListResponse,
  RecordApi,
  RecordId,
} from 'trailbase';
import { InitClient, TRAILBASE_INIT } from '../services/trailbase-client';

type Row = Record<string, unknown>;
type Trigger = (created: Row, store: FakeStore) => void;

/**
 * An in-memory stand-in for the TrailBase Record API surface the Worlds/Entities
 * clients use (ADR-0032): list (filters/order/limit/count), read, create, update,
 * delete — over wire-shaped rows (snake_case, `document`/`tags` as JSON strings,
 * `is_home` as 0/1). It mirrors the real semantics the e2e suite proves on the
 * wire, so the client unit specs can exercise mapping + composition without HTTP.
 */
export class FakeStore {
  private readonly tables = new Map<string, Row[]>();
  private readonly triggers = new Map<string, Trigger[]>();
  private readonly failListOnce = new Set<string>();
  private seq = 0;

  /** Make the next `list(table)` reject, so error-path tests can drive a failure. */
  failNextList(table: string): void {
    this.failListOnce.add(table);
  }

  /** Internal: consume a one-shot list failure for `table`. */
  takeListFailure(table: string): boolean {
    return this.failListOnce.delete(table);
  }

  /** Seed wire rows directly for a table (the test's arrange step). */
  seed(table: string, rows: Row[]): void {
    this.tables.set(table, [...(this.tables.get(table) ?? []), ...rows]);
  }

  rows(table: string): Row[] {
    return this.tables.get(table) ?? [];
  }

  /** Register an `AFTER INSERT`-style hook (e.g. a World minting its Home Entity). */
  onCreate(table: string, trigger: Trigger): void {
    const list = this.triggers.get(table) ?? [];
    list.push(trigger);
    this.triggers.set(table, list);
  }

  /** A monotonically increasing id, base64-ish like a TrailBase UUID over the wire. */
  nextId(): string {
    return `id-${(this.seq += 1)}`;
  }

  api<T extends Row = Row>(table: string): RecordApi<T> {
    return new FakeRecordApi<T>(table, this) as unknown as RecordApi<T>;
  }

  insert(table: string, row: Row): Row {
    const rows = this.tables.get(table) ?? [];
    rows.push(row);
    this.tables.set(table, rows);
    for (const trigger of this.triggers.get(table) ?? []) trigger(row, this);
    return row;
  }
}

class FakeRecordApi<T extends Row> {
  constructor(
    private readonly table: string,
    private readonly store: FakeStore,
  ) {}

  async list(opts?: ListOpts): Promise<ListResponse<T>> {
    if (this.store.takeListFailure(this.table)) {
      throw new Error(`list(${this.table}) failed`);
    }
    let rows = [...this.store.rows(this.table)];
    for (const f of opts?.filters ?? []) {
      rows = rows.filter((r) => matches(r, f));
    }
    rows.sort(byOrder(opts?.order ?? []));
    const total = rows.length;
    const limit = opts?.pagination?.limit;
    const page = limit ? rows.slice(0, limit) : rows;
    return {
      records: page as T[],
      cursor: 'CURSOR',
      ...(opts?.count ? { total_count: total } : {}),
    };
  }

  async read(id: RecordId): Promise<T> {
    const row = this.store.rows(this.table).find((r) => r['id'] === id);
    // Mirror TrailBase's FetchError (a numeric `status`) so 404 handling is testable.
    if (!row) throw Object.assign(new Error(`record ${String(id)} not found`), { status: 404 });
    return row as T;
  }

  async create(record: T): Promise<RecordId> {
    const id = this.store.nextId();
    this.store.insert(this.table, { id, ...record });
    return id;
  }

  async update(id: RecordId, record: Partial<T>): Promise<void> {
    const row = this.store.rows(this.table).find((r) => r['id'] === id);
    if (!row) throw new Error(`record ${String(id)} not found`);
    // Optimistic concurrency (ADR-0032): an update carrying `version` is admitted only
    // when it matches the row's current value — the entities UPDATE access-rule
    // `_REQ_.version = _ROW_.version`. A stale one is rejected exactly as TrailBase does,
    // a FetchError with a numeric `status` (403). The admitted write advances the counter,
    // mirroring the AFTER UPDATE bump trigger — so the client sends the base, never base+1.
    if (record['version'] !== undefined && record['version'] !== row['version']) {
      throw Object.assign(new Error(`stale version for ${String(id)}`), { status: 403 });
    }
    Object.assign(row, record);
    if (record['version'] !== undefined) row['version'] = (record['version'] as number) + 1;
  }

  async delete(id: RecordId): Promise<void> {
    const rows = this.store.rows(this.table);
    const idx = rows.findIndex((r) => r['id'] === id);
    if (idx >= 0) rows.splice(idx, 1);
  }
}

/** A filter (or `and`/`or` composite) against one wire row — only what the clients use. */
function matches(row: Row, f: FilterOrComposite): boolean {
  if ('and' in f) return f.and.every((sub) => matches(row, sub));
  if ('or' in f) return f.or.some((sub) => matches(row, sub));
  return matchesLeaf(row, f);
}

/** A `column op value` leaf — only the ops the clients use. */
function matchesLeaf(row: Row, f: Filter): boolean {
  const value = row[f.column];
  if (f.op === 'like') {
    const needle = f.value.replace(/%/g, '').toLowerCase();
    return String(value ?? '').toLowerCase().includes(needle);
  }
  // Bare equality: the wire compares as strings (e.g. is_home `1`/`0`).
  return String(value) === f.value;
}

/** Order rows by `['-col', 'col']` keys (descending when prefixed `-`). */
function byOrder(order: string[]): (a: Row, b: Row) => number {
  return (a, b) => {
    for (const key of order) {
      const desc = key.startsWith('-');
      const col = desc ? key.slice(1) : key;
      const av = a[col] as number | string;
      const bv = b[col] as number | string;
      if (av === bv) continue;
      const cmp = av < bv ? -1 : 1;
      return desc ? -cmp : cmp;
    }
    return 0;
  };
}

/**
 * Mirror the `AFTER INSERT ON worlds` trigger (ADR-0024): every created World mints
 * its Home Entity. Specs that create Worlds install this so `WorldsClient` can
 * compose a `WorldDetail` (home id + count) exactly as it does against real TrailBase.
 */
export function installWorldHomeTrigger(store: FakeStore): void {
  store.onCreate('worlds', (world, s) =>
    s.insert('entities', {
      id: s.nextId(),
      owner_id: world['owner_id'] ?? 'u1',
      world_id: world['id'],
      is_home: 1,
      name: world['name'],
      type: 'note',
      tags: '[]',
      visibility: 'private',
      version: 1,
      document: '{"type":"note","content":{"format":"tiptap-v2","snapshot":{"type":"doc","content":[]}}}',
      created_at: 1,
      updated_at: 1,
    }),
  );
}

/**
 * Provide a {@link FakeStore} behind {@link TrailbaseClient}, so the Worlds/Entities
 * clients resolve `client.records(name)` against it. Returns the store so the test
 * can seed rows, register triggers, and assert the resulting state.
 */
export function provideFakeTrailbaseRecords(): {
  readonly provider: Provider;
  readonly store: FakeStore;
} {
  const store = new FakeStore();
  const fakeClient = {
    records: <T extends Row>(name: string) => store.api<T>(name),
    user: () => undefined,
    tokens: () => undefined,
  } as unknown as Client;
  const init: InitClient = () => fakeClient;
  return { provider: { provide: TRAILBASE_INIT, useValue: init }, store };
}
