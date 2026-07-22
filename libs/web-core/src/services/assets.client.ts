import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AssetSummary, EntityDetail, EntityFacets } from '@hexly/domain';

/** The picker's caller-controlled search axes (#281): an FTS `q` and repeated `field` facet tokens. */
export interface AssetSearchParams {
  readonly q?: string;
  /** Field facet tokens (`orientation:eq:landscape`); the server pins the asset type + image kind on top. */
  readonly field?: readonly string[];
}

/**
 * HTTP client for a World's Assets (ADR-0034, ADR-0065). Stateless — every call is a round trip. Fronts
 * the author-facing operations a Board Image element (#269, #281) needs: {@link upload} mints (or dedups
 * to) an **Asset Entity** from a picked file in one step, returning the wrapper the caller reads the served
 * URL off; {@link search} runs the picker's entity-search (pinned server-side to the asset type + image
 * kind) so an author picks art by name + Facets; {@link facets} feeds the picker's Facet rail.
 */
@Injectable({ providedIn: 'root' })
export class AssetsClient {
  private readonly http = inject(HttpClient);

  /**
   * Search the image Assets stored in `worldId`, for the Board picker (#281). Same query contract as the
   * Asset Browser (`q` + `field` facet tokens); the server pins the asset type + image kind. Reachable-
   * gated server-side (404/403 → an error stream, which the picker degrades to an empty grid).
   */
  search(worldId: string, params: AssetSearchParams = {}): Observable<AssetSummary[]> {
    return this.http.get<AssetSummary[]>(`/api/worlds/${worldId}/assets`, { params: toHttpParams(params) });
  }

  /** The picker's Facet-rail counts for `worldId`'s image Assets (#281) — pinned like {@link search}. */
  facets(worldId: string, params: AssetSearchParams = {}): Observable<EntityFacets> {
    return this.http.get<EntityFacets>(`/api/worlds/${worldId}/assets/facets`, { params: toHttpParams(params) });
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

/** Serialise the picker's search axes to query params, repeating `field` and omitting an empty `q`. */
function toHttpParams({ q, field }: AssetSearchParams): HttpParams {
  let params = new HttpParams();
  if (q) params = params.set('q', q);
  for (const token of field ?? []) params = params.append('field', token);
  return params;
}
