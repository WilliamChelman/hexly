import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CompendiumSummary } from '@hexly/domain';

/**
 * HTTP client for the installed **Compendiums** (CONTEXT.md → Compendium). Outside the World scope,
 * because a Compendium is: Instance-wide, with no members and the same answer for every signed-in
 * caller (ADR-0078).
 *
 * The Compendium browse reads it to learn which Containers to name — the browse names them explicitly
 * rather than riding single-Container scoping (ADR-0079) — and a pack's own page reads its terms off
 * the same row (#402).
 */
@Injectable({ providedIn: 'root' })
export class CompendiumsClient {
  private readonly http = inject(HttpClient);

  list(): Observable<CompendiumSummary[]> {
    return this.http.get<CompendiumSummary[]>('/api/compendiums');
  }

  /** One installed pack — the Compendium page's read. 404 when the id names no pack. */
  get(id: string): Observable<CompendiumSummary> {
    return this.http.get<CompendiumSummary>(`/api/compendiums/${id}`);
  }
}
