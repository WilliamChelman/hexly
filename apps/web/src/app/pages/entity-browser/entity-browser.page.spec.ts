import { provideTranslocoTesting } from '../../../testing/transloco-testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, provideRouter, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { EntityPage, EntitySummary } from '@hexly/domain';
import { EntitiesClient, ActiveWorld, ToasterService, LocaleService } from '@hexly/web-core';
import { MockEntitiesClient } from '@hexly/web-core/testing';
import { DialogRef, DialogService } from '@hexly/web-ui';
import { providePluginContent } from '@hexly/plugin-content/web';
import { providePluginHexmap } from '@hexly/plugin-hexmap/web';
import { EntityBrowserPage } from './entity-browser.page';
import { TypeRegistry } from '../../entity-types/type-registry';

describe('EntityBrowser', () => {
  let client: MockEntitiesClient;
  let navigate: ReturnType<typeof vi.spyOn>;
  // The delete confirmation is opened through DialogService (ADR-0065); stub it so a test drives the
  // confirm/cancel decision directly (the dialog's own behaviour is covered in its component spec).
  let lastDialog: DialogRef<unknown, boolean>;
  const dialogService = { open: vi.fn(() => (lastDialog = new DialogRef<unknown, boolean>({}))) };
  // The URL `q` mirror, controllable per test: push a new value to simulate a
  // shared/refreshed link or a back/forward step (#154).
  let queryParams$: BehaviorSubject<ParamMap>;

  const summary = (over: Partial<EntitySummary>): EntitySummary => ({
    id: 'x',
    worldId: 'w1',
    name: 'A map',
    types: ['core.type.hex-map'],
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
    dialogService.open.mockClear();
    queryParams$ = new BehaviorSubject<ParamMap>(convertToParamMap({}));
    await TestBed.configureTestingModule({
      imports: [EntityBrowserPage, provideTranslocoTesting()],
      providers: [
        providePluginContent(),
        // The hexmap plugin too: a type's name is its own plugin's copy now (#312), not app-catalog copy.
        providePluginHexmap(),
        { provide: EntitiesClient, useValue: client },
        { provide: DialogService, useValue: dialogService },
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

  /** Create the browser and resolve its first page; `nextCursor` defaults to null (single page). */
  function renderWith(items: EntitySummary[], nextCursor: string | null = null) {
    client.list.mockReturnValueOnce(of({ items, nextCursor }));
    const fixture = TestBed.createComponent(EntityBrowserPage);
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

    expect(el.querySelector('h1')?.textContent).toContain('Vos entités');
    const newEntity = el.querySelector('[data-testid=new-default-entity]') as HTMLElement;
    expect(newEntity.textContent).toContain('Créer une note');
    expect(newEntity.textContent).not.toContain('Create Note');
    expect(el.querySelector('[data-testid=empty]')?.textContent).toContain('Aucune entité pour le moment.');
    expect(el.textContent).toContain('Créez votre première entité pour commencer.');
  });

  it('owns its page heading in its page-owned header', () => {
    const fixture = renderWith([]);

    // The heading now lives in the page's own header (ADR-0022), visible — no
    // longer chrome contributed to a shell header.
    const heading = fixture.nativeElement.querySelector('h1');
    expect(heading?.textContent).toContain('Your entities');
  });

  it('scopes the entity list to the World in the URL (ADR-0028)', () => {
    client.list.mockReturnValueOnce(of({ items: [], nextCursor: null }));
    const fixture = TestBed.createComponent(EntityBrowserPage);
    fixture.detectChanges();

    expect(client.list).toHaveBeenCalledWith({
      limit: 50,
      worldId: 'w1',
      rights: true,
      thumbnails: true,
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
      thumbnails: true,
    });
  });

  it('renders entities in the server-returned order, never re-sorted client-side (#154)', () => {
    // The server owns ordering (bm25 relevance under a query, updatedAt desc otherwise) and the
    // browser renders the page verbatim. Here the server returns the lower updatedAt first.
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
      thumbnails: true,
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
    const fixture = TestBed.createComponent(EntityBrowserPage);
    fixture.detectChanges();
    fixture.detectChanges();

    // The first fetch already carries the query — one request, not empty-then-refetch.
    expect(client.list).toHaveBeenCalledWith({
      q: 'dragon',
      limit: 50,
      worldId: 'w1',
      rights: true,
      thumbnails: true,
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
      thumbnails: true,
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
      thumbnails: true,
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
      summary({ id: 'm1', name: 'Aldermoor', types: ['core.type.hex-map'] }),
      summary({ id: 'n1', name: 'Lady Mara', types: ['core.type.note'] }),
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

  it('renders the primary create action and type labels in French when French is active', () => {
    const fixture = renderWith([
      summary({ id: 'm1', name: 'Aldermoor', types: ['core.type.hex-map'] }),
      summary({ id: 'n1', name: 'Lady Mara', types: ['core.type.note'] }),
    ]);
    const el = fixture.nativeElement as HTMLElement;

    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    expect((el.querySelector('[data-testid=new-default-entity]') as HTMLElement).textContent).toContain(
      'Créer une note',
    );
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
      thumbnails: true,
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
      thumbnails: true,
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

  it('shows a distinct no-matches state (not the empty state) when a query matches nothing (#154)', () => {
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor' })]);
    const el = fixture.nativeElement as HTMLElement;

    client.list.mockReturnValueOnce(of({ items: [], nextCursor: null }));
    search(fixture, 'nothing matches this');

    // A search that finds nothing reads as "no matches", never "no entities yet".
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
    const fixture = TestBed.createComponent(EntityBrowserPage);
    fixture.detectChanges(); // active-World effect -> list()
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector('[data-testid=load-error]') as HTMLElement;
    expect(error.textContent).toContain('Impossible de charger vos entités.');
    expect(error.textContent).toContain('Une erreur est survenue. Veuillez réessayer dans un instant.');
  });

  it('shows an error state when the entity list fails to load', () => {
    client.list.mockReturnValueOnce(throwError(() => new Error('boom')));
    const fixture = TestBed.createComponent(EntityBrowserPage);
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
          types: ['core.type.note'],
        }),
        seq: 1,
        document: { content: { format: 'tiptap-v1', snapshot: {} } },
      }),
    );
    (fixture.nativeElement.querySelector('[data-testid=new-default-entity]') as HTMLButtonElement).click();

    expect(client.create).toHaveBeenCalledWith('Untitled note', ['core.type.note'], 'w1');
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
          grid: { hexes: {}, regions: [], labels: [] },
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
      thumbnails: true,
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

  it('confirms, then deletes a map and refreshes from page one (ADR-0025, ADR-0065)', () => {
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
    // Delete opens the confirmation, not the network call; nothing deletes until it resolves confirm.
    (fixture.nativeElement.querySelector('[data-testid=delete-m1]') as HTMLButtonElement).click();
    expect(dialogService.open).toHaveBeenCalled();
    expect(client.delete).not.toHaveBeenCalled();
    lastDialog.close(true);

    expect(client.delete).toHaveBeenCalledWith('m1');
    expect(client.list).toHaveBeenCalledWith({
      limit: 50,
      worldId: 'w1',
      rights: true,
      thumbnails: true,
    });
    fixture.detectChanges();

    const titles = Array.from(fixture.nativeElement.querySelectorAll('[data-testid=entity-title]')).map((el) =>
      (el as HTMLElement).textContent?.trim(),
    );
    expect(titles).toEqual(['The Whisperwood']);
  });

  describe('Facet rail (#155)', () => {
    const facet = (el: HTMLElement, tid: string) =>
      // Quote the value: a `namespace.id` type testid (e.g. `facet-type-core.type.note`) carries a dot,
      // which an unquoted attribute selector rejects.
      el.querySelector(`[data-testid="${tid}"]`) as HTMLButtonElement | null;

    it('renders each Facet category’s values with server counts', () => {
      client.facets.mockReturnValue(
        of({
          type: [
            { value: 'core.type.note', count: 3 },
            { value: 'core.type.hex-map', count: 1 },
          ],
          tag: [{ value: 'deity', count: 2 }],
          visibility: [{ value: 'private', count: 4 }],
          fields: [],
        }),
      );
      const el = renderWith([summary({ id: 'm1' })]).nativeElement as HTMLElement;

      expect(facet(el, 'facet-type-core.type.note')?.textContent).toContain('Note');
      expect(facet(el, 'facet-type-core.type.note')?.textContent).toContain('3');
      expect(facet(el, 'facet-tag-deity')?.textContent).toContain('deity');
      expect(facet(el, 'facet-tag-deity')?.textContent).toContain('2');
      expect(facet(el, 'facet-visibility-private')).not.toBeNull();
    });

    it('toggles a Type Facet: filters the list and mirrors it to the URL', () => {
      client.facets.mockReturnValue(
        of({
          type: [{ value: 'core.type.note', count: 1 }],
          tag: [],
          visibility: [],
          fields: [],
        }),
      );
      const fixture = renderWith([summary({ id: 'm1' })]);
      const el = fixture.nativeElement as HTMLElement;

      client.list.mockReturnValueOnce(
        of({
          items: [summary({ id: 'n1', types: ['core.type.note'] })],
          nextCursor: null,
        }),
      );
      facet(el, 'facet-type-core.type.note')?.click();
      fixture.detectChanges();

      expect(client.list).toHaveBeenLastCalledWith({
        limit: 50,
        worldId: 'w1',
        rights: true,
        thumbnails: true,
        type: ['core.type.note'],
      });
      expect(navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          queryParams: expect.objectContaining({ type: ['core.type.note'] }),
          queryParamsHandling: 'merge',
          replaceUrl: true,
        }),
      );
    });

    it('removes an individual active Facet by toggling it off', () => {
      client.facets.mockReturnValue(
        of({
          type: [{ value: 'core.type.note', count: 1 }],
          tag: [],
          visibility: [],
          fields: [],
        }),
      );
      const fixture = renderWith([summary({ id: 'm1' })]);
      const el = fixture.nativeElement as HTMLElement;

      client.list.mockReturnValue(of({ items: [], nextCursor: null }));
      facet(el, 'facet-type-core.type.note')?.click();
      fixture.detectChanges();
      // The value now reads as active.
      expect(facet(el, 'facet-type-core.type.note')?.getAttribute('aria-pressed')).toBe('true');

      // Toggling the same value off drops the whole category from the request/URL.
      facet(el, 'facet-type-core.type.note')?.click();
      fixture.detectChanges();
      expect(client.list).toHaveBeenLastCalledWith({
        limit: 50,
        worldId: 'w1',
        rights: true,
        thumbnails: true,
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
          type: [{ value: 'core.type.note', count: 1 }],
          tag: [],
          visibility: [],
          fields: [],
        }),
      );
      const fixture = renderWith([summary({ id: 'm1' })]);
      const el = fixture.nativeElement as HTMLElement;

      client.list.mockReturnValue(of({ items: [], nextCursor: null }));
      facet(el, 'facet-type-core.type.note')?.click();
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
            excludeType: null,
            excludeTag: null,
            excludeVisibility: null,
          },
        }),
      );
      expect(client.list).toHaveBeenLastCalledWith({
        limit: 50,
        worldId: 'w1',
        rights: true,
        thumbnails: true,
      });
    });

    it('seeds active Facets from the URL and carries them into the first fetch', () => {
      queryParams$.next(convertToParamMap({ type: 'core.type.note', tag: ['deity', 'ruined'] }));
      client.list.mockReturnValueOnce(of({ items: [], nextCursor: null }));
      const fixture = TestBed.createComponent(EntityBrowserPage);
      fixture.detectChanges();
      fixture.detectChanges();

      // One request on load, already carrying the URL's Facets — no empty-then-refetch.
      expect(client.list).toHaveBeenCalledWith({
        limit: 50,
        worldId: 'w1',
        rights: true,
        thumbnails: true,
        type: ['core.type.note'],
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

    /** Or the only way out of the empty grid the selection caused is Clear all (ADR-0081, #420). */
    it('keeps a selected Tag listed at zero count when a Type shares no Entity with it (#420)', () => {
      client.facets.mockReturnValue(
        of({
          type: [
            { value: 'core.type.note', count: 3 },
            { value: 'core.type.hex-map', count: 1 },
          ],
          tag: [{ value: 'deity', count: 2 }],
          visibility: [],
          fields: [],
        }),
      );
      const fixture = renderWith([summary({ id: 'n1' })]);
      const el = fixture.nativeElement as HTMLElement;

      client.list.mockReturnValue(of({ items: [summary({ id: 'n1', types: ['core.type.note'] })], nextCursor: null }));
      facet(el, 'facet-tag-deity')?.click();
      fixture.detectChanges();

      // Now a Type no `deity` Entity carries: the grid empties and the tag counts to zero, so the
      // server stops sending it.
      client.list.mockReturnValue(of({ items: [], nextCursor: null }));
      client.facets.mockReturnValue(
        of({
          type: [
            { value: 'core.type.note', count: 3 },
            { value: 'core.type.hex-map', count: 1 },
          ],
          tag: [],
          visibility: [],
          fields: [],
        }),
      );
      facet(el, 'facet-type-core.type.hex-map')?.click();
      fixture.detectChanges();
      expect(el.querySelector('[data-testid=entity-title]')).toBeNull();

      // Still rendered, still reading as active, showing its real count rather than a fabricated one.
      const deity = facet(el, 'facet-tag-deity');
      expect(deity).not.toBeNull();
      expect(deity?.getAttribute('aria-pressed')).toBe('true');
      expect(deity?.querySelector('span.tabular-nums')?.textContent?.trim()).toBe('0');

      // And clicking it off recovers the grid — no Clear all needed.
      client.list.mockReturnValue(
        of({ items: [summary({ id: 'm1', types: ['core.type.hex-map'] })], nextCursor: null }),
      );
      deity?.click();
      fixture.detectChanges();

      expect(client.list).toHaveBeenLastCalledWith({
        limit: 50,
        worldId: 'w1',
        rights: true,
        thumbnails: true,
        type: ['core.type.hex-map'],
      });
      expect(el.querySelector('[data-testid=entity-title]')).not.toBeNull();
    });

    describe('Field facets by presence (#188, #231)', () => {
      // A facets response carrying one enum Field facet — the server surfaces it by presence in the
      // result set, whatever types those entities hold (ADR-0054, #231).
      const withEnumField = () =>
        client.facets.mockReturnValue(
          of({
            type: [{ value: 'test.type.beast', count: 2 }],
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
          thumbnails: true,
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
            type: [{ value: 'test.type.beast', count: 2 }],
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
          thumbnails: true,
          field: ['cr:gte:5'],
        });
      });

      it('seeds Field filters from a `field` URL param into the first fetch', () => {
        queryParams$.next(
          convertToParamMap({
            type: 'test.type.beast',
            field: 'alignment:eq:lawful-good',
          }),
        );
        client.list.mockReturnValueOnce(of({ items: [], nextCursor: null }));
        const fixture = TestBed.createComponent(EntityBrowserPage);
        fixture.detectChanges();
        fixture.detectChanges();

        expect(client.list).toHaveBeenCalledWith({
          limit: 50,
          worldId: 'w1',
          rights: true,
          thumbnails: true,
          type: ['test.type.beast'],
          field: ['alignment:eq:lawful-good'],
        });
      });
    });

    /**
     * Exclusion reaches the reader (ADR-0081, #422): a second toggle per row, riding the `exclude*`
     * params #421 put on the wire, with the two polarities releasing each other.
     */
    describe('Excluding a value (#422)', () => {
      const withCounts = () =>
        client.facets.mockReturnValue(
          of({
            type: [
              { value: 'core.type.note', count: 3 },
              { value: 'core.type.hex-map', count: 1 },
            ],
            tag: [
              { value: 'draft', count: 2 },
              { value: 'secret', count: 1 },
            ],
            visibility: [],
            fields: [],
          }),
        );

      /** Render with counts on screen and the next list read stubbed, ready for a toggle. */
      function ready() {
        withCounts();
        const fixture = renderWith([summary({ id: 'n1' })]);
        client.list.mockReturnValue(of({ items: [], nextCursor: null }));
        return { fixture, el: fixture.nativeElement as HTMLElement };
      }

      it('excluding a Tag sends excludeTag and mirrors it to the URL', () => {
        const { fixture, el } = ready();

        facet(el, 'facet-exclude-tag-draft')?.click();
        fixture.detectChanges();

        expect(client.list).toHaveBeenLastCalledWith({
          limit: 50,
          worldId: 'w1',
          rights: true,
          thumbnails: true,
          excludeTag: ['draft'],
        });
        // The counts drill down against the exclusion too, or the rail would annotate a list it disagrees with.
        expect(client.facets).toHaveBeenLastCalledWith({ worldId: 'w1', excludeTag: ['draft'] });
        expect(navigate).toHaveBeenLastCalledWith(
          [],
          expect.objectContaining({ queryParams: expect.objectContaining({ excludeTag: ['draft'] }) }),
        );
      });

      it('clicking the exclude toggle again restores the excluded Entities', () => {
        const { fixture, el } = ready();

        facet(el, 'facet-exclude-tag-draft')?.click();
        fixture.detectChanges();
        expect(facet(el, 'facet-exclude-tag-draft')?.getAttribute('aria-pressed')).toBe('true');

        facet(el, 'facet-exclude-tag-draft')?.click();
        fixture.detectChanges();

        expect(client.list).toHaveBeenLastCalledWith({ limit: 50, worldId: 'w1', rights: true, thumbnails: true });
        expect(navigate).toHaveBeenLastCalledWith(
          [],
          expect.objectContaining({ queryParams: expect.objectContaining({ excludeTag: null }) }),
        );
      });

      /** Read Notes without Maps crowding them out. */
      it('excludes an Entity Type the same way', () => {
        const { fixture, el } = ready();

        facet(el, 'facet-exclude-type-core.type.hex-map')?.click();
        fixture.detectChanges();

        expect(client.list).toHaveBeenLastCalledWith({
          limit: 50,
          worldId: 'w1',
          rights: true,
          thumbnails: true,
          excludeType: ['core.type.hex-map'],
        });
      });

      it('accumulates exclusions — hide drafts and secrets in one browse', () => {
        const { fixture, el } = ready();

        facet(el, 'facet-exclude-tag-draft')?.click();
        fixture.detectChanges();
        facet(el, 'facet-exclude-tag-secret')?.click();
        fixture.detectChanges();

        expect(client.list).toHaveBeenLastCalledWith({
          limit: 50,
          worldId: 'w1',
          rights: true,
          thumbnails: true,
          excludeTag: ['draft', 'secret'],
        });
      });

      it('releases the exclusion when include is pressed, and the inclusion when exclude is', () => {
        const { fixture, el } = ready();

        facet(el, 'facet-exclude-tag-draft')?.click();
        fixture.detectChanges();

        // Include on an excluded value: the exclusion goes, the inclusion arrives — never both.
        facet(el, 'facet-tag-draft')?.click();
        fixture.detectChanges();
        expect(client.list).toHaveBeenLastCalledWith({
          limit: 50,
          worldId: 'w1',
          rights: true,
          thumbnails: true,
          tag: ['draft'],
        });
        expect(facet(el, 'facet-tag-draft')?.getAttribute('aria-pressed')).toBe('true');
        expect(facet(el, 'facet-exclude-tag-draft')?.getAttribute('aria-pressed')).toBe('false');

        // And back the other way.
        facet(el, 'facet-exclude-tag-draft')?.click();
        fixture.detectChanges();
        expect(client.list).toHaveBeenLastCalledWith({
          limit: 50,
          worldId: 'w1',
          rights: true,
          thumbnails: true,
          excludeTag: ['draft'],
        });
        expect(facet(el, 'facet-tag-draft')?.getAttribute('aria-pressed')).toBe('false');
        expect(facet(el, 'facet-exclude-tag-draft')?.getAttribute('aria-pressed')).toBe('true');
      });

      it('excludes a Field value through the `field` param’s own `neq` op', () => {
        client.facets.mockReturnValue(
          of({
            type: [],
            tag: [],
            visibility: [],
            fields: [
              {
                key: 'alignment',
                label: 'Alignment',
                dataType: { kind: 'enum', options: ['lawful-good', 'chaotic-evil'] },
                values: [{ value: 'chaotic-evil', count: 1 }],
              },
            ],
          }),
        );
        const fixture = renderWith([summary({ id: 'n1' })]);
        const el = fixture.nativeElement as HTMLElement;
        client.list.mockReturnValue(of({ items: [], nextCursor: null }));

        facet(el, 'facet-exclude-field-alignment-chaotic-evil')?.click();
        fixture.detectChanges();

        expect(client.list).toHaveBeenLastCalledWith({
          limit: 50,
          worldId: 'w1',
          rights: true,
          thumbnails: true,
          field: ['alignment:neq:chaotic-evil'],
        });
      });

      /** A refresh, or a shared link, reproduces the browse. */
      it('seeds exclusions from the URL into the first fetch and lights their controls', () => {
        withCounts();
        queryParams$.next(convertToParamMap({ excludeTag: ['draft', 'secret'], excludeType: 'core.type.hex-map' }));
        client.list.mockReturnValueOnce(of({ items: [], nextCursor: null }));
        const fixture = TestBed.createComponent(EntityBrowserPage);
        fixture.detectChanges();
        fixture.detectChanges();

        expect(client.list).toHaveBeenCalledWith({
          limit: 50,
          worldId: 'w1',
          rights: true,
          thumbnails: true,
          excludeTag: ['draft', 'secret'],
          excludeType: ['core.type.hex-map'],
        });
        // One request on load — the seeded browse is the first one, not a correction of an empty one.
        expect(client.list).toHaveBeenCalledTimes(1);
        const el = fixture.nativeElement as HTMLElement;
        expect(facet(el, 'facet-exclude-tag-draft')?.getAttribute('aria-pressed')).toBe('true');
        expect(facet(el, 'facet-exclude-type-core.type.hex-map')?.getAttribute('aria-pressed')).toBe('true');
      });

      it('offers Clear all for an exclusion alone, and clears both polarities', () => {
        const { fixture, el } = ready();

        facet(el, 'facet-tag-secret')?.click();
        fixture.detectChanges();
        facet(el, 'facet-exclude-tag-draft')?.click();
        fixture.detectChanges();
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
              excludeType: null,
              excludeTag: null,
              excludeVisibility: null,
            },
          }),
        );
        expect(client.list).toHaveBeenLastCalledWith({ limit: 50, worldId: 'w1', rights: true, thumbnails: true });
      });

      /** Or the exclusion is a one-way door: the row is gone and there is nothing left to click off. */
      it('keeps an excluded Tag listed once the drill-down stops counting it, still clickable off', () => {
        const { fixture, el } = ready();

        // The server drops `draft` from the counts (say a Type selection shares no Entity with it).
        client.facets.mockReturnValue(
          of({ type: [{ value: 'core.type.note', count: 3 }], tag: [], visibility: [], fields: [] }),
        );
        facet(el, 'facet-exclude-tag-draft')?.click();
        fixture.detectChanges();

        const excluded = facet(el, 'facet-exclude-tag-draft');
        expect(excluded).not.toBeNull();
        expect(excluded?.getAttribute('aria-pressed')).toBe('true');
        expect(facet(el, 'facet-tag-draft')?.querySelector('span.tabular-nums')?.textContent?.trim()).toBe('0');

        excluded?.click();
        fixture.detectChanges();
        expect(client.list).toHaveBeenLastCalledWith({ limit: 50, worldId: 'w1', rights: true, thumbnails: true });
      });
    });

    /**
     * A Facet named inline rather than clicked (ADR-0082, #424). Two stores, one rule: filter state is
     * `parse(text) ∪ railState`, the rail renders the union, and where both name a value the text wins.
     * The grammar itself is the domain parser's spec; these are the browser's wiring and that rule.
     */
    describe('Facet Tokens (#424)', () => {
      const withCounts = () =>
        client.facets.mockReturnValue(
          of({
            type: [{ value: 'core.type.note', count: 3 }],
            tag: [
              { value: 'draft', count: 2 },
              { value: 'fantasy', count: 1 },
            ],
            visibility: [],
            fields: [],
          }),
        );

      /** A facetable World Field, so `$test.field.cr:` resolves off the client registry, synchronously. */
      const withWorldField = () =>
        TestBed.inject(TypeRegistry).setWorldFields([
          { id: 'test.field.cr', label: 'CR', dataType: { kind: 'number' }, required: false, facetable: true },
        ]);

      it('applies $type:npc, and leaves the box holding exactly what was typed', () => {
        const fixture = renderWith([summary({ id: 'm1' })]);
        client.list.mockReturnValue(of({ items: [], nextCursor: null }));

        search(fixture, '$type:core.type.note');

        // The token became a param; nothing of it reached the full-text `q`.
        expect(client.list).toHaveBeenLastCalledWith({
          limit: 50,
          worldId: 'w1',
          rights: true,
          thumbnails: true,
          type: ['core.type.note'],
        });
        expect(searchBox(fixture.nativeElement).value).toBe('$type:core.type.note');
        // The URL's `q` carries the raw string, so the link reproduces the box, not the residual.
        expect(navigate).toHaveBeenCalledWith(
          [],
          expect.objectContaining({ queryParams: { q: '$type:core.type.note' } }),
        );
      });

      it('reads a mixed box as both filters and a search', () => {
        const fixture = renderWith([summary({ id: 'm1' })]);
        client.list.mockReturnValue(of({ items: [], nextCursor: null }));

        search(fixture, 'orc $tag:fantasy $type:core.type.note');

        expect(client.list).toHaveBeenLastCalledWith({
          q: 'orc',
          limit: 50,
          worldId: 'w1',
          rights: true,
          thumbnails: true,
          type: ['core.type.note'],
          tag: ['fantasy'],
        });
      });

      it('excludes with a leading dash, onto the same exclude params the rail uses', () => {
        const fixture = renderWith([summary({ id: 'm1' })]);
        client.list.mockReturnValue(of({ items: [], nextCursor: null }));

        search(fixture, '-$tag:draft');

        expect(client.list).toHaveBeenLastCalledWith({
          limit: 50,
          worldId: 'w1',
          rights: true,
          thumbnails: true,
          excludeTag: ['draft'],
        });
      });

      it('maps a comparison onto the `field` param’s bound, off a key the registry knows', () => {
        withWorldField();
        const fixture = renderWith([summary({ id: 'm1' })]);
        client.list.mockReturnValue(of({ items: [], nextCursor: null }));

        search(fixture, '$test.field.cr:>=5');

        expect(client.list).toHaveBeenLastCalledWith({
          limit: 50,
          worldId: 'w1',
          rights: true,
          thumbnails: true,
          field: ['test.field.cr:gte:5'],
        });
      });

      it('says a $ name nothing answers to, and never searches for it', () => {
        const fixture = renderWith([summary({ id: 'm1' })]);
        client.list.mockReturnValue(of({ items: [], nextCursor: null }));

        search(fixture, 'orc $domain:material');

        const el = fixture.nativeElement as HTMLElement;
        expect(el.querySelector('[data-testid=unknown-facet]')?.textContent).toContain('domain');
        expect(client.list).toHaveBeenLastCalledWith({
          q: 'orc',
          limit: 50,
          worldId: 'w1',
          rights: true,
          thumbnails: true,
        });
      });

      /**
       * A token whose key resolves but that applies nothing vanishes from the text like any other, so
       * an unreported one would browse everything as if the box were empty (ADR-0082).
       */
      it('says why a resolvable token still filtered nothing, one message per reason', () => {
        withWorldField();
        const fixture = renderWith([summary({ id: 'm1' })]);
        const el = fixture.nativeElement as HTMLElement;
        client.list.mockReturnValue(of({ items: [], nextCursor: null }));

        search(fixture, '$tag:');
        expect(el.querySelector('[data-testid=unknown-facet-empty-value]')?.textContent).toContain('names no value');

        search(fixture, '$tag:"sea of ');
        expect(el.querySelector('[data-testid=unknown-facet-unterminated-quote]')?.textContent).toContain(
          'quote still open',
        );

        // No negated bound on the wire (ADR-0081), and "not >= 5" is not "<= 5".
        search(fixture, '-$test.field.cr:>=5');
        expect(el.querySelector('[data-testid=unknown-facet-negated-bound]')?.textContent).toContain('range bound can');
        expect(client.list).toHaveBeenLastCalledWith({
          limit: 50,
          worldId: 'w1',
          rights: true,
          thumbnails: true,
        });
      });

      it('shows a typed value in the rail, lit, beside a clicked one', () => {
        withCounts();
        const fixture = renderWith([summary({ id: 'm1' })]);
        const el = fixture.nativeElement as HTMLElement;
        client.list.mockReturnValue(of({ items: [], nextCursor: null }));

        facet(el, 'facet-type-core.type.note')?.click();
        fixture.detectChanges();
        search(fixture, '$tag:fantasy');

        // The union: the clicked Type and the typed Tag, both in force and both lit.
        expect(facet(el, 'facet-tag-fantasy')?.getAttribute('aria-pressed')).toBe('true');
        expect(facet(el, 'facet-type-core.type.note')?.getAttribute('aria-pressed')).toBe('true');
        expect(client.list).toHaveBeenLastCalledWith({
          limit: 50,
          worldId: 'w1',
          rights: true,
          thumbnails: true,
          type: ['core.type.note'],
          tag: ['fantasy'],
        });
      });

      it('lets the text win a value the rail also names, dropping the rail’s entry', () => {
        withCounts();
        const fixture = renderWith([summary({ id: 'm1' })]);
        const el = fixture.nativeElement as HTMLElement;
        client.list.mockReturnValue(of({ items: [], nextCursor: null }));

        // Clicked as an exclusion, then typed as an inclusion: one value, one visual state.
        facet(el, 'facet-exclude-tag-draft')?.click();
        fixture.detectChanges();
        search(fixture, '$tag:draft');

        expect(facet(el, 'facet-tag-draft')?.getAttribute('aria-pressed')).toBe('true');
        expect(facet(el, 'facet-exclude-tag-draft')?.getAttribute('aria-pressed')).toBe('false');
        expect(client.list).toHaveBeenLastCalledWith({
          limit: 50,
          worldId: 'w1',
          rights: true,
          thumbnails: true,
          tag: ['draft'],
        });
      });

      it('never writes the rail’s selections into the box, nor the box’s into the rail’s params', () => {
        withCounts();
        const fixture = renderWith([summary({ id: 'm1' })]);
        const el = fixture.nativeElement as HTMLElement;
        client.list.mockReturnValue(of({ items: [], nextCursor: null }));

        search(fixture, '$tag:fantasy');
        facet(el, 'facet-type-core.type.note')?.click();
        fixture.detectChanges();

        // Clicking left the box alone, and the rail's URL mirror carries no typed Tag.
        expect(searchBox(el).value).toBe('$tag:fantasy');
        expect(navigate).toHaveBeenLastCalledWith(
          [],
          expect.objectContaining({ queryParams: expect.objectContaining({ type: ['core.type.note'], tag: null }) }),
        );
      });

      it('reproduces both stores from a shared link', () => {
        withCounts();
        queryParams$.next(convertToParamMap({ q: 'orc $tag:fantasy', type: 'core.type.note' }));
        client.list.mockReturnValueOnce(of({ items: [], nextCursor: null }));
        const fixture = TestBed.createComponent(EntityBrowserPage);
        fixture.detectChanges();
        fixture.detectChanges();

        expect(client.list).toHaveBeenCalledWith({
          q: 'orc',
          limit: 50,
          worldId: 'w1',
          rights: true,
          thumbnails: true,
          type: ['core.type.note'],
          tag: ['fantasy'],
        });
        // One request on load, and the box holds the raw string the link carried.
        expect(client.list).toHaveBeenCalledTimes(1);
        expect(searchBox(fixture.nativeElement).value).toBe('orc $tag:fantasy');
      });

      it('counts a box of blanks as no query at all', () => {
        withCounts();
        const fixture = renderWith([]);
        const el = fixture.nativeElement as HTMLElement;
        client.list.mockReturnValue(of({ items: [], nextCursor: null }));

        search(fixture, '   ');

        // Nothing is being searched for: the plain empty state, and nothing to clear.
        expect(el.querySelector('[data-testid=empty]')).not.toBeNull();
        expect(el.querySelector('[data-testid=no-matches]')).toBeNull();
        expect(facet(el, 'facet-clear')).toBeNull();
      });

      it('clears a typed Facet with Clear all, box and all', () => {
        withCounts();
        const fixture = renderWith([summary({ id: 'm1' })]);
        const el = fixture.nativeElement as HTMLElement;
        client.list.mockReturnValue(of({ items: [], nextCursor: null }));

        search(fixture, '$tag:fantasy');
        facet(el, 'facet-clear')?.click();
        fixture.detectChanges();

        expect(searchBox(el).value).toBe('');
        expect(client.list).toHaveBeenLastCalledWith({ limit: 50, worldId: 'w1', rights: true, thumbnails: true });
      });

      /**
       * A cold load on a shared link naming a **Field** key (ADR-0082, #430). The Fields read is still in
       * flight, so the params this box means are not known yet: the page used to fetch without `field` —
       * every Entity in the World — and correct itself when the response landed, narrowing under whoever
       * was already reading. The read is held instead, and the hold ends on the response either way.
       */
      describe('a Facet key the registry cannot answer for yet', () => {
        const crField = {
          id: 'test.field.cr',
          label: 'CR',
          dataType: { kind: 'number' as const },
          required: false,
          facetable: true,
        };

        /** Entering a World: the loader has asked for its Fields and nothing has answered yet. */
        const awaiting = () => {
          const registry = TestBed.inject(TypeRegistry);
          registry.setWorldFields([]);
          registry.awaitWorldFields();
          return registry;
        };

        const render = (q: string) => {
          queryParams$.next(convertToParamMap({ q }));
          client.list.mockReturnValue(of({ items: [], nextCursor: null }));
          const fixture = TestBed.createComponent(EntityBrowserPage);
          fixture.detectChanges();
          return fixture;
        };

        it('holds the first read, then makes it once — filtered — when the Fields land', () => {
          const registry = awaiting();
          const fixture = render('$test.field.cr:5');

          // Nothing went out: not the list, not the Facet counts that would size the rail by it.
          expect(client.list).not.toHaveBeenCalled();
          expect(client.facets).not.toHaveBeenCalled();
          // And nothing claims the World is empty while the read is held.
          expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid=empty]')).toBeNull();

          registry.setWorldFields([crField]);
          fixture.detectChanges();

          expect(client.list).toHaveBeenCalledTimes(1);
          expect(client.list).toHaveBeenCalledWith({
            limit: 50,
            worldId: 'w1',
            rights: true,
            thumbnails: true,
            field: ['test.field.cr:eq:5'],
          });
        });

        it('browses at once when the box names no Field key, whatever the Fields read is doing', () => {
          awaiting();

          render('orc $type:core.type.note');

          // `$type` is decided by the reserved names the moment it is typed — no read widens it.
          expect(client.list).toHaveBeenCalledTimes(1);
          expect(client.list).toHaveBeenCalledWith({
            q: 'orc',
            limit: 50,
            worldId: 'w1',
            rights: true,
            thumbnails: true,
            type: ['core.type.note'],
          });
        });

        it('browses at once on an empty box', () => {
          awaiting();

          render('');

          expect(client.list).toHaveBeenCalledTimes(1);
        });

        /**
         * The failure path the hold hangs on: a refused or broken Fields read degrades to *no* World
         * Fields (see `world-fields-loader.spec.ts`), which settles the key — so the page browses, states
         * the miss, and is never left at an empty grid waiting on a response that already came.
         */
        it('browses, and states the miss, when the Fields read answers without the key', () => {
          const registry = awaiting();
          const fixture = render('orc $test.field.cr:5');
          expect(client.list).not.toHaveBeenCalled();

          registry.setWorldFields([]); // what a failed read degrades to
          fixture.detectChanges();

          expect(client.list).toHaveBeenCalledTimes(1);
          expect(client.list).toHaveBeenCalledWith({
            q: 'orc',
            limit: 50,
            worldId: 'w1',
            rights: true,
            thumbnails: true,
          });
          const el = fixture.nativeElement as HTMLElement;
          expect(el.querySelector('[data-testid=unknown-facet]')?.textContent).toContain('test.field.cr');
        });
      });
    });

    /**
     * Everything applied is reversible where it was named (ADR-0082): a rail row the text owns renders
     * as query-owned, and clicking it deletes *that* token from the box — the one rail→text write, and
     * always a deletion.
     */
    describe('Clicking a typed value off (#425)', () => {
      const withCounts = () =>
        client.facets.mockReturnValue(
          of({
            type: [{ value: 'core.type.note', count: 3 }],
            tag: [
              { value: 'draft', count: 2 },
              { value: 'fantasy', count: 1 },
            ],
            visibility: [],
            fields: [
              {
                key: 'test.field.alignment',
                label: 'Alignment',
                dataType: { kind: 'enum' as const, options: ['lawful-good', 'chaotic-evil'] },
                values: [{ value: 'lawful-good', count: 1 }],
              },
            ],
          }),
        );

      /** The Field behind that facet, so `$test.field.alignment:` resolves off the client registry. */
      const withWorldField = () =>
        TestBed.inject(TypeRegistry).setWorldFields([
          {
            id: 'test.field.alignment',
            label: 'Alignment',
            dataType: { kind: 'enum', options: ['lawful-good', 'chaotic-evil'] },
            required: false,
            facetable: true,
          },
        ]);

      it('renders a typed value as query-owned, where a clicked one is not', () => {
        withCounts();
        const fixture = renderWith([summary({ id: 'm1' })]);
        const el = fixture.nativeElement as HTMLElement;
        client.list.mockReturnValue(of({ items: [], nextCursor: null }));

        search(fixture, '$tag:draft');
        facet(el, 'facet-type-core.type.note')?.click();
        fixture.detectChanges();

        expect(facet(el, 'facet-tag-draft')?.hasAttribute('data-query-owned')).toBe(true);
        expect(facet(el, 'facet-type-core.type.note')?.hasAttribute('data-query-owned')).toBe(false);
      });

      it('takes that token out of the box and leaves every other word, tokens included', () => {
        withCounts();
        const fixture = renderWith([summary({ id: 'm1' })]);
        const el = fixture.nativeElement as HTMLElement;
        client.list.mockReturnValue(of({ items: [], nextCursor: null }));

        search(fixture, 'orc $tag:draft $tag:fantasy');
        facet(el, 'facet-tag-draft')?.click();
        fixture.detectChanges();

        // The second Tag token is another value of the same Facet, and is none of this click's business.
        expect(searchBox(el).value).toBe('orc $tag:fantasy');
        expect(client.list).toHaveBeenLastCalledWith({
          q: 'orc',
          limit: 50,
          worldId: 'w1',
          rights: true,
          thumbnails: true,
          tag: ['fantasy'],
        });
        // The URL's `q` follows the box, and the rail's own params are untouched: nothing was clicked in.
        expect(navigate).toHaveBeenLastCalledWith(
          [],
          expect.objectContaining({ queryParams: { q: 'orc $tag:fantasy' } }),
        );
      });

      it('takes out a token the text wrote as an exclusion', () => {
        withCounts();
        const fixture = renderWith([summary({ id: 'm1' })]);
        const el = fixture.nativeElement as HTMLElement;
        client.list.mockReturnValue(of({ items: [], nextCursor: null }));

        search(fixture, '-$tag:draft');
        expect(facet(el, 'facet-exclude-tag-draft')?.getAttribute('aria-pressed')).toBe('true');
        facet(el, 'facet-exclude-tag-draft')?.click();
        fixture.detectChanges();

        expect(searchBox(el).value).toBe('');
        expect(client.list).toHaveBeenLastCalledWith({ limit: 50, worldId: 'w1', rights: true, thumbnails: true });
      });

      /** Whichever half is pressed, a typed value is one state to release — the token goes, no rail
       * entry takes its place, and the URL never grows a param nobody clicked. */
      it('releases a typed inclusion from either of its controls, writing nothing into the rail', () => {
        withCounts();
        const fixture = renderWith([summary({ id: 'm1' })]);
        const el = fixture.nativeElement as HTMLElement;
        client.list.mockReturnValue(of({ items: [], nextCursor: null }));

        search(fixture, '$tag:draft');
        facet(el, 'facet-exclude-tag-draft')?.click();
        fixture.detectChanges();

        expect(searchBox(el).value).toBe('');
        expect(client.list).toHaveBeenLastCalledWith({ limit: 50, worldId: 'w1', rights: true, thumbnails: true });
        expect(navigate).not.toHaveBeenCalledWith(
          [],
          expect.objectContaining({ queryParams: expect.objectContaining({ excludeTag: ['draft'] }) }),
        );
      });

      it('takes out a Facet key’s token from its Field row', () => {
        withWorldField();
        withCounts();
        const fixture = renderWith([summary({ id: 'm1' })]);
        const el = fixture.nativeElement as HTMLElement;
        client.list.mockReturnValue(of({ items: [], nextCursor: null }));

        search(fixture, '$test.field.alignment:lawful-good');
        expect(facet(el, 'facet-field-test.field.alignment-lawful-good')?.hasAttribute('data-query-owned')).toBe(true);
        facet(el, 'facet-field-test.field.alignment-lawful-good')?.click();
        fixture.detectChanges();

        expect(searchBox(el).value).toBe('');
        expect(client.list).toHaveBeenLastCalledWith({ limit: 50, worldId: 'w1', rights: true, thumbnails: true });
      });

      /** The click deletes the token, and only the token: a value the rail was already holding was
       * merely masked by the text (ADR-0082), so it stays in force and one more click releases it. */
      it('leaves a rail selection the text was masking in force, released by a second click', () => {
        withCounts();
        const fixture = renderWith([summary({ id: 'm1' })]);
        const el = fixture.nativeElement as HTMLElement;
        client.list.mockReturnValue(of({ items: [], nextCursor: null }));

        facet(el, 'facet-tag-draft')?.click();
        fixture.detectChanges();
        search(fixture, '$tag:draft');
        facet(el, 'facet-tag-draft')?.click();
        fixture.detectChanges();

        // The box lost its token; the earlier click is still the rail's, and still lit.
        expect(searchBox(el).value).toBe('');
        expect(facet(el, 'facet-tag-draft')?.hasAttribute('data-query-owned')).toBe(false);
        expect(facet(el, 'facet-tag-draft')?.getAttribute('aria-pressed')).toBe('true');

        facet(el, 'facet-tag-draft')?.click();
        fixture.detectChanges();

        expect(facet(el, 'facet-tag-draft')?.getAttribute('aria-pressed')).toBe('false');
        expect(client.list).toHaveBeenLastCalledWith({ limit: 50, worldId: 'w1', rights: true, thumbnails: true });
      });

      it('leaves a rail-sourced selection toggling as it always did, box untouched', () => {
        withCounts();
        const fixture = renderWith([summary({ id: 'm1' })]);
        const el = fixture.nativeElement as HTMLElement;
        client.list.mockReturnValue(of({ items: [], nextCursor: null }));

        search(fixture, '$tag:draft');
        facet(el, 'facet-type-core.type.note')?.click();
        fixture.detectChanges();
        facet(el, 'facet-type-core.type.note')?.click();
        fixture.detectChanges();

        expect(facet(el, 'facet-type-core.type.note')?.getAttribute('aria-pressed')).toBe('false');
        expect(searchBox(el).value).toBe('$tag:draft');
        expect(client.list).toHaveBeenLastCalledWith({
          limit: 50,
          worldId: 'w1',
          rights: true,
          thumbnails: true,
          tag: ['draft'],
        });
      });
    });
  });

  it('keeps the card and surfaces an error toast when a confirmed delete fails', () => {
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor' })]);

    client.delete.mockReturnValueOnce(throwError(() => new Error('boom')));
    (fixture.nativeElement.querySelector('[data-testid=delete-m1]') as HTMLButtonElement).click();
    lastDialog.close(true);
    fixture.detectChanges();

    // The card stays (the delete didn't take) and the failure is surfaced.
    expect(fixture.nativeElement.querySelector('[data-testid=open-m1]')).not.toBeNull();
    const toasts = TestBed.inject(ToasterService).toasts();
    expect(toasts.map((t) => t.tone)).toEqual(['error']);
  });

  it('cancelling the confirmation deletes nothing (ADR-0065)', () => {
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor' })]);

    (fixture.nativeElement.querySelector('[data-testid=delete-m1]') as HTMLButtonElement).click();
    lastDialog.close(false);
    fixture.detectChanges();

    expect(client.delete).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid=open-m1]')).not.toBeNull();
  });
});
