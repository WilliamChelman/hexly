import { Observable, of } from 'rxjs';
import { CompendiumPackSummary, ImportRunSummary, ReindexJob } from '@hexly/domain';

/** An import run in whatever state a spec needs, over the idle baseline. */
export function importRun(run: Partial<ImportRunSummary> = {}): ImportRunSummary {
  return {
    importer: null,
    rev: null,
    status: 'idle',
    total: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    skipped: [],
    startedAt: null,
    finishedAt: null,
    error: null,
    ...run,
  };
}

/** One compendium pack row, idle and uninstalled unless a spec says otherwise. */
export function compendiumPack(pack: Partial<CompendiumPackSummary> = {}): CompendiumPackSummary {
  return { importer: 'test.importer.pack', label: 'Test Pack', run: importRun(), ...pack };
}

/** A Reindex job in whatever state a spec needs; the rest of the shape is filled in. */
export function reindexJob(job: Partial<ReindexJob> = {}): ReindexJob {
  return {
    status: 'idle',
    total: 0,
    walked: 0,
    reindexed: 0,
    failures: [],
    startedAt: null,
    finishedAt: null,
    error: null,
    ...job,
  };
}

/** Test double for {@link AdminClient} — the Superadmin operator surface: Reindex and compendium packs. */
export class MockAdminClient {
  reindex = vi.fn<() => Observable<ReindexJob>>(() => of(reindexJob({ status: 'running' })));
  reindexStatus = vi.fn<() => Observable<ReindexJob>>(() => of(reindexJob()));
  // Defaults to no packs, so a spec that only cares about the Reindex renders the panel and moves on.
  packs = vi.fn<() => Observable<CompendiumPackSummary[]>>(() => of<CompendiumPackSummary[]>([]));
  installPack = vi.fn<(importerId: string) => Observable<ImportRunSummary>>(() => of(importRun({ status: 'running' })));
  removePack = vi.fn<(importerId: string) => Observable<void>>(() => of(undefined));
}
