import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
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

/** A controllable list() so a test can assert "loading" before the page arrives. */
let pages: Subject<EntityPage>;

function createResolver(): EntityNameResolver {
  pages = new Subject<EntityPage>();
  TestBed.configureTestingModule({
    providers: [
      EntityNameResolver,
      { provide: EntitiesClient, useValue: { list: () => pages } },
    ],
  });
  const resolver = TestBed.inject(EntityNameResolver);
  // The fetch is lazy: a node view/picker reading the resolver kicks it off.
  resolver.all();
  return resolver;
}

describe('EntityNameResolver', () => {
  it('reports loading until the shared owner list arrives', () => {
    const resolver = createResolver();
    expect(resolver.resolve('e1').status).toBe('loading');
  });

  it('resolves an id to its live name from the list, not the stored label', () => {
    const resolver = createResolver();
    // The list carries the renamed target; the link's frozen label is irrelevant here.
    pages.next({ items: [summary('e1', 'New Name')], nextCursor: null });

    const result = resolver.resolve('e1');
    expect(result.status).toBe('found');
    expect(result.status === 'found' && result.entity.name).toBe('New Name');
  });

  it('reports missing for an id absent from the loaded list (dangling)', () => {
    const resolver = createResolver();
    pages.next({ items: [summary('e1', 'Avalon')], nextCursor: null });

    expect(resolver.resolve('gone').status).toBe('missing');
  });
});
