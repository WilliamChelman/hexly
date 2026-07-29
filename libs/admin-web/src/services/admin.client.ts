import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CompendiumPackSummary, ImportRunSummary, ReindexJob } from '@hexly/domain';

/**
 * HTTP client for the `/api/admin` operator surface: the Reindex (ADR-0046) and the compendium packs
 * a **Compendium** is stocked from (ADR-0079, #404). The server refuses both for anyone but a
 * Superadmin. Account management lives in {@link UsersClient}.
 */
@Injectable({ providedIn: 'root' })
export class AdminClient {
  private readonly http = inject(HttpClient);

  /**
   * Start recomputing every Entity's document-derived state (ADR-0046). Returns at
   * once with the job `running`; follow it with {@link reindexStatus}.
   */
  reindex(): Observable<ReindexJob> {
    return this.http.post<ReindexJob>('/api/admin/reindex', {});
  }

  /** Where the instance's Reindex stands — polled while it runs, readable before it ever ran. */
  reindexStatus(): Observable<ReindexJob> {
    return this.http.get<ReindexJob>('/api/admin/reindex');
  }

  /**
   * Every compendium pack the Instance offers, with what is installed, at which revision, and where
   * its run stands (ADR-0079). The panel's list and its poll target both — one read answers both,
   * since a pack's run is the only thing about it that moves.
   */
  packs(): Observable<CompendiumPackSummary[]> {
    return this.http.get<CompendiumPackSummary[]>('/api/admin/compendiums');
  }

  /** Install (or reimport) a pack. Returns at once (202) with the run `running`; follow it with {@link packs}. */
  installPack(importerId: string): Observable<ImportRunSummary> {
    return this.http.post<ImportRunSummary>(`/api/admin/compendiums/${importerId}/run`, {});
  }

  /** Remove a pack: its entries go with it, and every adopted copy stays where it is. */
  removePack(importerId: string): Observable<void> {
    return this.http.delete<void>(`/api/admin/compendiums/${importerId}`);
  }
}
