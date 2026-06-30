import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { of, Subject, throwError } from 'rxjs';
import { EntityPage, EntitySummary } from '@hexly/domain';
import { EntitiesClient } from '../../core/services/entities.client';
import { MockEntitiesClient } from '../../core/testing/entities-client.mock';
import { ActiveWorld } from '../../core/services/active-world';
import { ToasterService } from '../../core/services/toaster.service';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { EntityBrowser } from './entity-browser';

describe('EntityBrowser', () => {
  let client: MockEntitiesClient;
  let navigate: ReturnType<typeof vi.spyOn>;

  const summary = (over: Partial<EntitySummary>): EntitySummary => ({
    id: 'x',
    ownerId: 'u1',
    worldId: 'w1',
    name: 'A map',
    type: 'hexmap',
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  });

  beforeEach(async () => {
    client = new MockEntitiesClient();
    await TestBed.configureTestingModule({
      imports: [EntityBrowser, provideTranslocoTesting()],
      providers: [
        { provide: EntitiesClient, useValue: client },
        provideRouter([]),
      ],
    }).compileComponents();
    navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);

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

  const loadMore = (el: HTMLElement) =>
    el.querySelector('[data-testid=load-more]') as HTMLButtonElement | null;

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
    const newMap = el.querySelector('[data-testid=new-map]') as HTMLElement;
    expect(newMap.textContent).toContain('Nouvelle carte');
    expect(newMap.textContent).not.toContain('New map');
    expect(el.querySelector('[data-testid=empty]')?.textContent).toContain(
      'Votre bibliothèque est vide.',
    );
    expect(el.textContent).toContain(
      'Créez une note ou une carte pour commencer.',
    );
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

    expect(client.list).toHaveBeenCalledWith({ limit: 50, worldId: 'w1' });
  });

  it('re-fetches scoped to the new World when the active World changes', () => {
    const fixture = renderWith([summary({ id: 'm1' })]); // initial fetch, World w1

    client.list.mockReturnValueOnce(of({ items: [], nextCursor: null }));
    TestBed.inject(ActiveWorld).set('w2');
    fixture.detectChanges();

    expect(client.list).toHaveBeenCalledWith({ limit: 50, worldId: 'w2' });
  });

  it('lists the entities the user owns, newest first', () => {
    const fixture = renderWith([
      summary({ id: 'older', name: 'The Whisperwood', updatedAt: 100 }),
      summary({ id: 'newest', name: 'Aldermoor', updatedAt: 300 }),
    ]);

    const titles = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid=entity-title]'),
    ).map((el) => (el as HTMLElement).textContent?.trim());
    expect(titles).toEqual(['Aldermoor', 'The Whisperwood']);
  });

  it('shows each entity’s type', () => {
    const fixture = renderWith([
      summary({ id: 'm1', name: 'Aldermoor', type: 'hexmap' }),
      summary({ id: 'n1', name: 'Lady Mara', type: 'note' }),
    ]);
    const typeOf = (id: string) =>
      (
        fixture.nativeElement.querySelector(
          `[data-testid=type-${id}]`,
        ) as HTMLElement
      )?.textContent?.trim();

    expect(typeOf('m1')).toBe('Map');
    expect(typeOf('n1')).toBe('Note');
  });

  it('shows each entity’s tags', () => {
    const fixture = renderWith([
      summary({ id: 'm1', name: 'Aldermoor', tags: ['kingdom', 'northern reach'] }),
    ]);

    const tags = fixture.nativeElement.querySelector(
      '[data-testid=tags-m1]',
    ) as HTMLElement;
    expect(tags.textContent).toContain('kingdom');
    expect(tags.textContent).toContain('northern reach');
  });

  it('omits the tag list entirely for an untagged entity', () => {
    const fixture = renderWith([summary({ id: 'm1', tags: [] })]);

    expect(
      fixture.nativeElement.querySelector('[data-testid=tags-m1]'),
    ).toBeNull();
  });

  it('renders the new-note action and type labels in French when French is active', () => {
    const fixture = renderWith([
      summary({ id: 'm1', name: 'Aldermoor', type: 'hexmap' }),
      summary({ id: 'n1', name: 'Lady Mara', type: 'note' }),
    ]);
    const el = fixture.nativeElement as HTMLElement;

    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    expect(
      (el.querySelector('[data-testid=new-note]') as HTMLElement).textContent,
    ).toContain('Nouvelle note');
    expect(
      (el.querySelector('[data-testid=type-m1]') as HTMLElement).textContent?.trim(),
    ).toBe('Carte');
    expect(
      (el.querySelector('[data-testid=type-n1]') as HTMLElement).textContent?.trim(),
    ).toBe('Note');
    // The rename action is an icon button — its label lives in aria-label/title.
    expect(
      (el.querySelector('[data-testid=rename-m1]') as HTMLElement).getAttribute(
        'aria-label',
      ),
    ).toBe('Renommer');
  });

  it('renders a card’s Delete action in French when French is the active language', () => {
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor' })]);

    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    const del = fixture.nativeElement.querySelector(
      '[data-testid=delete-m1]',
    ) as HTMLElement;
    // Icon button — assert the localized label on aria-label, not text content.
    expect(del.getAttribute('aria-label')).toBe('Supprimer');
  });

  it('formats the “Edited” timestamp for the active language, not the browser default', () => {
    // A fixed instant at midday UTC so the calendar day is stable across the
    // runner's timezone; June (month 06) and day 22 read differently in EN
    // (month-first) and FR (day-first), so the active lang is observable.
    const updatedAt = Date.UTC(2026, 5, 22, 12, 0, 0);
    const enDate = new Date(updatedAt).toLocaleDateString('en');
    const frDate = new Date(updatedAt).toLocaleDateString('fr');
    expect(frDate).not.toBe(enDate); // sanity: the date distinguishes the locales

    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor', updatedAt })]);
    const meta = () =>
      (fixture.nativeElement.querySelector('.meta') as HTMLElement).textContent ?? '';

    // English is the default lang: month-first format, English prefix.
    expect(meta()).toContain(`Edited ${enDate}`);

    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    // French active: the date reflows to day-first and the prefix translates.
    expect(meta()).toContain(`Modifié le ${frDate}`);
    expect(meta()).not.toContain(enDate);
    expect(meta()).not.toContain('Edited');
  });

  it('renders an entity name verbatim — never translated — even when it collides with a UI string', () => {
    // "New map" is also a UI action label; an entity a user happened to name
    // that must stay their words, not get swapped for the French action copy.
    const fixture = renderWith([summary({ id: 'm1', name: 'New map' })]);

    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    const title = fixture.nativeElement.querySelector(
      '[data-testid=entity-title]',
    ) as HTMLElement;
    expect(title.textContent?.trim()).toBe('New map');
    expect(title.textContent).not.toContain('Nouvelle carte');
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
    const fixture = renderWith(
      [summary({ id: 'm1', name: 'Aldermoor', updatedAt: 300 })],
      'cursor-2',
    );
    const el = fixture.nativeElement as HTMLElement;

    client.list.mockReturnValueOnce(
      of({
        items: [summary({ id: 'm2', name: 'The Whisperwood', updatedAt: 200 })],
        nextCursor: null,
      }),
    );
    loadMore(el)?.click();
    expect(client.list).toHaveBeenCalledWith({ cursor: 'cursor-2', worldId: 'w1' });
    fixture.detectChanges();

    // The next page is appended after the first — no duplicates, no gaps.
    const titles = Array.from(el.querySelectorAll('[data-testid=entity-title]')).map(
      (t) => (t as HTMLElement).textContent?.trim(),
    );
    expect(titles).toEqual(['Aldermoor', 'The Whisperwood']);
    // Last page reached: the affordance is gone.
    expect(loadMore(el)).toBeNull();
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
    pending.next({ items: [summary({ id: 'm2', updatedAt: 200 })], nextCursor: null });
    pending.complete();
  });

  it('shows an empty state when the user has no entities', () => {
    const fixture = renderWith([]);

    expect(fixture.nativeElement.querySelector('[data-testid=empty]')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid=entity-title]'),
    ).toBeNull();
  });

  it('renders the load-error state in French when French is the active language', () => {
    client.list.mockReturnValueOnce(throwError(() => new Error('boom')));
    const fixture = TestBed.createComponent(EntityBrowser);
    fixture.detectChanges(); // active-World effect -> list()
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector(
      '[data-testid=load-error]',
    ) as HTMLElement;
    expect(error.textContent).toContain('Impossible de charger votre bibliothèque.');
    expect(error.textContent).toContain(
      'Une erreur est survenue. Veuillez réessayer dans un instant.',
    );
  });

  it('shows an error state when the entity list fails to load', () => {
    client.list.mockReturnValueOnce(throwError(() => new Error('boom')));
    const fixture = TestBed.createComponent(EntityBrowser);
    fixture.detectChanges(); // active-World effect -> list()
    fixture.detectChanges();

    // A failed list surfaces an error panel rather than a permanently blank page.
    expect(
      fixture.nativeElement.querySelector('[data-testid=load-error]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid=empty]')).toBeNull();
  });

  it('creates a new hexmap and opens it in the editor', () => {
    const fixture = renderWith([]);

    client.create.mockReturnValueOnce(
      of({
        ...summary({ id: 'created', name: 'Untitled map' }),
        document: { type: 'hexmap', content: { format: 'tiptap-v1', snapshot: {} }, hexes: {}, regions: [], labels: [] },
      }),
    );
    (
      fixture.nativeElement.querySelector('[data-testid=new-map]') as HTMLButtonElement
    ).click();

    // Scoped to the World in the URL (ADR-0028).
    expect(client.create).toHaveBeenCalledWith('Untitled map', 'hexmap', 'w1');
    expect(navigate).toHaveBeenCalledWith(['/w', 'w1', 'entities', 'created']);
  });

  it('creates a new note and opens it', () => {
    const fixture = renderWith([]);

    client.create.mockReturnValueOnce(
      of({
        ...summary({ id: 'created', name: 'Untitled note', type: 'note' }),
        document: { type: 'note', content: { format: 'tiptap-v1', snapshot: {} } },
      }),
    );
    (
      fixture.nativeElement.querySelector('[data-testid=new-note]') as HTMLButtonElement
    ).click();

    expect(client.create).toHaveBeenCalledWith('Untitled note', 'note', 'w1');
    expect(navigate).toHaveBeenCalledWith(['/w', 'w1', 'entities', 'created']);
  });

  it('links a map’s card to its editor', () => {
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor' })]);

    // The whole tile is a routerLink anchor (stretched-link inset), so assert the
    // resolved href rather than a navigate() call.
    expect(
      (
        fixture.nativeElement.querySelector(
          '[data-testid=open-m1]',
        ) as HTMLAnchorElement
      ).getAttribute('href'),
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

    client.rename.mockReturnValueOnce(
      of({
        ...summary({ id: 'm1', name: 'Aldermoor Keep', version: 4 }),
        document: { type: 'hexmap', content: { format: 'tiptap-v1', snapshot: {} }, hexes: {}, regions: [], labels: [] },
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

    expect(client.rename).toHaveBeenCalledWith('m1', 'Aldermoor Keep');
    expect(client.list).toHaveBeenCalledWith({ limit: 50, worldId: 'w1' });
    fixture.detectChanges();

    // The card shows the new name and the input is gone (back to read mode).
    expect(
      (el.querySelector('[data-testid=entity-title]') as HTMLElement).textContent?.trim(),
    ).toBe('Aldermoor Keep');
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
    client.rename.mockReturnValueOnce(throwError(() => new Error('boom')));
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
    expect(client.rename).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid=rename-input-m1]')).toBeNull();
    expect(
      (el.querySelector('[data-testid=entity-title]') as HTMLElement).textContent?.trim(),
    ).toBe('Aldermoor');
  });

  it('deletes a map, then refreshes from page one (ADR-0025)', () => {
    const fixture = renderWith([
      summary({ id: 'm1', name: 'Aldermoor' }),
      summary({ id: 'm2', name: 'The Whisperwood' }),
    ]);

    client.delete.mockReturnValueOnce(of(undefined));
    // The delete is followed by a page-one refresh; the view reflects the server.
    client.list.mockReturnValueOnce(
      of({ items: [summary({ id: 'm2', name: 'The Whisperwood' })], nextCursor: null }),
    );
    (
      fixture.nativeElement.querySelector('[data-testid=delete-m1]') as HTMLButtonElement
    ).click();

    expect(client.delete).toHaveBeenCalledWith('m1');
    expect(client.list).toHaveBeenCalledWith({ limit: 50, worldId: 'w1' });
    fixture.detectChanges();

    const titles = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid=entity-title]'),
    ).map((el) => (el as HTMLElement).textContent?.trim());
    expect(titles).toEqual(['The Whisperwood']);
  });

  it('keeps the card and surfaces an error toast when a delete fails', () => {
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor' })]);

    client.delete.mockReturnValueOnce(throwError(() => new Error('boom')));
    (
      fixture.nativeElement.querySelector('[data-testid=delete-m1]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    // The card stays (the delete didn't take) and the failure is surfaced.
    expect(fixture.nativeElement.querySelector('[data-testid=open-m1]')).not.toBeNull();
    const toasts = TestBed.inject(ToasterService).toasts();
    expect(toasts.map((t) => t.tone)).toEqual(['error']);
  });
});
