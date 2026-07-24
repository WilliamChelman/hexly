import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ReindexJob } from '@hexly/domain';

/**
 * HTTP client for the `/api/admin` repair surface (ADR-0046): the Reindex. The server
 * refuses it for anyone but a Superadmin. Account management lives in {@link UsersClient}.
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
}
