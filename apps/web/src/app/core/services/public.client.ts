import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { EntityDetail, PublicWorldView } from '@hexly/domain';

/**
 * HTTP client for the unauthenticated Public Link read surface (ADR-0037, #162). Hits the
 * token-scoped `/api/public/*` routes — no session, no cookie needed. Every call is strictly
 * read-only; a revoked or bad token is a 404 the caller renders as "link no longer active".
 */
@Injectable({ providedIn: 'root' })
export class PublicClient {
  private readonly http = inject(HttpClient);

  /** The one Entity behind a per-entity Public Link, read-only (pierces `private`). */
  entity(token: string): Observable<EntityDetail> {
    return this.http.get<EntityDetail>(`/api/public/entities/${token}`);
  }

  /** The World behind a World Public Link: its identity + `shared` Entity summaries. */
  world(token: string): Observable<PublicWorldView> {
    return this.http.get<PublicWorldView>(`/api/public/worlds/${token}`);
  }

  /** One `shared` Entity's read-only body, scoped to a World Public Link's World. */
  worldEntity(token: string, id: string): Observable<EntityDetail> {
    return this.http.get<EntityDetail>(`/api/public/worlds/${token}/entities/${id}`);
  }
}
