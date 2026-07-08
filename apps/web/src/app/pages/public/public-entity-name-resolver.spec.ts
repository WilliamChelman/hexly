import { TestBed } from '@angular/core/testing';
import { EntitiesClient } from '@hexly/web-core';
import { EntityNameResolver } from '@hexly/content-editor';
import { PublicEntityNameResolver } from './public-entity-name-resolver';

const tick = () => new Promise((r) => queueMicrotask(r as () => void));

describe('PublicEntityNameResolver', () => {
  it('resolves every in-content link to missing without ever touching /api/entities', async () => {
    // A Public Link is a capability: resolving a cross-reference would read another Entity's
    // summary and widen the token's scope, so the public resolver looks nothing up — the link
    // renders as its frozen label (dangling), and the authenticated client is never called.
    const list = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: EntityNameResolver, useClass: PublicEntityNameResolver },
        { provide: EntitiesClient, useValue: { list } },
      ],
    });
    const resolver = TestBed.inject(EntityNameResolver);

    resolver.resolve('other-entity');
    await tick();

    expect(resolver.resolve('other-entity').status).toBe('missing');
    expect(list).not.toHaveBeenCalled();
  });
});
