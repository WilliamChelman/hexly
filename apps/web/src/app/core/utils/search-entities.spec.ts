import { Subject, firstValueFrom, of, share, throwError } from 'rxjs';
import { EntitySummary } from '@hexly/domain';
import { EntitiesClient } from '../services/entities.client';
import { searchEntities } from './search-entities';

function summary(id: string, name = id): EntitySummary {
  return {
    id,
    name,
    worldId: 'w1',
    ownerId: 'u1',
    type: 'note',
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
    const list = vi
      .fn()
      .mockReturnValue(of({ items: [summary('n1')], nextCursor: null }));
    const query$ = new Subject<string>();
    const result = firstValueFrom(
      searchEntities({ list } as unknown as EntitiesClient, query$).pipe(share()),
    );
    query$.next('a');

    expect(await result).toEqual([summary('n1')]);
    expect(list).toHaveBeenCalledWith({ q: 'a', limit: 20 });
  });

  it('paints a repeated query from cache without revalidating for take-first consumers', async () => {
    // firstValueFrom unsubscribes on the cached paint, so the revalidation request
    // is never fired — the tiptap picker path (short-lived, per-surface).
    const list = vi
      .fn()
      .mockReturnValue(of({ items: [summary('n1')], nextCursor: null }));
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

  it('paints the cache then revalidates, replacing the results when they change', async () => {
    const list = vi
      .fn()
      .mockReturnValueOnce(of({ items: [summary('n1', 'Old')], nextCursor: null }))
      .mockReturnValueOnce(of({ items: [summary('n1', 'New')], nextCursor: null }));
    const query$ = new Subject<string>();
    const emissions: EntitySummary[][] = [];
    const sub = searchEntities(
      { list } as unknown as EntitiesClient,
      query$,
    ).subscribe((v) => emissions.push(v));

    query$.next('a');
    await settle();
    query$.next('a');
    await settle();
    sub.unsubscribe();

    expect(emissions.map((r) => r[0].name)).toEqual(['Old', 'Old', 'New']);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('does not re-emit when a revalidation returns unchanged results', async () => {
    const list = vi
      .fn()
      .mockReturnValue(of({ items: [summary('n1', 'Same')], nextCursor: null }));
    const query$ = new Subject<string>();
    const emissions: EntitySummary[][] = [];
    const sub = searchEntities(
      { list } as unknown as EntitiesClient,
      query$,
    ).subscribe((v) => emissions.push(v));

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
    const sub = searchEntities(
      { list } as unknown as EntitiesClient,
      query$,
    ).subscribe((v) => emissions.push(v));

    query$.next('a');
    await settle();
    query$.next('a'); // revalidation errors → cached paint stands, no blank
    await settle();
    sub.unsubscribe();

    expect(emissions.map((r) => r.map((e) => e.name))).toEqual([
      ['Old'],
      ['Old'],
    ]);
  });
});
