import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, from, map, switchMap } from 'rxjs';
import { WorldDetail, WorldSummary } from '@hexly/domain';
import { TrailbaseClient } from './trailbase-client';
import { EntityRow } from '../models/entity-row';
import { WorldRow } from '../models/world-row';
import { toWorldSummary } from '../utils/tb-records';

// ponytail: one page covers any realistic owner's Worlds; switch to cursor paging
// only if a user ever holds more than this many.
const WORLDS_PAGE = 256;

/**
 * Owner-scoped Worlds over the TrailBase `worlds` Record API (ADR-0032, ADR-0024).
 * Stateless: every call is a round trip. A {@link WorldDetail} is *composed* here —
 * the `worlds` row has no Home Entity id or count of its own (the Home is the
 * `is_home` Entity, ADR-0024), so `get`/`create` derive them from the `entities`
 * API. The active-World selection lives in the URL/{@link WorldStore}, not here.
 */
@Injectable({ providedIn: 'root' })
export class WorldsClient {
  private readonly tb = inject(TrailbaseClient);
  private readonly worlds = this.tb.client.records<WorldRow>('worlds');
  private readonly entities = this.tb.client.records<EntityRow>('entities');

  /** The caller's Worlds (owner-scoped by the API's read rule), newest first. */
  list(): Observable<WorldSummary[]> {
    return from(
      this.worlds.list({ order: ['-updated_at'], pagination: { limit: WORLDS_PAGE } }),
    ).pipe(map((res) => res.records.map(toWorldSummary)));
  }

  /** Create a World; the `AFTER INSERT` trigger mints its Home Entity atomically. */
  create(name: string): Observable<WorldDetail> {
    return from(this.worlds.create({ name } as unknown as WorldRow)).pipe(
      switchMap((id) => this.get(String(id))),
    );
  }

  get(id: string): Observable<WorldDetail> {
    return forkJoin({
      world: from(this.worlds.read(id)),
      home: from(
        this.entities.list({
          filters: [
            { column: 'world_id', value: id },
            { column: 'is_home', value: '1' },
          ],
          pagination: { limit: 1 },
        }),
      ),
      count: from(
        this.entities.list({
          filters: [{ column: 'world_id', value: id }],
          count: true,
          pagination: { limit: 1 },
        }),
      ),
    }).pipe(
      map(({ world, home, count }) => ({
        ...toWorldSummary(world),
        homeEntityId: home.records[0]?.id ?? '',
        entityCount: count.total_count ?? 0,
      })),
    );
  }

  /** Rename a World; the `AFTER UPDATE` trigger follows the Home note's title (ADR-0029). */
  rename(id: string, name: string): Observable<WorldDetail> {
    return from(this.worlds.update(id, { name } as Partial<WorldRow>)).pipe(
      switchMap(() => this.get(id)),
    );
  }

  /** Delete a World; the `world_id` FK cascade drops its Entities (Home included). */
  delete(id: string): Observable<void> {
    return from(this.worlds.delete(id)).pipe(map(() => undefined));
  }
}
