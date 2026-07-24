import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, defer, finalize } from 'rxjs';
import { EntityDetail, EntityNudge, PublicWorldView, StaleNudge } from '@hexly/domain';
import { NudgeBusClient } from './nudge-bus.client';
import { WORLD_NUDGE_DEBOUNCE_MS } from './worlds.client';
import { ENTITY_NUDGE_DEBOUNCE_MS } from './entities.client';
import { Watched, watchResource } from './live-follow';

/** Which token-scoped read backs a followed public Entity: a bare per-entity link, or one under a World link. */
export type PublicEntityMode = 'entity' | 'worldEntity';

/**
 * HTTP client for the unauthenticated Public Link read surface (ADR-0037). Hits the token-scoped
 * `/api/public/*` routes — no session, no cookie needed. Every call is strictly read-only; a
 * revoked or bad token is a 404 the caller renders as "link no longer active". Also fronts the
 * live-follow bus for public readers, owning the anonymous-token principal for the follow's
 * lifetime.
 */
@Injectable({ providedIn: 'root' })
export class PublicClient {
  private readonly http = inject(HttpClient);
  private readonly bus = inject(NudgeBusClient);

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

  /**
   * Live-follow a World a public reader has open. Emits the fresh view, or `EVICTED` when the link
   * is revoked / the World deleted. A public World read never version-gates, so it always refetches.
   */
  watchWorld(token: string, worldId: string): Observable<Watched<PublicWorldView>> {
    return this.followAsToken(token, () =>
      watchResource({
        follow: this.bus.follow({ kind: 'world', id: worldId }),
        fetch: () => this.world(token),
        debounceMs: WORLD_NUDGE_DEBOUNCE_MS,
      }),
    );
  }

  /**
   * Live-follow an Entity a public reader has open — a bare per-entity link (`mode: 'entity'`) or
   * one scoped to a World link (`mode: 'worldEntity'`). Owns the token principal like
   * {@link watchWorld}; `shouldRefetch` is the reader's newer-than-held gate.
   */
  watchEntity(
    token: string,
    mode: PublicEntityMode,
    id: string,
    shouldRefetch: (n: EntityNudge | StaleNudge) => boolean = () => true,
  ): Observable<Watched<EntityDetail>> {
    return this.followAsToken(token, () =>
      watchResource({
        follow: this.bus.follow({ kind: 'entity', id }),
        fetch: () => (mode === 'worldEntity' ? this.worldEntity(token, id) : this.entity(token)),
        debounceMs: ENTITY_NUDGE_DEBOUNCE_MS,
        shouldRefetch: (n) => shouldRefetch(n as EntityNudge | StaleNudge),
      }),
    );
  }

  /**
   * Pin the bus to an anonymous `token` principal for a follow's subscription, reverting to the
   * cookie principal on teardown — so a signed-in reader who opened their own link doesn't keep
   * connecting as that token after leaving.
   */
  private followAsToken<T>(token: string, follow: () => Observable<T>): Observable<T> {
    return defer(() => {
      this.bus.useToken(token);
      return follow();
    }).pipe(finalize(() => this.bus.useToken(null)));
  }
}
