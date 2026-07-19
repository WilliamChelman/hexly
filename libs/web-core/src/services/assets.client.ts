import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AssetSummary } from '@hexly/domain';

/**
 * HTTP client for a World's Assets (ADR-0034). Stateless — every call is a round trip. Fronts the two
 * author-facing operations a Board Image element (#269) needs: {@link upload} mints a new World Asset
 * from a picked file in one step, and {@link list} enumerates the World's Assets so an author can pick
 * one already uploaded. Both return the served capability {@link AssetSummary.url} an Image element stores.
 */
@Injectable({ providedIn: 'root' })
export class AssetsClient {
  private readonly http = inject(HttpClient);

  /** Every Asset stored in `worldId`, for a picker. Reachable-gated server-side (404 → an error stream). */
  list(worldId: string): Observable<AssetSummary[]> {
    return this.http.get<AssetSummary[]>(`/api/worlds/${worldId}/assets`);
  }

  /**
   * Upload `file` into `worldId`, minting (or deduping to) a World Asset and returning its summary.
   * Don't set Content-Type — the browser must set the multipart boundary itself.
   */
  upload(worldId: string, file: File): Observable<AssetSummary> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<AssetSummary>(`/api/worlds/${worldId}/assets`, form);
  }
}
