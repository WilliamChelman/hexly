import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ImportSummary, WorldDetail, WorldSummary } from '@hexly/domain';

/**
 * HTTP client for the worlds API (ADR-0024). Stateless: every call is a round
 * trip. The active-World selection lives in {@link WorldStore}, not here.
 */
@Injectable({ providedIn: 'root' })
export class WorldsClient {
  private readonly http = inject(HttpClient);

  list(): Observable<WorldSummary[]> {
    return this.http.get<WorldSummary[]>('/api/worlds');
  }

  // Server mints the Home Entity atomically.
  create(name: string): Observable<WorldDetail> {
    return this.http.post<WorldDetail>('/api/worlds', { name });
  }

  /**
   * Import an Obsidian vault `.zip` into a fresh World (ADR-0033). Multipart under
   * the `file` field the server expects; the browser sets the multipart boundary,
   * so we deliberately don't touch Content-Type. Returns the {@link ImportSummary}.
   */
  importVault(file: File): Observable<ImportSummary> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<ImportSummary>('/api/worlds/import', form);
  }

  get(id: string): Observable<WorldDetail> {
    return this.http.get<WorldDetail>(`/api/worlds/${id}`);
  }

  /**
   * Export a World to a `.zip` of markdown + assets (ADR-0033, #150). The response is
   * a binary blob (`responseType: 'blob'`), which the caller saves as a download; the
   * filename is derived from the World's name rather than parsed from a header.
   */
  exportVault(id: string): Observable<Blob> {
    return this.http.get(`/api/worlds/${id}/export`, { responseType: 'blob' });
  }

  rename(id: string, name: string): Observable<WorldDetail> {
    return this.http.patch<WorldDetail>(`/api/worlds/${id}`, { name });
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/api/worlds/${id}`);
  }
}
