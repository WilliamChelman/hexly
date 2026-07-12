import { provideTranslocoTesting } from '../../../testing/transloco-testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, provideRouter, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { EntityPage, EntitySummary } from '@hexly/domain';
import { EntitiesClient, ActiveWorld, ToasterService, LocaleService } from '@hexly/web-core';
import { MockEntitiesClient } from '@hexly/web-core/testing';
import { EntityBrowser } from './entity-browser';

describe('EntityBrowser', () => {
  let client: MockEntitiesClient;
  let navigate: ReturnType<typeof vi.spyOn>;
  // The URL `q` mirror, controllable per test: push a new value to simulate a
  // shared/refreshed link or a back/forward step (#154).
  let queryParams$: BehaviorSubject<ParamMap>;

  const summary = (over: Partial<EntitySummary>): EntitySummary => ({
    id: 'x',
    worldId: 'w1',
    name: 'A map',
    types: ['core.hexmap'],
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    // The Browser opts into per-row Rights (ADR-0039); default to the Owner's full set so
    // the rename/delete actions render — a reader-only case overrides `rights` to assert gating.
    rights: ['read', 'edit', 'delete', 'set-visibility', 'manage'],
    ...over,
  });

  // Locale/Format Locale tests seed preferences; never let them cross tests.
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  beforeEach(async () => {
    client = new MockEntitiesClient();
    queryParams$ = new BehaviorSubject<ParamMap>(convertToParamMap({}));
    await TestBed.configureTestingModule({
      imports: [EntityBrowser, provideTranslocoTesting()],
      providers: [
        { provide: EntitiesClient, useValue: client },
        provideRouter([]),
        // Stub the route's query-param stream so tests can seed `?q=` and step
        // back/forward; absolute routerLinks don't consult it, so tiles still resolve.
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: queryParams$.asObservable() },
        },
      ],
    }).compileComponents();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    // The browser scopes to the active World (ADR-0028), pinned by the `w/:worldId`
    // route resolver in the app; pin it directly here.
    TestBed.inject(ActiveWorld).set('w1');
  });

  /** Create the library and resolve its first page; `nextCursor` defaults to null (single page). */
  function renderWith(items: EntitySummary[], nextCursor: string | null = null) {
    client.list.mockReturnValueOnce(of({ items, nextCursor }));
    const fixture = TestBed.createComponent(EntityBrowser);
    fixture.detectChanges(); // active-World effect -> list()
    fixture.detectChanges();
    return fixture;
  }

  const loadMore = (el: HTMLElement) => el.querySelector('[data-testid=load-more]') as HTMLButtonElement | null;

  it('exposes the banner and main as sibling landmarks, not banner nested in main', () => {
    const el = renderWith([]).nativeElement as HTMLElement;

    const banner = el.querySelector('[role="banner"]');
    const main = el.querySelector('main');
    expect(banner).not.toBeNull();
    expect(main).not.toBeNull();
    // The header is its own top-level landmark, not swallowed by the content region.
    expect(main!.contains(banner)).toBe(false);
  });

  it('renders its chrome and empty state in French when French is the active language', () => {
    const fixture = renderWith([]);
    const el = fixture.nativeElement as HTMLElement;

    // No reload: flipping the active language re-renders the live component.
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    expect(el.querySelector('h1')?.textContent).toContain('Votre bibliothèque');
    const newNote = el.querySelector('[data-testid=new-note]') as HTMLElement;
    expect(newNote.textContent).toContain('Nouvelle note');
    expect(newNote.textContent).not.toContain('New note');
    expect(el.querySelector('[data-testid=empty]')?.textContent).toContain('Votre bibliothèque est vide.');
    expect(el.textContent).toContain('Créez votre première entité pour commencer.');
  });

  it('owns its page heading in its page-owned header', () => {
    const fixture = renderWith([]);

    // The heading now lives in the page's own header (ADR-0022), visible — no
    // longer chrome contributed to a shell header.
    const heading = fixture.nativeElement.querySelector('h1');
    expect(heading?.textContent).toContain('Your library');
  });

  it('scopes the entity list to the World in the URL (ADR-0028)', () => {
    client.list.mockReturnValueOnce(of({ items: [], nextCursor: null }));
    const fixture = TestBed.createComponent(EntityBrowser);
    fixture.detectChanges();

    expect(client.list).toHaveBeenCalledWith({
      limit: 50,
      worldId: 'w1',
      rights: true,
    });
  });

  it('re-fetches scoped to the new World when the active World changes', () => {
    const fixture = renderWith([summary({ id: 'm1' })]); // initial fetch, World w1

    client.list.mockReturnValueOnce(of({ items: [], nextCursor: null }));
    TestBed.inject(ActiveWorld).set('w2');
    fixture.detectChanges();

    expect(client.list).toHaveBeenCalledWith({
      limit: 50,
      worldId: 'w2',
      rights: true,
    });
  });

  it('renders entities in the server-returned order, never re-sorted client-side (#154)', () => {
    // The server owns ordering now: bm25 relevance while a query is active, updatedAt
    // desc otherwise. The browser must render the page verbatim — the old client-side
    // updatedAt re-sort would clobber relevance rank once a query narrows the set.
    // Here the server deliberately returns the lower updatedAt first; the browser must
    // NOT hoist the newer one to the top.
    const fixture = renderWith([
      summary({ id: 'first', name: 'Aldermoor', updatedAt: 100 }),
      summary({ id: 'second', name: 'The Whisperwood', updatedAt: 300 }),
    ]);

    const titles = Array.from(fixture.nativeElement.querySelectorAll('[data-testid=entity-title]')).map((el) =>
      (el as HTMLElement).textContent?.trim(),
    );
    expect(titles).toEqual(['Aldermoor', 'The Whisperwood']);
  });

  const searchBox = (el: HTMLElement) => el.querySelector('[data-testid=entity-search]') as HTMLInputElement;

  /** Type into the search box and flush the 150ms debounce so the fetch fires. */
  function search(fixture: ReturnType<typeof renderWith>, q: string) {
    const box = searchBox(fixture.nativeElement);
    vi.useFakeTimers();
    box.value = q;
    box.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(150);
    vi.useRealTimers();
    fixture.detectChanges();
  }

  it('filters the grid via the full-text API, scoped to the active World (#154)', () => {
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor' })]);

    // The server returns the query-narrowed, relevance-ordered page.
    client.list.mockReturnValueOnce(
      of({
        items: [summary({ id: 'm2', name: 'Dragonspire' })],
        nextCursor: null,
      }),
    );
    search(fixture, 'dragon');

    // `q` rides along with the existing World scope and page limit.
    expect(client.list).toHaveBeenLastCalledWith({
      q: 'dragon',
      limit: 50,
      worldId: 'w1',
      rights: true,
    });
    const titles = Array.from(fixture.nativeElement.querySelectorAll('[data-testid=entity-title]')).map((t) =>
      (t as HTMLElement).textContent?.trim(),
    );
    expect(titles).toEqual(['Dragonspire']);
  });

  it('mirrors the active query to the URL, dropping the param when cleared (#154)', () => {
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor' })]);

    client.list.mockReturnValue(of({ items: [], nextCursor: null }));
    search(fixture, 'dragon');
    // Merges into existing params (keeps the World scope in the path) without
    // polluting history — the same mirror pattern as the entity view toggle.
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { q: 'dragon' },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      }),
    );

    search(fixture, '');
    // Clearing the box drops the param entirely rather than leaving `?q=`.
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { q: null } }));
  });

  it('seeds the search box and the first fetch from the URL ?q= (shareable, survives refresh) (#154)', () => {
    // Arrive on a shared/refreshed link that already carries a query.
    queryParams$.next(convertToParamMap({ q: 'dragon' }));
    client.list.mockReturnValueOnce(
      of({
        items: [summary({ id: 'm2', name: 'Dragonspire' })],
        nextCursor: null,
      }),
    );
    const fixture = TestBed.createComponent(EntityBrowser);
    fixture.detectChanges();
    fixture.detectChanges();

    // The first fetch already carries the query — one request, not empty-then-refetch.
    expect(client.list).toHaveBeenCalledWith({
      q: 'dragon',
      limit: 50,
      worldId: 'w1',
      rights: true,
    });
    expect(client.list).toHaveBeenCalledTimes(1);
    // The box shows the query it was opened with.
    expect(searchBox(fixture.nativeElement).value).toBe('dragon');
  });

  it('reflects a back/forward URL change into the box and refetches (#154)', () => {
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor' })]);

    // The user presses Back/Forward: the URL query changes without a keystroke.
    client.list.mockReturnValueOnce(
      of({
        items: [summary({ id: 'm2', name: 'Dragonspire' })],
        nextCursor: null,
      }),
    );
    queryParams$.next(convertToParamMap({ q: 'dragon' }));
    fixture.detectChanges();

    expect(client.list).toHaveBeenLastCalledWith({
      q: 'dragon',
      limit: 50,
      worldId: 'w1',
      rights: true,
    });
    expect(searchBox(fixture.nativeElement).value).toBe('dragon');
  });

  const titlesOf = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('[data-testid=entity-title]')).map((t) => (t as HTMLElement).textContent?.trim());

  it('coalesces rapid keystrokes into a single request — the grid doesn’t thrash (#154)', () => {
    const fixture = renderWith([]);
    const box = searchBox(fixture.nativeElement);
    client.list.mockReturnValue(of({ items: [], nextCursor: null }));
    const before = client.list.mock.calls.length;

    vi.useFakeTimers();
    for (const q of ['d', 'dr', 'dra', 'drag']) {
      box.value = q;
      box.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(50); // each key lands within the 150ms window
    }
    vi.advanceTimersByTime(150); // let the trailing debounce fire
    vi.useRealTimers();
    fixture.detectChanges();

    // Four keystrokes, one request — for the final query only.
    expect(client.list.mock.calls.length - before).toBe(1);
    expect(client.list).toHaveBeenLastCalledWith({
      q: 'drag',
      limit: 50,
      worldId: 'w1',
      rights: true,
    });
  });

  it('paints a previously-seen query instantly from cache while it revalidates (#154)', () => {
    const fixture = renderWith([]);
    const el = fixture.nativeElement as HTMLElement;

    // First 'dragon' search resolves — its page is cached.
    client.list.mockReturnValueOnce(
      of({
        items: [summary({ id: 'd', name: 'Dragonspire' })],
        nextCursor: null,
      }),
    );
    search(fixture, 'dragon');
    expect(titlesOf(el)).toEqual(['Dragonspire']);

    // Move to a different query.
    client.list.mockReturnValueOnce(of({ items: [], nextCursor: null }));
    search(fixture, 'castle');
    expect(titlesOf(el)).toEqual([]);

    // Backspace to 'dragon': the revalidation is held pending, but the cached page
    // paints immediately — no blank flash, no waiting on the network.
    const pending = new Subject<EntityPage>();
    client.list.mockReturnValueOnce(pending.asObservable());
    search(fixture, 'dragon');
    expect(titlesOf(el)).toEqual(['Dragonspire']);
    pending.complete();
  });

  it('shows each entity’s type', () => {
    const fixture = renderWith([
      summary({ id: 'm1', name: 'Aldermoor', types: ['core.hexmap'] }),
      summary({ id: 'n1', name: 'Lady Mara', types: ['core.note'] }),
    ]);
    const typeOf = (id: string) =>
      (fixture.nativeElement.querySelector(`[data-testid=type-${id}]`) as HTMLElement)?.textContent?.trim();

    expect(typeOf('m1')).toBe('Map');
    expect(typeOf('n1')).toBe('Note');
  });

  it('shows each entity’s tags', () => {
    const fixture = renderWith([
      summary({
        id: 'm1',
        name: 'Aldermoor',
        tags: ['kingdom', 'northern reach'],
      }),
    ]);

    const tags = fixture.nativeElement.querySelector('[data-testid=tags-m1]') as HTMLElement;
    expect(tags.textContent).toContain('kingdom');
    expect(tags.textContent).toContain('northern reach');
  });

  it('omits the tag list entirely for an untagged entity', () => {
    const fixture = renderWith([summary({ id: 'm1', tags: [] })]);

    expect(fixture.nativeElement.querySelector('[data-testid=tags-m1]')).toBeNull();
  });

  it('renders the new-note action and type labels in French when French is active', () => {
    const fixture = renderWith([
      summary({ id: 'm1', name: 'Aldermoor', types: ['core.hexmap'] }),
      summary({ id: 'n1', name: 'Lady Mara', types: ['core.note'] }),
    ]);
    const el = fixture.nativeElement as HTMLElement;

    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    expect((el.querySelector('[data-testid=new-note]') as HTMLElement).textContent).toContain('Nouvelle note');
    expect((el.querySelector('[data-testid=type-m1]') as HTMLElement).textContent?.trim()).toBe('Carte');
    expect((el.querySelector('[data-testid=type-n1]') as HTMLElement).textContent?.trim()).toBe('Note');
    // The rename action is an icon button — its label lives in aria-label/title.
    expect((el.querySelector('[data-testid=rename-m1]') as HTMLElement).getAttribute('aria-label')).toBe('Renommer');
  });

  it('renders a card’s Delete action in French when French is the active language', () => {
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor' })]);

    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    const del = fixture.nativeElement.querySelector('[data-testid=delete-m1]') as HTMLElement;
    // Icon button — assert the localized label on aria-label, not text content.
    expect(del.getAttribute('aria-label')).toBe('Supprimer');
  });

  it('hides a card’s rename/delete actions when the caller lacks the Rights (ADR-0039)', () => {
    // A reader-only Entity (e.g. a shared one the caller can't edit): the server ships
    // `rights: ['read']`, so the Browser must not offer actions it would then 403.
    const el = renderWith([summary({ id: 'ro', name: 'Read only', rights: ['read'] })]).nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid=rename-ro]')).toBeNull();
    expect(el.querySelector('[data-testid=delete-ro]')).toBeNull();
    // The tile itself (open link) still renders — read is intact.
    expect(el.querySelector('[data-testid=open-ro]')).not.toBeNull();
  });

  it('requests per-row Rights on the list so the cards can gate their actions (ADR-0039)', () => {
    renderWith([summary({ id: 'm1' })]);
    expect(client.list).toHaveBeenCalledWith(expect.objectContaining({ rights: true }));
  });

  it('formats the “Edited” timestamp for the active language, not the browser default', () => {
    // A fixed instant at midday UTC so the calendar day is stable across the
    // runner's timezone; June (month 06) and day 22 read differently in EN
    // (month-first) and FR (day-first), so the active lang is observable.
    const updatedAt = Date.UTC(2026, 5, 22, 12, 0, 0);
    const enDate = new Date(updatedAt).toLocaleDateString('en');
    const frDate = new Date(updatedAt).toLocaleDateString('fr');
    expect(frDate).not.toBe(enDate); // sanity: the date distinguishes the locales

    // French remembered before render — LocaleService applies the stored
    // choice on construction; the pure hexlyDate pipe formats at render time,
    // a mid-view language flip reformats on the next render (ADR-0038).
    localStorage.setItem('hexly-u:hexly-locale', 'fr');
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor', updatedAt })]);
    const meta = (fixture.nativeElement.querySelector('.meta') as HTMLElement).textContent ?? '';

    expect(meta).toContain(`Modifié le ${frDate}`);
    expect(meta).not.toContain(enDate);
    expect(meta).not.toContain('Edited');
  });

  it('formats the “Edited” date with the Format Locale, independent of the language (ADR-0038)', () => {
    // 22 June: en-US reads month-first, en-GB day-first — same language, so
    // only the Format Locale axis can explain a change.
    const updatedAt = Date.UTC(2026, 5, 22, 12, 0, 0);
    const gbDate = new Date(updatedAt).toLocaleDateString('en-GB');

    // Chosen before render (the pipe is pure — it formats what renders next).
    TestBed.inject(LocaleService).setFormatLocale('en-GB');
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor', updatedAt })]);

    const meta = (fixture.nativeElement.querySelector('.meta') as HTMLElement).textContent ?? '';
    // Copy still English, date now day-first.
    expect(meta).toContain(`Edited ${gbDate}`);
  });

  it('renders an entity name verbatim — never translated — even when it collides with a UI string', () => {
    // "New note" is a UI action label; an entity a user happened to name that must stay
    // their words, not get swapped for the French action copy.
    const fixture = renderWith([summary({ id: 'm1', name: 'New note' })]);

    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    const title = fixture.nativeElement.querySelector('[data-testid=entity-title]') as HTMLElement;
    expect(title.textContent?.trim()).toBe('New note');
    expect(title.textContent).not.toContain('Nouvelle note');
  });

  it('shows a load-more affordance while there is a next page', () => {
    const fixture = renderWith([summary({ id: 'm1' })], 'cursor-2');
    expect(loadMore(fixture.nativeElement)).not.toBeNull();
  });

  it('shows no load-more affordance when the first page is the last (single page)', () => {
    const fixture = renderWith([summary({ id: 'm1' })], null);
    expect(loadMore(fixture.nativeElement)).toBeNull();
  });

  it('fetches the next page with the cursor and appends it, then hides load-more on the last page', () => {
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor', updatedAt: 300 })], 'cursor-2');
    const el = fixture.nativeElement as HTMLElement;

    client.list.mockReturnValueOnce(
      of({
        items: [summary({ id: 'm2', name: 'The Whisperwood', updatedAt: 200 })],
        nextCursor: null,
      }),
    );
    loadMore(el)?.click();
    expect(client.list).toHaveBeenCalledWith({
      cursor: 'cursor-2',
      worldId: 'w1',
      rights: true,
    });
    fixture.detectChanges();

    // The next page is appended after the first — no duplicates, no gaps.
    const titles = Array.from(el.querySelectorAll('[data-testid=entity-title]')).map((t) =>
      (t as HTMLElement).textContent?.trim(),
    );
    expect(titles).toEqual(['Aldermoor', 'The Whisperwood']);
    // Last page reached: the affordance is gone.
    expect(loadMore(el)).toBeNull();
  });

  it('carries the active query into load-more so a filtered result set pages completely (#154)', () => {
    // The server's cursor is a bare offset; the filter is re-applied from `q`, so a
    // next-page request under a query MUST re-send it or it pages the unfiltered set.
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor' })]);

    client.list.mockReturnValueOnce(
      of({
        items: [summary({ id: 'k1', name: 'Aldermoor Keep' })],
        nextCursor: 'cursor-2',
      }),
    );
    search(fixture, 'keep');
    const el = fixture.nativeElement as HTMLElement;

    client.list.mockReturnValueOnce(
      of({
        items: [summary({ id: 'k2', name: 'Keep of Thorns' })],
        nextCursor: null,
      }),
    );
    loadMore(el)?.click();

    expect(client.list).toHaveBeenLastCalledWith({
      cursor: 'cursor-2',
      worldId: 'w1',
      rights: true,
      q: 'keep',
    });
    fixture.detectChanges();
    expect(titlesOf(el)).toEqual(['Aldermoor Keep', 'Keep of Thorns']);
  });

  it('ignores a second load-more click while the first is still in flight (no double-append)', () => {
    const fixture = renderWith([summary({ id: 'm1', updatedAt: 300 })], 'cursor-2');
    const el = fixture.nativeElement as HTMLElement;

    // Held open (not `of`) so `loadingMore` stays true across both clicks.
    const pending = new Subject<EntityPage>();
    client.list.mockReturnValueOnce(pending.asObservable());

    loadMore(el)?.click();
    fixture.detectChanges();
    // A second click before the page resolves must not fire a second request.
    loadMore(el)?.click();
    fixture.detectChanges();

    expect(client.list).toHaveBeenCalledTimes(2); // initial render + one load-more
    pending.next({
      items: [summary({ id: 'm2', updatedAt: 200 })],
      nextCursor: null,
    });
    pending.complete();
  });

  it('keeps the current results on screen while the next query loads — no empty flash between searches (#154)', () => {
    const fixture = renderWith([summary({ id: 'a1', name: 'Aldermoor' })]);
    const el = fixture.nativeElement as HTMLElement;

    client.list.mockReturnValueOnce(
      of({
        items: [summary({ id: 'a1', name: 'Aldermoor' })],
        nextCursor: null,
      }),
    );
    search(fixture, 'ald');
    expect(titlesOf(el)).toEqual(['Aldermoor']);

    // The next (uncached) query's fetch is held pending: the grid must keep showing
    // the previous results rather than flush to empty — the quick-search SWR pattern.
    const pending = new Subject<EntityPage>();
    client.list.mockReturnValueOnce(pending.asObservable());
    search(fixture, 'brea');
    expect(titlesOf(el)).toEqual(['Aldermoor']);

    // Once it resolves, the grid swaps to the new results in one step.
    pending.next({
      items: [summary({ id: 'b1', name: 'Breachwood' })],
      nextCursor: null,
    });
    pending.complete();
    fixture.detectChanges();
    expect(titlesOf(el)).toEqual(['Breachwood']);
  });

  it('shows a distinct no-matches state (not the empty-library state) when a query matches nothing (#154)', () => {
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor' })]);
    const el = fixture.nativeElement as HTMLElement;

    client.list.mockReturnValueOnce(of({ items: [], nextCursor: null }));
    search(fixture, 'nothing matches this');

    // A search that finds nothing reads as "no matches", never "your library is empty".
    expect(el.querySelector('[data-testid=no-matches]')).not.toBeNull();
    expect(el.querySelector('[data-testid=empty]')).toBeNull();
  });

  it('shows an empty state when the user has no entities', () => {
    const fixture = renderWith([]);

    expect(fixture.nativeElement.querySelector('[data-testid=empty]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid=entity-title]')).toBeNull();
  });

  it('renders the load-error state in French when French is the active language', () => {
    client.list.mockReturnValueOnce(throwError(() => new Error('boom')));
    const fixture = TestBed.createComponent(EntityBrowser);
    fixture.detectChanges(); // active-World effect -> list()
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector('[data-testid=load-error]') as HTMLElement;
    expect(error.textContent).toContain('Impossible de charger votre bibliothèque.');
    expect(error.textContent).toContain('Une erreur est survenue. Veuillez réessayer dans un instant.');
  });

  it('shows an error state when the entity list fails to load', () => {
    client.list.mockReturnValueOnce(throwError(() => new Error('boom')));
    const fixture = TestBed.createComponent(EntityBrowser);
    fixture.detectChanges(); // active-World effect -> list()
    fixture.detectChanges();

    // A failed list surfaces an error panel rather than a permanently blank page.
    expect(fixture.nativeElement.querySelector('[data-testid=load-error]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid=empty]')).toBeNull();
  });

  // Creating a Type *other* than the default Note goes through the split button's menu, which
  // owns that behaviour and is specced with it (`new-entity-button.spec.ts`).
  it('creates a new note and opens it', () => {
    const fixture = renderWith([]);

    client.create.mockReturnValueOnce(
      of({
        ...summary({
          id: 'created',
          name: 'Untitled note',
          types: ['core.note'],
        }),
        seq: 1,
        document: { content: { format: 'tiptap-v1', snapshot: {} } },
      }),
    );
    (fixture.nativeElement.querySelector('[data-testid=new-note]') as HTMLButtonElement).click();

    expect(client.create).toHaveBeenCalledWith('Untitled note', ['core.note'], 'w1');
    expect(navigate).toHaveBeenCalledWith(['/w', 'w1', 'entities', 'created']);
  });

  it('links a map’s card to its editor', () => {
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor' })]);

    // The whole tile is a routerLink anchor (stretched-link inset), so assert the
    // resolved href rather than a navigate() call.
    expect(
      (fixture.nativeElement.querySelector('[data-testid=open-m1]') as HTMLAnchorElement).getAttribute('href'),
    ).toBe('/w/w1/entities/m1');
  });

  it('renames an entity, then refreshes from page one (ADR-0025)', () => {
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor', version: 4 })]);
    const el = fixture.nativeElement as HTMLElement;

    (el.querySelector('[data-testid=rename-m1]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const input = el.querySelector('[data-testid=rename-input-m1]') as HTMLInputElement;
    input.value = 'Aldermoor Keep';
    input.dispatchEvent(new Event('input'));

    client.patch.mockReturnValueOnce(
      of({
        ...summary({ id: 'm1', name: 'Aldermoor Keep', version: 4 }),
        // The rename bumped `seq`; a patch never bumps `version`.
        seq: 5,
        document: {
          content: { format: 'tiptap-v1', snapshot: {} },
          metadata: { grid: { hexes: {}, regions: [], labels: [] } },
        },
      }),
    );
    // After the rename the browser refreshes from page one: it re-fetches and
    // renders what the server returns, rather than reconciling in place.
    client.list.mockReturnValueOnce(
      of({
        items: [summary({ id: 'm1', name: 'Aldermoor Keep', version: 4 })],
        nextCursor: null,
      }),
    );
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(client.patch).toHaveBeenCalledWith('m1', { name: 'Aldermoor Keep' });
    expect(client.list).toHaveBeenCalledWith({
      limit: 50,
      worldId: 'w1',
      rights: true,
    });
    fixture.detectChanges();

    // The card shows the new name and the input is gone (back to read mode).
    expect((el.querySelector('[data-testid=entity-title]') as HTMLElement).textContent?.trim()).toBe('Aldermoor Keep');
    expect(el.querySelector('[data-testid=rename-input-m1]')).toBeNull();
  });

  it('closes the input and surfaces an error toast when a rename fails', () => {
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor', version: 4 })]);
    const el = fixture.nativeElement as HTMLElement;

    (el.querySelector('[data-testid=rename-m1]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const input = el.querySelector('[data-testid=rename-input-m1]') as HTMLInputElement;
    input.value = 'Aldermoor Keep';
    input.dispatchEvent(new Event('input'));
    client.patch.mockReturnValueOnce(throwError(() => new Error('boom')));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();

    // The input is closed (not left stuck open) and the failure is surfaced.
    expect(el.querySelector('[data-testid=rename-input-m1]')).toBeNull();
    const toasts = TestBed.inject(ToasterService).toasts();
    expect(toasts.map((t) => t.tone)).toEqual(['error']);
  });

  it('cancels an inline rename on Escape without saving', () => {
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor' })]);
    const el = fixture.nativeElement as HTMLElement;

    (el.querySelector('[data-testid=rename-m1]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const input = el.querySelector('[data-testid=rename-input-m1]') as HTMLInputElement;
    input.value = 'Discarded';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    // No PATCH, and the original name stays put with the editor closed.
    expect(client.patch).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid=rename-input-m1]')).toBeNull();
    expect((el.querySelector('[data-testid=entity-title]') as HTMLElement).textContent?.trim()).toBe('Aldermoor');
  });

  it('deletes a map, then refreshes from page one (ADR-0025)', () => {
    const fixture = renderWith([
      summary({ id: 'm1', name: 'Aldermoor' }),
      summary({ id: 'm2', name: 'The Whisperwood' }),
    ]);

    client.delete.mockReturnValueOnce(of(undefined));
    // The delete is followed by a page-one refresh; the view reflects the server.
    client.list.mockReturnValueOnce(
      of({
        items: [summary({ id: 'm2', name: 'The Whisperwood' })],
        nextCursor: null,
      }),
    );
    (fixture.nativeElement.querySelector('[data-testid=delete-m1]') as HTMLButtonElement).click();

    expect(client.delete).toHaveBeenCalledWith('m1');
    expect(client.list).toHaveBeenCalledWith({
      limit: 50,
      worldId: 'w1',
      rights: true,
    });
    fixture.detectChanges();

    const titles = Array.from(fixture.nativeElement.querySelectorAll('[data-testid=entity-title]')).map((el) =>
      (el as HTMLElement).textContent?.trim(),
    );
    expect(titles).toEqual(['The Whisperwood']);
  });

  describe('Facet rail (#155)', () => {
    const facet = (el: HTMLElement, tid: string) =>
      // Quote the value: a `namespace.id` type testid (e.g. `facet-type-core.note`) carries a dot,
      // which an unquoted attribute selector rejects.
      el.querySelector(`[data-testid="${tid}"]`) as HTMLButtonElement | null;

    it('renders each Facet category’s values with server counts', () => {
      client.facets.mockReturnValue(
        of({
          type: [
            { value: 'core.note', count: 3 },
            { value: 'core.hexmap', count: 1 },
          ],
          tag: [{ value: 'deity', count: 2 }],
          visibility: [{ value: 'private', count: 4 }],
          fields: [],
        }),
      );
      const el = renderWith([summary({ id: 'm1' })]).nativeElement as HTMLElement;

      expect(facet(el, 'facet-type-core.note')?.textContent).toContain('Note');
      expect(facet(el, 'facet-type-core.note')?.textContent).toContain('3');
      expect(facet(el, 'facet-tag-deity')?.textContent).toContain('deity');
      expect(facet(el, 'facet-tag-deity')?.textContent).toContain('2');
      expect(facet(el, 'facet-visibility-private')).not.toBeNull();
    });

    it('toggles a Type Facet: filters the list and mirrors it to the URL', () => {
      client.facets.mockReturnValue(
        of({
          type: [{ value: 'core.note', count: 1 }],
          tag: [],
          visibility: [],
          fields: [],
        }),
      );
      const fixture = renderWith([summary({ id: 'm1' })]);
      const el = fixture.nativeElement as HTMLElement;

      client.list.mockReturnValueOnce(
        of({
          items: [summary({ id: 'n1', types: ['core.note'] })],
          nextCursor: null,
        }),
      );
      facet(el, 'facet-type-core.note')?.click();
      fixture.detectChanges();

      expect(client.list).toHaveBeenLastCalledWith({
        limit: 50,
        worldId: 'w1',
        rights: true,
        type: ['core.note'],
      });
      expect(navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          queryParams: expect.objectContaining({ type: ['core.note'] }),
          queryParamsHandling: 'merge',
          replaceUrl: true,
        }),
      );
    });

    it('removes an individual active Facet by toggling it off', () => {
      client.facets.mockReturnValue(
        of({
          type: [{ value: 'core.note', count: 1 }],
          tag: [],
          visibility: [],
          fields: [],
        }),
      );
      const fixture = renderWith([summary({ id: 'm1' })]);
      const el = fixture.nativeElement as HTMLElement;

      client.list.mockReturnValue(of({ items: [], nextCursor: null }));
      facet(el, 'facet-type-core.note')?.click();
      fixture.detectChanges();
      // The value now reads as active.
      expect(facet(el, 'facet-type-core.note')?.getAttribute('aria-pressed')).toBe('true');

      // Toggling the same value off drops the whole category from the request/URL.
      facet(el, 'facet-type-core.note')?.click();
      fixture.detectChanges();
      expect(client.list).toHaveBeenLastCalledWith({
        limit: 50,
        worldId: 'w1',
        rights: true,
      });
      expect(navigate).toHaveBeenLastCalledWith(
        [],
        expect.objectContaining({
          queryParams: expect.objectContaining({ type: null }),
        }),
      );
    });

    it('Clear all resets the query and every Facet, dropping their URL params', () => {
      client.facets.mockReturnValue(
        of({
          type: [{ value: 'core.note', count: 1 }],
          tag: [],
          visibility: [],
          fields: [],
        }),
      );
      const fixture = renderWith([summary({ id: 'm1' })]);
      const el = fixture.nativeElement as HTMLElement;

      client.list.mockReturnValue(of({ items: [], nextCursor: null }));
      facet(el, 'facet-type-core.note')?.click();
      fixture.detectChanges();
      // Clear all only appears once something is active.
      expect(facet(el, 'facet-clear')).not.toBeNull();

      facet(el, 'facet-clear')?.click();
      fixture.detectChanges();

      expect(navigate).toHaveBeenLastCalledWith(
        [],
        expect.objectContaining({
          queryParams: {
            q: null,
            type: null,
            tag: null,
            visibility: null,
            field: null,
          },
        }),
      );
      expect(client.list).toHaveBeenLastCalledWith({
        limit: 50,
        worldId: 'w1',
        rights: true,
      });
    });

    it('seeds active Facets from the URL and carries them into the first fetch', () => {
      queryParams$.next(convertToParamMap({ type: 'core.note', tag: ['deity', 'ruined'] }));
      client.list.mockReturnValueOnce(of({ items: [], nextCursor: null }));
      const fixture = TestBed.createComponent(EntityBrowser);
      fixture.detectChanges();
      fixture.detectChanges();

      // One request on load, already carrying the URL's Facets — no empty-then-refetch.
      expect(client.list).toHaveBeenCalledWith({
        limit: 50,
        worldId: 'w1',
        rights: true,
        type: ['core.note'],
        tag: ['deity', 'ruined'],
      });
      expect(client.list).toHaveBeenCalledTimes(1);
    });

    it('recomputes Facet counts under the active filters on a query change', () => {
      const fixture = renderWith([summary({ id: 'm1' })]);
      client.list.mockReturnValue(of({ items: [], nextCursor: null }));
      const before = client.facets.mock.calls.length;

      search(fixture, 'temple');

      expect(client.facets.mock.calls.length).toBeGreaterThan(before);
      expect(client.facets).toHaveBeenLastCalledWith({
        worldId: 'w1',
        q: 'temple',
      });
    });

    describe('contextual Field facets (#188)', () => {
      // A facets response carrying one enum Field facet — the contextual dimension the server
      // returns only when a type is the active filter.
      const withEnumField = () =>
        client.facets.mockReturnValue(
          of({
            type: [{ value: 'test.beast', count: 2 }],
            tag: [],
            visibility: [],
            fields: [
              {
                key: 'alignment',
                label: 'Alignment',
                dataType: {
                  kind: 'enum',
                  options: ['lawful-good', 'chaotic-evil'],
                },
                values: [
                  { value: 'lawful-good', count: 1 },
                  { value: 'chaotic-evil', count: 1 },
                ],
              },
            ],
          }),
        );

      it('renders a type’s Field facet with its values and counts', () => {
        withEnumField();
        const el = renderWith([summary({ id: 'm1' })]).nativeElement as HTMLElement;

        expect(el.querySelector('[data-testid="facet-field-alignment"]')).not.toBeNull();
        const row = facet(el, 'facet-field-alignment-lawful-good');
        expect(row?.textContent).toContain('lawful-good');
        expect(row?.textContent).toContain('1');
      });

      it('toggling a Field-facet value filters the list and mirrors a `field` token to the URL', () => {
        withEnumField();
        const fixture = renderWith([summary({ id: 'm1' })]);
        const el = fixture.nativeElement as HTMLElement;

        client.list.mockReturnValueOnce(of({ items: [], nextCursor: null }));
        facet(el, 'facet-field-alignment-lawful-good')?.click();
        fixture.detectChanges();

        expect(client.list).toHaveBeenLastCalledWith({
          limit: 50,
          worldId: 'w1',
          rights: true,
          field: ['alignment:eq:lawful-good'],
        });
        expect(navigate).toHaveBeenLastCalledWith(
          [],
          expect.objectContaining({
            queryParams: expect.objectContaining({
              field: ['alignment:eq:lawful-good'],
            }),
          }),
        );
      });

      it('a number Field facet renders a range whose bound becomes a `gte` token', () => {
        client.facets.mockReturnValue(
          of({
            type: [{ value: 'test.beast', count: 2 }],
            tag: [],
            visibility: [],
            fields: [
              {
                key: 'cr',
                label: 'Challenge Rating',
                dataType: { kind: 'number' },
                values: [
                  { value: '1', count: 1 },
                  { value: '10', count: 1 },
                ],
              },
            ],
          }),
        );
        const fixture = renderWith([summary({ id: 'm1' })]);
        const el = fixture.nativeElement as HTMLElement;

        const min = el.querySelector('[data-testid="facet-field-cr-gte"]') as HTMLInputElement;
        expect(min).not.toBeNull();
        client.list.mockReturnValueOnce(of({ items: [], nextCursor: null }));
        min.value = '5';
        min.dispatchEvent(new Event('change'));
        fixture.detectChanges();

        expect(client.list).toHaveBeenLastCalledWith({
          limit: 50,
          worldId: 'w1',
          rights: true,
          field: ['cr:gte:5'],
        });
      });

      it('seeds Field filters from a `field` URL param into the first fetch', () => {
        queryParams$.next(
          convertToParamMap({
            type: 'test.beast',
            field: 'alignment:eq:lawful-good',
          }),
        );
        client.list.mockReturnValueOnce(of({ items: [], nextCursor: null }));
        const fixture = TestBed.createComponent(EntityBrowser);
        fixture.detectChanges();
        fixture.detectChanges();

        expect(client.list).toHaveBeenCalledWith({
          limit: 50,
          worldId: 'w1',
          rights: true,
          type: ['test.beast'],
          field: ['alignment:eq:lawful-good'],
        });
      });
    });
  });

  it('keeps the card and surfaces an error toast when a delete fails', () => {
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor' })]);

    client.delete.mockReturnValueOnce(throwError(() => new Error('boom')));
    (fixture.nativeElement.querySelector('[data-testid=delete-m1]') as HTMLButtonElement).click();
    fixture.detectChanges();

    // The card stays (the delete didn't take) and the failure is surfaced.
    expect(fixture.nativeElement.querySelector('[data-testid=open-m1]')).not.toBeNull();
    const toasts = TestBed.inject(ToasterService).toasts();
    expect(toasts.map((t) => t.tone)).toEqual(['error']);
  });
});
