import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, provideRouter, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { EntitySummary, Mount } from '@hexly/domain';
import { ActiveWorld, EntitiesClient, WorldsClient } from '@hexly/web-core';
import { MockEntitiesClient, MockWorldsClient } from '@hexly/web-core/testing';
import { providePluginContent } from '@hexly/plugin-content/web';
import { provideTranslocoTesting } from '../../../testing/transloco-testing';
import { LibraryPage } from './library.page';

/**
 * The **Library** (#412, ADR-0080): the Entity Browser preset to what this World **Mounts**. What is
 * this page's own — rather than the Entity Browser's, already pinned in its spec — is where the scope
 * comes from: the Mount set, in the Owner's order, and the three ways it can be absent — a World that
 * mounts nothing, a read that failed, and a reader with no standing to be told.
 */
describe('Library', () => {
  let entities: MockEntitiesClient;
  let worlds: MockWorldsClient;
  let queryParams$: BehaviorSubject<ParamMap>;

  /** An installed pack and a mounted Shelf — the two kinds of Container a Mount names (ADR-0080). */
  const pack: Mount = { containerId: 'c-pack', name: 'Draw Steel: Monsters', kind: 'compendium' };
  const shelf: Mount = { containerId: 'c-shelf', name: 'The Art Shelf', kind: 'world' };

  const summary = (over: Partial<EntitySummary>): EntitySummary => ({
    id: 'e1',
    worldId: 'c-pack',
    name: 'Goblin Warrior',
    types: ['core.type.note'],
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    // A Compendium Entry's Rights are `read` alone, and `sealed` is what offers Adoption (ADR-0079).
    rights: ['read'],
    sealed: true,
    ...over,
  });

  beforeEach(async () => {
    entities = new MockEntitiesClient();
    worlds = new MockWorldsClient();
    queryParams$ = new BehaviorSubject<ParamMap>(convertToParamMap({}));
    await TestBed.configureTestingModule({
      imports: [LibraryPage, provideTranslocoTesting()],
      providers: [
        providePluginContent(),
        { provide: EntitiesClient, useValue: entities },
        { provide: WorldsClient, useValue: worlds },
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParamMap: queryParams$.asObservable() } },
      ],
    }).compileComponents();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    TestBed.inject(ActiveWorld).set('w1');
  });

  /** Mount `mounts`, resolve the first page with `items`, and return the mounted fixture. */
  function renderWith(mounts: Mount[], items: EntitySummary[] = []) {
    worlds.mounts.mockReturnValue(of(mounts));
    entities.list.mockReturnValue(of({ items, nextCursor: null }));
    const fixture = TestBed.createComponent(LibraryPage);
    fixture.detectChanges(); // active-World effect -> mounts() -> list()
    fixture.detectChanges();
    return fixture;
  }

  it('scopes the list to every mounted Container, in the Owner’s Mount order', () => {
    renderWith([pack, shelf], [summary({})]);

    // The order is not cosmetic: the server reads it back to order the Container facet, which is how
    // the rail reads in the order the Owner arranged (ADR-0080).
    // The whole read, spelled out: the Containers are the only scope on the wire. The World in the URL
    // names whose Mounts these are and the Adoption target, and rides nothing — a Mount widens what a
    // World may point at, never what it holds.
    expect(entities.list).toHaveBeenCalledWith({
      limit: 50,
      containerId: ['c-pack', 'c-shelf'],
      rights: true,
      thumbnails: true,
    });
    expect(entities.facets).toHaveBeenCalledWith({ containerId: ['c-pack', 'c-shelf'] });
  });

  it('shows a World that Mounts nothing an empty Library that says so, and reads nothing', () => {
    const el = renderWith([]).nativeElement as HTMLElement;

    // A read naming no Container is an unscoped read of every Entity the caller can reach — not an
    // empty one — so the empty Mount set is answered here rather than on the wire.
    expect(entities.list).not.toHaveBeenCalled();
    const empty = el.querySelector('[data-testid=no-mounts]');
    expect(empty?.textContent).toContain('This world draws on nothing yet.');
    // Which emptiness this is, told apart from "nothing matched" and "nothing to show".
    expect(el.querySelector('[data-testid=empty]')).toBeNull();
    expect(el.querySelector('[data-testid=no-matches]')).toBeNull();
  });

  it('still says it draws on nothing when a search query rides the URL', () => {
    queryParams$.next(convertToParamMap({ q: 'goblin' }));
    const el = renderWith([]).nativeElement as HTMLElement;

    // With nothing mounted there was nothing to search, so "nothing matched your search" would name a
    // failure that never happened (ADR-0080).
    expect(el.querySelector('[data-testid=no-mounts]')).not.toBeNull();
    expect(el.querySelector('[data-testid=no-matches]')).toBeNull();
  });

  it('tells a failed read of the Mount set apart from a World that Mounts nothing', () => {
    worlds.mounts.mockReturnValue(throwError(() => new Error('offline')));
    const fixture = TestBed.createComponent(LibraryPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    // "We could not ask" and "it draws on nothing" are different answers, and telling them apart is
    // what the empty Library is for (#412) — so the failure must not read as the emptiness.
    expect(el.querySelector('[data-testid=load-error]')).not.toBeNull();
    expect(el.querySelector('[data-testid=no-mounts]')).toBeNull();
  });

  it('shows a non-member reader nothing rather than a failure that never happened', () => {
    // The Mount set is member-gated: a reader who reaches this World through someone else's Mount is
    // refused it, because the cascade is one hop and naming these Containers would disclose the second
    // (ADR-0080). Nothing went wrong, so nothing may say so.
    worlds.mounts.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403, statusText: 'Forbidden' })));
    const fixture = TestBed.createComponent(LibraryPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid=members-only]')).not.toBeNull();
    expect(el.querySelector('[data-testid=load-error]')).toBeNull();
    // Nor the emptiness of a World that Mounts nothing: this reader was told nothing, which is not the
    // same as being told there is nothing.
    expect(el.querySelector('[data-testid=no-mounts]')).toBeNull();
    // And nothing is read on their behalf: an empty scope would list every Entity they can reach.
    expect(entities.list).not.toHaveBeenCalled();
  });

  it('credits the mounted Compendiums by name, linking each to its own Compendium page', () => {
    const el = renderWith([pack, shelf], [summary({})]).nativeElement as HTMLElement;

    const credits = el.querySelector('[data-testid=library-credits]');
    expect(credits?.textContent).toContain('Draw Steel: Monsters');
    // The **Compendium page** stays where it is, reached from the Library that credits it (ADR-0080).
    expect(el.querySelector('[data-testid=library-credit-c-pack]')?.getAttribute('href')).toContain('/compendium/');
    // A mounted World publishes under no terms and has no such page, so it is credited nowhere.
    expect(credits?.textContent).not.toContain('The Art Shelf');
    expect(el.querySelector('[data-testid=library-credit-c-shelf]')).toBeNull();
  });

  it('offers Adoption where the content is, and no rename or delete beside it', () => {
    const el = renderWith([pack], [summary({})]).nativeElement as HTMLElement;

    // Read-only is inherited, never special-cased: `read` alone is what hides rename and delete, and
    // `sealed` is what offers the copy-it-to-change-it path (ADR-0079, #403).
    expect(el.querySelector('[data-testid=adopt-e1]')).not.toBeNull();
    expect(el.querySelector('[data-testid^=rename-]')).toBeNull();
    expect(el.querySelector('[data-testid^=delete-]')).toBeNull();
  });

  it('seeds the Container facet’s selection from the URL and narrows the read by it', () => {
    worlds.mounts.mockReturnValue(of([pack, shelf]));
    entities.list.mockReturnValue(of({ items: [], nextCursor: null }));
    queryParams$.next(convertToParamMap({ container: 'c-pack' }));
    const fixture = TestBed.createComponent(LibraryPage);
    fixture.detectChanges();

    // The selection narrows *within* the scope rather than redefining it: both ride the wire, and they
    // AND server-side, so a shared link keeps its meaning after another Container is mounted.
    expect(entities.list).toHaveBeenCalledWith(
      expect.objectContaining({ containerId: ['c-pack', 'c-shelf'], container: ['c-pack'] }),
    );
  });

  it('renders its chrome and its empty Library in French when French is the active language', () => {
    const fixture = renderWith([]);
    const el = fixture.nativeElement as HTMLElement;

    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    expect(el.querySelector('h1')?.textContent).toContain('Ce dont ce monde se sert');
    expect(el.querySelector('[data-testid=no-mounts]')?.textContent).toContain('Ce monde ne se sert encore de rien.');
  });
});
