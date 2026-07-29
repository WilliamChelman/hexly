import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { EntityDetail } from '@hexly/domain';

/**
 * HTTP client for a World's Assets (ADR-0034, ADR-0065). Stateless — every call is a round trip. One
 * operation, because an Asset is an Entity: {@link upload} mints (or dedups to) an **Asset Entity** from a
 * picked file in one step, returning the wrapper the caller reads the served URL off.
 *
 * *Reading* Assets is no business of this client. The asset pickers ask what every link picker asks —
 * what may this point at? — so they read through `EntitiesClient`'s one link-target read, preset to the
 * asset type, and Mount scope is resolved there once for all of them (ADR-0080, #416).
 */
@Injectable({ providedIn: 'root' })
export class AssetsClient {
  private readonly http = inject(HttpClient);

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
