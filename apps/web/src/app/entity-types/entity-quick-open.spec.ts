import { EnvironmentInjector, createEnvironmentInjector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, firstValueFrom, of, skip, throwError } from 'rxjs';
import { EntitySummary, Mount, defineField } from '@hexly/domain';
import { ActiveWorld, EntitiesClient, WorldsClient } from '@hexly/web-core';
import { MockEntitiesClient, MockWorldsClient } from '@hexly/web-core/testing';
import { CommandRegistry } from '@hexly/command-palette-web';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { TypeRegistry } from './type-registry';
import { EntityQuickOpen } from './entity-quick-open';

function entity(id: string, name: string, worldId = 'w1', over: Partial<EntitySummary> = {}): EntitySummary {
  return {
    id,
    name,
    worldId,
    types: ['core.type.note'],
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

/**
 * Quick Open searches the World the reader is in and the **Containers** it **Mounts** (ADR-0083), and
 * exists only under the `/w/:worldId` lifetime — so the Palette outside a World offers Worlds and
 * Commands and no Entities. Both are read here rather than in an e2e: the scope is on the wire and the
 * absence is a registration, and both are fully observable at this seam.
 */
describe('EntityQuickOpen', () => {
  /** An installed pack and a mounted Shelf — the two kinds of Container a Mount names (ADR-0080). */
  const pack: Mount = { containerId: 'c-pack', name: 'Draw Steel: Monsters', kind: 'compendium' };
  const shelf: Mount = { containerId: 'c-shelf', name: 'The Art Shelf', kind: 'world' };
  /** A Field the active World defines — resolvable as a Facet key only because the Palette has a World. */
  const regionField = defineField({
    id: 'world.field.region',
    label: 'Region',
    dataType: { kind: 'string' },
    facetable: true,
  });

  let entitiesClient: MockEntitiesClient;
  let worldsClient: MockWorldsClient;
  let worldId: ReturnType<typeof signal<string | null>>;
  let navigate: ReturnType<typeof vi.spyOn>;
  let registry: CommandRegistry;
  let types: TypeRegistry;
  /** The World route's injector — this Provider's lifetime, destroyed on leaving the World scope. */
  let worldScope: EnvironmentInjector | undefined;

  beforeEach(() => {
    // Left to the TestBed's own reset, which destroys the injectors it parents.
    worldScope = undefined;
    entitiesClient = new MockEntitiesClient();
    worldsClient = new MockWorldsClient();
    worldId = signal<string | null>(null);
    TestBed.configureTestingModule({
      // The real TypeRegistry, whose Fields resolve a Facet Token's key (ADR-0082); its type chrome
      // resolves through Transloco.
      imports: [provideTranslocoTesting()],
      providers: [
        provideRouter([]),
        { provide: EntitiesClient, useValue: entitiesClient },
        { provide: WorldsClient, useValue: worldsClient },
        { provide: ActiveWorld, useValue: { worldId } },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    registry = TestBed.inject(CommandRegistry);
    types = TestBed.inject(TypeRegistry);
    // What the WorldFieldsLoader projects on entering a World (ADR-0054) — the Fields this World defines.
    types.setWorldFields([regionField]);
  });

  /** Enter the World scope: what the route's providers do on activation. */
  function enterWorld(id = 'w1', mounts: Observable<Mount[]> = of([])): EntityQuickOpen {
    worldsClient.mounts.mockReturnValue(mounts);
    worldId.set(id);
    worldScope ??= createEnvironmentInjector([EntityQuickOpen], TestBed.inject(EnvironmentInjector));
    const provider = worldScope.get(EntityQuickOpen);
    TestBed.flushEffects(); // the World-change effect -> the Mount read
    return provider;
  }

  it('answers the empty (Quick Open) prefix', () => {
    expect(enterWorld().prefix).toBe('');
  });

  it('scopes the search to the reader’s World and what it Mounts, opting into thumbnails and hidden types', async () => {
    const provider = enterWorld('w1', of([pack, shelf]));
    entitiesClient.list.mockReturnValue(of({ items: [entity('e1', 'Aldermoor')], nextCursor: null }));

    const commands = await firstValueFrom(provider.search('alder'));

    // The World rides `worldId` and its Mounts ride `containerId` — the same scope under the two names
    // the wire knows it by (ADR-0080). An Entity in an unrelated World is out of scope server-side and
    // never reaches the Palette.
    // includeHidden: Quick Open matches an Asset by name like any Entity (ADR-0065), unlike a browse —
    // the server ranks those matches last, so they never crowd the top of the palette.
    expect(entitiesClient.list).toHaveBeenCalledWith({
      q: 'alder',
      limit: 20,
      includeHidden: true,
      thumbnails: true,
      worldId: 'w1',
      containerId: ['c-pack', 'c-shelf'],
    });
    expect(commands).toEqual([expect.objectContaining({ id: 'e1', label: 'Aldermoor' })]);
  });

  it('searches the World alone where it Mounts nothing', async () => {
    const provider = enterWorld('w1', of([]));
    entitiesClient.list.mockReturnValue(of({ items: [], nextCursor: null }));

    await firstValueFrom(provider.search('alder'));

    expect(entitiesClient.list).toHaveBeenCalledWith(expect.objectContaining({ worldId: 'w1' }));
    expect(entitiesClient.list).toHaveBeenCalledWith(expect.not.objectContaining({ containerId: expect.anything() }));
  });

  it('searches the World alone when the Mount set is withheld — a reader here through someone else’s Mount', async () => {
    const provider = enterWorld(
      'w1',
      throwError(() => new HttpErrorResponse({ status: 403 })),
    );
    entitiesClient.list.mockReturnValue(of({ items: [], nextCursor: null }));

    await firstValueFrom(provider.search('alder'));

    // Silent: nothing went wrong for this reader, and an overlay is no place to say so.
    expect(entitiesClient.list).toHaveBeenCalledWith(expect.objectContaining({ worldId: 'w1' }));
  });

  it('re-reads the Mount set on a World switch — the route survives one', async () => {
    const provider = enterWorld('w1', of([pack]));
    entitiesClient.list.mockReturnValue(of({ items: [entity('e1', 'Aldermoor')], nextCursor: null }));
    await firstValueFrom(provider.search('alder'));

    worldsClient.mounts.mockReturnValue(of([shelf]));
    worldId.set('w2');
    TestBed.flushEffects();
    entitiesClient.list.mockReturnValue(of({ items: [entity('e2', 'Goblin King', 'w2')], nextCursor: null }));
    // skip(1): the last results are replayed until the new search lands (stale-while-revalidate).
    const commands = await firstValueFrom(provider.search('goblin').pipe(skip(1)));

    expect(worldsClient.mounts).toHaveBeenCalledWith('w2');
    expect(entitiesClient.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'goblin', worldId: 'w2', containerId: ['c-shelf'] }),
    );
    expect(commands).toEqual([expect.objectContaining({ id: 'e2' })]);
  });

  it("threads the summary's resolved thumbnailUrl onto the command", async () => {
    const provider = enterWorld();
    entitiesClient.list.mockReturnValue(
      of({ items: [{ ...entity('e1', 'Aldermoor'), thumbnailUrl: '/api/assets/a1/thumb' }], nextCursor: null }),
    );

    const [command] = await firstValueFrom(provider.search('alder'));

    expect(command.thumbnailUrl).toBe('/api/assets/a1/thumb');
  });

  it('leaves thumbnailUrl undefined when the summary carries none', async () => {
    const provider = enterWorld();
    entitiesClient.list.mockReturnValue(of({ items: [entity('e1', 'Aldermoor')], nextCursor: null }));

    const [command] = await firstValueFrom(provider.search('alder'));

    expect(command.thumbnailUrl).toBeUndefined();
  });

  it('skips the request for a blank query', async () => {
    const provider = enterWorld();

    const commands = await firstValueFrom(provider.search('  '));

    expect(entitiesClient.list).not.toHaveBeenCalled();
    expect(commands).toEqual([]);
  });

  it("navigates to the matched Entity's own World when picked", async () => {
    const provider = enterWorld('w1', of([shelf]));
    // An Entity of a Mounted World has a World of its own and opens under it (ADR-0080).
    entitiesClient.list.mockReturnValue(of({ items: [entity('e1', 'Aldermoor', 'c-shelf')], nextCursor: null }));

    const [command] = await firstValueFrom(provider.search('alder'));
    command.run();

    expect(navigate).toHaveBeenCalledWith(['/w', 'c-shelf', 'entities', 'e1']);
  });

  it('opens a Compendium Entry from a Mounted Compendium under the reader’s World', async () => {
    const provider = enterWorld('w1', of([pack]));
    // A **Sealed** entry has no World of its own (ADR-0079), so the segment is navigation context: the
    // World it is read from, and the one an **Adoption** would copy it into.
    entitiesClient.list.mockReturnValue(
      of({ items: [entity('e1', 'Goblin Warrior', 'c-pack', { sealed: true })], nextCursor: null }),
    );

    const [command] = await firstValueFrom(provider.search('goblin'));
    command.run();

    expect(command.route).toEqual(['/w', 'w1', 'entities', 'e1']);
    expect(navigate).toHaveBeenCalledWith(['/w', 'w1', 'entities', 'e1']);
  });

  /**
   * A **Facet Token** typed into Quick Open narrows it like any other Entity search box (ADR-0082). Read
   * on the wire: what the params carry is what the reader sees narrowed, and the residual text is what is
   * left to search for.
   */
  describe('Facet Tokens', () => {
    beforeEach(() => {
      entitiesClient.list.mockReturnValue(of({ items: [], nextCursor: null }));
    });

    it('lifts a token out of the box and sends it as a filter, searching for the text that is left', async () => {
      const provider = enterWorld('w1', of([pack]));

      await firstValueFrom(provider.search('orc $type:core.type.note'));

      expect(entitiesClient.list).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'orc', type: ['core.type.note'], worldId: 'w1', containerId: ['c-pack'] }),
      );
    });

    it('sends an exclusion, which vetoes', async () => {
      const provider = enterWorld();

      await firstValueFrom(provider.search('-$tag:draft'));

      // Nothing left to search for: a box holding only tokens is a filter, not a query.
      expect(entitiesClient.list).toHaveBeenCalledWith(expect.objectContaining({ q: '', excludeTag: ['draft'] }));
    });

    it('resolves a Field the active World defines — the vocabulary a World scope buys (ADR-0083)', async () => {
      const provider = enterWorld();

      await firstValueFrom(provider.search('$world.field.region:Ashfen'));

      expect(entitiesClient.list).toHaveBeenCalledWith(
        expect.objectContaining({ field: ['world.field.region:eq:Ashfen'] }),
      );
    });

    /**
     * The keys resolve synchronously off the registry, and a late response may never change what a
     * filter means (ADR-0082) — so a box naming a Field waits for the World's Fields instead of being
     * answered with the unfiltered list, which the cache would then hold under the narrowing query.
     */
    it('waits for the World’s Fields rather than answering a narrowing box unfiltered', async () => {
      // Entering a World: the loader has asked, and nothing has answered yet.
      types.setWorldFields([]);
      types.awaitWorldFields();
      const provider = enterWorld();

      const commands = firstValueFrom(provider.search('$world.field.region:Ashfen'));
      types.setWorldFields([regionField]);
      TestBed.flushEffects();
      await commands;

      // One read, and it is the narrowed one: the unfiltered answer was never given, so nothing
      // memoised it under the query that was meant to narrow it.
      expect(entitiesClient.list).toHaveBeenCalledTimes(1);
      expect(entitiesClient.list).toHaveBeenCalledWith(
        expect.objectContaining({ field: ['world.field.region:eq:Ashfen'] }),
      );
    });

    it('never waits on the Fields read for a box the reserved names decide', async () => {
      types.setWorldFields([]);
      types.awaitWorldFields();
      const provider = enterWorld();

      await firstValueFrom(provider.search('orc $type:core.type.note'));

      expect(entitiesClient.list).toHaveBeenCalledWith(expect.objectContaining({ q: 'orc', type: ['core.type.note'] }));
    });

    it('offers the reserved names and the World’s own Facet keys, synchronously', () => {
      const provider = enterWorld();

      // `in` included: the scope spans the World and its Mounts, so naming one Container narrows within
      // it — which is not true of a browse scoped to a single Container.
      expect(provider.facetKeys()).toEqual({
        reserved: ['type', 'tag', 'visibility', 'in'],
        fields: ['world.field.region'],
      });
    });

    it('narrows within the Mount scope when a Container is named, never widening it', async () => {
      const provider = enterWorld('w1', of([pack, shelf]));

      await firstValueFrom(provider.search('$in:c-pack'));

      // `container`, the drill-down within the scope — not `containerId`, which *is* the scope: a token
      // can never reach a Container the reader's World does not Mount (ADR-0083).
      expect(entitiesClient.list).toHaveBeenCalledWith(
        expect.objectContaining({
          container: ['c-pack'],
          worldId: 'w1',
          containerId: ['c-pack', 'c-shelf'],
        }),
      );
    });

    it('issues no Facet read of its own — key typeahead only, whatever is typed', async () => {
      const provider = enterWorld();

      await firstValueFrom(provider.search('$type:'));
      await firstValueFrom(provider.search('$type:core.type.note'));

      // Its scope would make this several grouped counts per keystroke — the one place the otherwise
      // free read is not free (ADR-0082).
      expect(entitiesClient.facets).not.toHaveBeenCalled();
    });

    it('leaves a `$` name nothing answers to out of the filters, and out of the text searched for', async () => {
      const provider = enterWorld();

      await firstValueFrom(provider.search('orc $domain:material'));

      // Reported by the Palette rather than silently searched for as text (ADR-0082).
      expect(entitiesClient.list).toHaveBeenCalledWith(expect.objectContaining({ q: 'orc' }));
      expect(entitiesClient.list).toHaveBeenCalledWith(expect.not.objectContaining({ field: expect.anything() }));
    });
  });

  describe('outside a World', () => {
    it('offers the Palette no Entity section at all — the Provider is gone with its scope', async () => {
      enterWorld();
      expect(registry.prefixes()).toEqual(['']);

      // Leaving the World scope destroys the route's injector; `clearActiveWorld` unpins the World.
      worldScope?.destroy();
      worldScope = undefined;
      worldId.set(null);

      expect(registry.prefixes()).toEqual([]);
      await expect(firstValueFrom(registry.search('', 'alder'))).resolves.toEqual([]);
      expect(entitiesClient.list).not.toHaveBeenCalled();
    });

    it('never searches unscoped while the World is unpinned', async () => {
      const provider = enterWorld();
      worldId.set(null);

      const commands = await firstValueFrom(provider.search('alder'));

      // An unscoped read is the global search ADR-0083 removes; it is never made.
      expect(entitiesClient.list).not.toHaveBeenCalled();
      expect(commands).toEqual([]);
    });
  });
});
