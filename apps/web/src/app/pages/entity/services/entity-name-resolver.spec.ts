import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { EntityListParams } from '../../../core/services/entities.client';
import { EntityPage, EntitySummary } from '@hexly/domain';
import { EntitiesClient } from '../../../core/services/entities.client';
import { EntityNameResolver } from './entity-name-resolver';

function summary(id: string, name: string): EntitySummary {
  return {
    id,
    ownerId: 'me',
    name,
    type: 'note',
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
    vi.spyOn(client, 'list').mockReturnValue(
      of({ items: [summary('n1', 'Avalon')], nextCursor: null }),
    );

    const items = await resolver.search('aval');

    expect(client.list).toHaveBeenCalledWith({ q: 'aval', limit: 200 });
    expect(items.map((e) => e.id)).toEqual(['n1']);
  });
});
