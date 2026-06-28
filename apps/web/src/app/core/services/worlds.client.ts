import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { WorldDetail, WorldSummary } from '@hexly/domain';

/**
 * HTTP client for the worlds API (ADR-0024). Stateless: every call is a round
 * trip. The active-World selection lives in {@link WorldStore}, not here.
 */
@Injectable({ providedIn: 'root' })
export class WorldsClient {
  private readonly http = inject(HttpClient);

  /** The caller's owned + member worlds (ADR-0024). */
  list(): Observable<WorldSummary[]> {
    return this.http.get<WorldSummary[]>('/api/worlds');
  }

  /** Create a World; the server mints its Home Entity atomically. */
  create(name: string): Observable<WorldDetail> {
    return this.http.post<WorldDetail>('/api/worlds', { name });
  }

  get(id: string): Observable<WorldDetail> {
    return this.http.get<WorldDetail>(`/api/worlds/${id}`);
  }

  rename(id: string, name: string): Observable<WorldDetail> {
    return this.http.patch<WorldDetail>(`/api/worlds/${id}`, { name });
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/api/worlds/${id}`);
  }
}
