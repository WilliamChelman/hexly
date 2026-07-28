import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { EntityListParams, EntitiesClient } from '@hexly/web-core';
import { EntityPage, EntitySummary } from '@hexly/domain';
import { EntityNameResolver } from './entity-name-resolver';

function summary(id: string, name: string): EntitySummary {
  return {
    id,
    worldId: 'w1',
    name,
    types: ['core.type.note'],
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 0,
    updatedAt: 0,
  };
}

// Records every list() call's params and lets a test resolve each in order, so it
// can assert "loading" before the batch lands and that only referenced ids are fetched.
let calls: EntityListParams[];
let pages: Subject<EntityPage>;

function createResolver(): EntityNameResolver {
  calls = [];
  pages = new Subject<EntityPage>();
  TestBed.configureTestingModule({
    providers: [
      EntityNameResolver,
      {
        provide: EntitiesClient,
        useValue: {
          list: (opts: EntityListParams) => {
            calls.push(opts);
            return pages;
          },
        },
      },
    ],
  });
  return TestBed.inject(EntityNameResolver);
}

const tick = () => new Promise((r) => queueMicrotask(r as () => void));

describe('EntityNameResolver', () => {
  it('reports loading until the id batch arrives', () => {
    const resolver = createResolver();
    // Synchronous: the fetch is deferred to a microtask, so the first read is loading.
    expect(resolver.resolve('e1').status).toBe('loading');
  });

  it('fetches only the referenced ids in one coalesced batch', async () => {
    const resolver = createResolver();
    resolver.resolve('e1');
    resolver.resolve('e2');
    await tick();

    expect(calls).toHaveLength(1);
    expect(calls[0].ids).toEqual(['e1', 'e2']);
  });

  it('resolves an id to its live name from the batch, not the stored label', async () => {
    const resolver = createResolver();
    resolver.resolve('e1');
    await tick();
    // The batch carries the renamed target; the link's frozen label is irrelevant here.
    pages.next({ items: [summary('e1', 'New Name')], nextCursor: null });

    const result = resolver.resolve('e1');
    expect(result.status).toBe('found');
    expect(result.status === 'found' && result.entity.name).toBe('New Name');
  });

  it('reports missing for an id the batch did not return (dangling)', async () => {
    const resolver = createResolver();
    resolver.resolve('gone');
    await tick();
    pages.next({ items: [], nextCursor: null });

    expect(resolver.resolve('gone').status).toBe('missing');
  });

  it('searches the server by query for the picker', async () => {
    const resolver = createResolver();
    const client = TestBed.inject(EntitiesClient) as unknown as {
      list: (opts: EntityListParams) => unknown;
    };
    vi.spyOn(client, 'list').mockReturnValue(of({ items: [summary('n1', 'Avalon')], nextCursor: null }));

    const items = await resolver.search('aval', 'w1');

    // includeHidden: the `@`-mention picker matches every Entity by name, Assets included (ADR-0065) —
    // the hidden-from-default-listing exclusion governs a browse, and this is not one.
    // read + worldId: a mention may point only at a link target in the host Entity's World, so typing a
    // name binds neither across Worlds (ADR-0073) nor onto a Compendium Entry (ADR-0079).
    expect(client.list).toHaveBeenCalledWith({
      q: 'aval',
      limit: 20,
      includeHidden: true,
      read: 'link-target',
      worldId: 'w1',
    });
    expect(items.map((e) => e.id)).toEqual(['n1']);
  });

  it('repeats a query from cache — a take-first search never revalidates', async () => {
    const resolver = createResolver();
    const client = TestBed.inject(EntitiesClient) as unknown as { list: (opts: EntityListParams) => unknown };
    const list = vi.spyOn(client, 'list').mockReturnValue(of({ items: [], nextCursor: null }));

    await resolver.search('zorblax');
    await resolver.search('zorblax');

    expect(list).toHaveBeenCalledTimes(1);
  });

  it('re-searches after forgetSearches, so an Entity just minted from a mention is offered (ADR-0073)', async () => {
    const resolver = createResolver();
    const client = TestBed.inject(EntitiesClient) as unknown as { list: (opts: EntityListParams) => unknown };
    const list = vi
      .spyOn(client, 'list')
      .mockReturnValueOnce(of({ items: [], nextCursor: null }))
      .mockReturnValueOnce(of({ items: [summary('n2', 'Zorblax')], nextCursor: null }));

    expect(await resolver.search('zorblax')).toEqual([]);
    resolver.forgetSearches();

    expect((await resolver.search('zorblax')).map((e) => e.id)).toEqual(['n2']);
    expect(list).toHaveBeenCalledTimes(2);
  });
});
