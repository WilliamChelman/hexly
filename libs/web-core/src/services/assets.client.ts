import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AssetSummary, EntityDetail } from '@hexly/domain';

/**
 * HTTP client for a World's Assets (ADR-0034, ADR-0065). Stateless — every call is a round trip. Fronts
 * the two author-facing operations a Board Image element (#269) needs: {@link upload} mints (or dedups to)
 * an **Asset Entity** from a picked file in one step, returning the wrapper the caller reads the served
 * URL off; {@link list} enumerates the World's Assets as {@link AssetSummary}s so an author can pick one
 * already uploaded.
 */
@Injectable({ providedIn: 'root' })
export class AssetsClient {
  private readonly http = inject(HttpClient);

  /** Every Asset stored in `worldId`, for a picker. Reachable-gated server-side (404 → an error stream). */
  list(worldId: string): Observable<AssetSummary[]> {
    return this.http.get<AssetSummary[]>(`/api/worlds/${worldId}/assets`);
  }

  /**
   * Upload `file` into `worldId`, minting (or deduping to) an Asset and returning the wrapper Entity
   * (ADR-0065) — the caller reads its served capability URL off the asset-ref. Don't set Content-Type —
   * the browser must set the multipart boundary itself.
   */
  upload(worldId: string, file: File): Observable<EntityDetail> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<EntityDetail>(`/api/worlds/${worldId}/assets`, form);
  }
}
