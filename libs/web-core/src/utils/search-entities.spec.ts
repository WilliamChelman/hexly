import { Subject, firstValueFrom, of, share, throwError } from 'rxjs';
import { EntitySummary } from '@hexly/domain';
import { EntitiesClient } from '../services/entities.client';
import { searchEntities } from './search-entities';

function summary(id: string, name = id): EntitySummary {
  return {
    id,
    name,
    worldId: 'w1',
    types: ['core.type.note'],
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

/** Wait past the debounce window so a queued query fires before the next push. */
const settle = () => new Promise((r) => setTimeout(r, 250));

describe('searchEntities', () => {
  it('caps the page for autocomplete', async () => {
    const list = vi.fn().mockReturnValue(of({ items: [summary('n1')], nextCursor: null }));
    const query$ = new Subject<string>();
    const result = firstValueFrom(searchEntities({ list } as unknown as EntitiesClient, query$).pipe(share()));
    query$.next('a');

    expect(await result).toEqual([summary('n1')]);
    expect(list).toHaveBeenCalledWith({ q: 'a', limit: 20, includeHidden: true });
  });

  /**
   * A by-name picker is no browse, so it opts into hidden-from-default-listing types (ADR-0065) — an Asset
   * stays reachable by name here even though the Entity Browser's own search box no longer surfaces it.
   */
  it('opts into hidden-from-default-listing types on every search', async () => {
    const list = vi.fn().mockReturnValue(of({ items: [summary('n1')], nextCursor: null }));
    const query$ = new Subject<string>();
    const result = firstValueFrom(searchEntities({ list } as unknown as EntitiesClient, query$).pipe(share()));
    query$.next('a');

    await result;
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ includeHidden: true }));
  });

  it('opts the read into thumbnails when asked', async () => {
    const list = vi.fn().mockReturnValue(of({ items: [summary('n1')], nextCursor: null }));
    const query$ = new Subject<string>();
    const result = firstValueFrom(
      searchEntities({ list } as unknown as EntitiesClient, query$, { thumbnails: true }).pipe(share()),
    );
    query$.next('a');

    await result;
    expect(list).toHaveBeenCalledWith({ q: 'a', limit: 20, includeHidden: true, thumbnails: true });
  });

  it('revalidates a repeated query when only the thumbnail changed', async () => {
    // A re-minted Thumbnail (ADR-0066) is render-bearing, so equality must not treat it as unchanged.
    const list = vi
      .fn()
      .mockReturnValueOnce(of({ items: [{ ...summary('n1'), thumbnailUrl: '/old' }], nextCursor: null }))
      .mockReturnValueOnce(of({ items: [{ ...summary('n1'), thumbnailUrl: '/new' }], nextCursor: null }));
    const query$ = new Subject<string>();
    const emissions: EntitySummary[][] = [];
    const sub = searchEntities({ list } as unknown as EntitiesClient, query$, { thumbnails: true }).subscribe((v) =>
      emissions.push(v),
    );

    query$.next('a');
    await settle();
    query$.next('a');
    await settle();
    sub.unsubscribe();

    expect(emissions.map((r) => r[0].thumbnailUrl)).toEqual(['/old', '/old', '/new']);
  });

  it('paints a repeated query from cache without revalidating for take-first consumers', async () => {
    // firstValueFrom unsubscribes on the cached paint, so the revalidation request
    // is never fired — the tiptap picker path (short-lived, per-surface).
    const list = vi.fn().mockReturnValue(of({ items: [summary('n1')], nextCursor: null }));
    const client = { list } as unknown as EntitiesClient;
    const query$ = new Subject<string>();
    const results$ = searchEntities(client, query$).pipe(share());

    const first = firstValueFrom(results$);
    query$.next('a');
    await first;

    const second = firstValueFrom(results$);
    query$.next('a');
    expect(await second).toEqual([summary('n1')]);

    expect(list).toHaveBeenCalledTimes(1);
  });

  it('memoises into a supplied cache, so its owner can forget a miss (ADR-0073)', async () => {
    const list = vi.fn().mockReturnValue(of({ items: [summary('n1')], nextCursor: null }));
    const client = { list } as unknown as EntitiesClient;
    const query$ = new Subject<string>();
    const cache = new Map<string, EntitySummary[]>();
    const results$ = searchEntities(client, query$, { cache }).pipe(share());

    const first = firstValueFrom(results$);
    query$.next('a');
    await first;
    expect(cache.get('a')).toEqual([summary('n1')]);

    // Cleared: the next identical query has nothing to paint from and hits the server again.
    cache.clear();
    const second = firstValueFrom(results$);
    query$.next('a');
    await second;

    expect(list).toHaveBeenCalledTimes(2);
  });

  it('paints the cache then revalidates, replacing the results when they change', async () => {
    const list = vi
      .fn()
      .mockReturnValueOnce(of({ items: [summary('n1', 'Old')], nextCursor: null }))
      .mockReturnValueOnce(of({ items: [summary('n1', 'New')], nextCursor: null }));
    const query$ = new Subject<string>();
    const emissions: EntitySummary[][] = [];
    const sub = searchEntities({ list } as unknown as EntitiesClient, query$).subscribe((v) => emissions.push(v));

    query$.next('a');
    await settle();
    query$.next('a');
    await settle();
    sub.unsubscribe();

    expect(emissions.map((r) => r[0].name)).toEqual(['Old', 'Old', 'New']);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('does not re-emit when a revalidation returns unchanged results', async () => {
    const list = vi.fn().mockReturnValue(of({ items: [summary('n1', 'Same')], nextCursor: null }));
    const query$ = new Subject<string>();
    const emissions: EntitySummary[][] = [];
    const sub = searchEntities({ list } as unknown as EntitiesClient, query$).subscribe((v) => emissions.push(v));

    query$.next('a');
    await settle();
    query$.next('a'); // cache paint == revalidated result → one emission, not two
    await settle();
    sub.unsubscribe();

    expect(emissions).toHaveLength(2);
  });

  it('keeps the cached results when a revalidation fails', async () => {
    const list = vi
      .fn()
      .mockReturnValueOnce(of({ items: [summary('n1', 'Old')], nextCursor: null }))
      .mockReturnValueOnce(throwError(() => new Error('boom')));
    const query$ = new Subject<string>();
    const emissions: EntitySummary[][] = [];
    const sub = searchEntities({ list } as unknown as EntitiesClient, query$).subscribe((v) => emissions.push(v));

    query$.next('a');
    await settle();
    query$.next('a'); // revalidation errors → cached paint stands, no blank
    await settle();
    sub.unsubscribe();

    expect(emissions.map((r) => r.map((e) => e.name))).toEqual([['Old'], ['Old']]);
  });
});
