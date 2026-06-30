import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import {
  emptyEntityBody,
  EntityDetail,
  EntityPage,
  EntitySummary,
} from '@hexly/domain';
import { ActiveWorld } from '../../core/services/active-world';
import { EntitiesClient } from '../../core/services/entities.client';
import { ToasterService } from '../../core/services/toaster.service';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { MockEntitiesClient } from '../../core/testing/mock-entities-client';
import { EntityBrowser } from './entity-browser';

/** Let the entities client (Observable) round-trip settle. */
const tick = () => new Promise((r) => setTimeout(r));

describe('EntityBrowser', () => {
  let entities: MockEntitiesClient;
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

  const detailOf = (s: EntitySummary): EntityDetail => ({
    ...s,
    document: emptyEntityBody(s.type),
  });

  const page = (items: EntitySummary[], nextCursor: string | null = null): EntityPage => ({
    items,
    nextCursor,
  });

  beforeEach(async () => {
    entities = new MockEntitiesClient();
    await TestBed.configureTestingModule({
      imports: [EntityBrowser, provideTranslocoTesting()],
      providers: [
        { provide: EntitiesClient, useValue: entities },
        provideRouter([]),
      ],
    }).compileComponents();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    // The browser scopes to the active World (ADR-0028), pinned by the `w/:worldId`
    // route resolver in the app; pin it directly here.
    TestBed.inject(ActiveWorld).set('w1');
  });

  /** Drive the first page the client returns, then create + render the library. */
  async function renderWith(items: EntitySummary[], nextCursor: string | null = null) {
    entities.list.mockReturnValue(of(page(items, nextCursor)));
    const fixture = TestBed.createComponent(EntityBrowser);
    fixture.detectChanges(); // active-World effect -> list()
    await tick();
    fixture.detectChanges();
    return fixture;
  }

  const loadMore = (el: HTMLElement) =>
    el.querySelector('[data-testid=load-more]') as HTMLButtonElement | null;

  const titlesOf = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('[data-testid=entity-title]')).map((t) =>
      (t as HTMLElement).textContent?.trim(),
    );

  it('exposes the banner and main as sibling landmarks, not banner nested in main', async () => {
    const el = (await renderWith([])).nativeElement as HTMLElement;

    const banner = el.querySelector('[role="banner"]');
    const main = el.querySelector('main');
    expect(banner).not.toBeNull();
    expect(main).not.toBeNull();
    // The header is its own top-level landmark, not swallowed by the content region.
    expect(main!.contains(banner)).toBe(false);
  });

  it('renders its chrome and empty state in French when French is the active language', async () => {
    const fixture = await renderWith([]);
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

  it('owns its page heading in its page-owned header', async () => {
    const fixture = await renderWith([]);

    // The heading now lives in the page's own header (ADR-0022), visible — no
    // longer chrome contributed to a shell header.
    const heading = fixture.nativeElement.querySelector('h1');
    expect(heading?.textContent).toContain('Your library');
  });

  it('scopes the entity list to the World in the URL (ADR-0028)', async () => {
    const fixture = await renderWith([summary({ id: 'here', worldId: 'w1', name: 'In w1' })]);

    // The browser asks for the active World, excluding the Home Entity (the landing
    // page, not a library card). The server owns the filtering; the unit boundary is
    // the request scope.
    expect(entities.list).toHaveBeenCalledWith(
      expect.objectContaining({ worldId: 'w1', excludeHome: true }),
    );
    expect(titlesOf(fixture.nativeElement)).toEqual(['In w1']);
  });

  it('re-fetches scoped to the new World when the active World changes', async () => {
    const fixture = await renderWith([summary({ id: 'm1', worldId: 'w1', name: 'In w1' })]);

    entities.list.mockReturnValue(of(page([summary({ id: 'm2', worldId: 'w2', name: 'In w2' })])));
    TestBed.inject(ActiveWorld).set('w2');
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();

    expect(entities.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ worldId: 'w2', excludeHome: true }),
    );
    expect(titlesOf(fixture.nativeElement)).toEqual(['In w2']);
  });

  it('lists the entities the user owns, newest first', async () => {
    // The server orders newest-first; the browser renders what it receives.
    const fixture = await renderWith([
      summary({ id: 'newest', name: 'Aldermoor', updatedAt: 300 }),
      summary({ id: 'older', name: 'The Whisperwood', updatedAt: 100 }),
    ]);

    expect(titlesOf(fixture.nativeElement)).toEqual(['Aldermoor', 'The Whisperwood']);
  });

  it('shows each entity’s type', async () => {
    const fixture = await renderWith([
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

  it('shows each entity’s tags', async () => {
    const fixture = await renderWith([
      summary({ id: 'm1', name: 'Aldermoor', tags: ['kingdom', 'northern reach'] }),
    ]);

    const tags = fixture.nativeElement.querySelector(
      '[data-testid=tags-m1]',
    ) as HTMLElement;
    expect(tags.textContent).toContain('kingdom');
    expect(tags.textContent).toContain('northern reach');
  });

  it('omits the tag list entirely for an untagged entity', async () => {
    const fixture = await renderWith([summary({ id: 'm1', tags: [] })]);

    expect(
      fixture.nativeElement.querySelector('[data-testid=tags-m1]'),
    ).toBeNull();
  });

  it('renders the new-note action and type labels in French when French is active', async () => {
    const fixture = await renderWith([
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

  it('renders a card’s Delete action in French when French is the active language', async () => {
    const fixture = await renderWith([summary({ id: 'm1', name: 'Aldermoor' })]);

    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    const del = fixture.nativeElement.querySelector(
      '[data-testid=delete-m1]',
    ) as HTMLElement;
    // Icon button — assert the localized label on aria-label, not text content.
    expect(del.getAttribute('aria-label')).toBe('Supprimer');
  });

  it('formats the “Edited” timestamp for the active language, not the browser default', async () => {
    // A fixed instant at midday UTC so the calendar day is stable across the
    // runner's timezone; June (month 06) and day 22 read differently in EN
    // (month-first) and FR (day-first), so the active lang is observable.
    const updatedAt = Date.UTC(2026, 5, 22, 12, 0, 0);
    const enDate = new Date(updatedAt).toLocaleDateString('en');
    const frDate = new Date(updatedAt).toLocaleDateString('fr');
    expect(frDate).not.toBe(enDate); // sanity: the date distinguishes the locales

    const fixture = await renderWith([summary({ id: 'm1', name: 'Aldermoor', updatedAt })]);
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

  it('renders an entity name verbatim — never translated — even when it collides with a UI string', async () => {
    // "New map" is also a UI action label; an entity a user happened to name
    // that must stay their words, not get swapped for the French action copy.
    const fixture = await renderWith([summary({ id: 'm1', name: 'New map' })]);

    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    const title = fixture.nativeElement.querySelector(
      '[data-testid=entity-title]',
    ) as HTMLElement;
    expect(title.textContent?.trim()).toBe('New map');
    expect(title.textContent).not.toContain('Nouvelle carte');
  });

  it('shows a load-more affordance while there is a next page', async () => {
    // A page that carries a next cursor surfaces the affordance.
    const fixture = await renderWith([summary({ id: 'm1' })], 'cursor-2');
    expect(loadMore(fixture.nativeElement)).not.toBeNull();
  });

  it('shows no load-more affordance when the first page is the last (single page)', async () => {
    const fixture = await renderWith([summary({ id: 'm1' })]);
    expect(loadMore(fixture.nativeElement)).toBeNull();
  });

  it('fetches the next page with the cursor and appends it, then hides load-more on the last page', async () => {
    entities.list
      .mockReturnValueOnce(of(page([summary({ id: 'm1', name: 'Aldermoor', updatedAt: 300 })], 'cursor-2')))
      .mockReturnValueOnce(of(page([summary({ id: 'm2', name: 'The Whisperwood', updatedAt: 200 })], null)));

    const fixture = TestBed.createComponent(EntityBrowser);
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    loadMore(el)?.click();
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();

    // The next page is appended after the first — no duplicates, no gaps.
    expect(titlesOf(el)).toEqual(['Aldermoor', 'The Whisperwood']);
    // The load-more fetch carried the first page's cursor.
    expect(entities.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'cursor-2' }),
    );
    // Last page reached: the affordance is gone.
    expect(loadMore(el)).toBeNull();
  });

  it('ignores a second load-more click while the first is still in flight (no double-append)', async () => {
    entities.list.mockReturnValue(
      of(page([summary({ id: 'm1', updatedAt: 300 })], 'cursor-2')),
    );

    const fixture = TestBed.createComponent(EntityBrowser);
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    entities.list.mockReturnValue(of(page([summary({ id: 'm2', updatedAt: 200 })], null)));
    entities.list.mockClear();

    loadMore(el)?.click();
    fixture.detectChanges();
    // A second click before the page resolves must not fire a second request.
    loadMore(el)?.click();
    fixture.detectChanges();

    // Only one load-more fetch went out despite the double click.
    expect(entities.list).toHaveBeenCalledTimes(1);
  });

  it('shows an empty state when the user has no entities', async () => {
    const fixture = await renderWith([]);

    expect(fixture.nativeElement.querySelector('[data-testid=empty]')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid=entity-title]'),
    ).toBeNull();
  });

  it('renders the load-error state in French when French is the active language', async () => {
    entities.list.mockReturnValue(throwError(() => new Error('failed')));
    const fixture = TestBed.createComponent(EntityBrowser);
    fixture.detectChanges(); // active-World effect -> list() (fails)
    await tick();
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

  it('shows an error state when the entity list fails to load', async () => {
    entities.list.mockReturnValue(throwError(() => new Error('failed')));
    const fixture = TestBed.createComponent(EntityBrowser);
    fixture.detectChanges(); // active-World effect -> list() (fails)
    await tick();
    fixture.detectChanges();

    // A failed list surfaces an error panel rather than a permanently blank page.
    expect(
      fixture.nativeElement.querySelector('[data-testid=load-error]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid=empty]')).toBeNull();
  });

  it('creates a new hexmap and opens it in the editor', async () => {
    const fixture = await renderWith([]);
    entities.create.mockReturnValue(of(detailOf(summary({ id: 'new-map', type: 'hexmap' }))));

    (
      fixture.nativeElement.querySelector('[data-testid=new-map]') as HTMLButtonElement
    ).click();
    await tick();

    // Scoped to the World in the URL (ADR-0028), with the default map name.
    expect(entities.create).toHaveBeenCalledWith('Untitled map', 'hexmap', 'w1');
    expect(navigate).toHaveBeenCalledWith(['/w', 'w1', 'entities', 'new-map']);
  });

  it('creates a new note and opens it', async () => {
    const fixture = await renderWith([]);
    entities.create.mockReturnValue(of(detailOf(summary({ id: 'new-note', type: 'note' }))));

    (
      fixture.nativeElement.querySelector('[data-testid=new-note]') as HTMLButtonElement
    ).click();
    await tick();

    expect(entities.create).toHaveBeenCalledWith('Untitled note', 'note', 'w1');
    expect(navigate).toHaveBeenCalledWith(['/w', 'w1', 'entities', 'new-note']);
  });

  it('links a map’s card to its editor', async () => {
    const fixture = await renderWith([summary({ id: 'm1', name: 'Aldermoor' })]);

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

  it('renames an entity, then refreshes from page one (ADR-0025)', async () => {
    const fixture = await renderWith([summary({ id: 'm1', name: 'Aldermoor', version: 4 })]);
    const el = fixture.nativeElement as HTMLElement;
    entities.rename.mockReturnValue(of(detailOf(summary({ id: 'm1', name: 'Aldermoor Keep' }))));
    // The post-rename refresh re-lists page one, now reflecting the new name.
    entities.list.mockReturnValue(of(page([summary({ id: 'm1', name: 'Aldermoor Keep' })])));

    (el.querySelector('[data-testid=rename-m1]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const input = el.querySelector('[data-testid=rename-input-m1]') as HTMLInputElement;
    input.value = 'Aldermoor Keep';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await tick();
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();

    expect(entities.rename).toHaveBeenCalledWith('m1', 'Aldermoor Keep');
    // The page-one refresh renders the server state; the input is gone.
    expect(titlesOf(el)).toEqual(['Aldermoor Keep']);
    expect(el.querySelector('[data-testid=rename-input-m1]')).toBeNull();
  });

  it('closes the input and surfaces an error toast when a rename fails', async () => {
    const fixture = await renderWith([summary({ id: 'm1', name: 'Aldermoor', version: 4 })]);
    const el = fixture.nativeElement as HTMLElement;
    entities.rename.mockReturnValue(throwError(() => new Error('failed')));

    (el.querySelector('[data-testid=rename-m1]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const input = el.querySelector('[data-testid=rename-input-m1]') as HTMLInputElement;
    input.value = 'Aldermoor Keep';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await tick();
    fixture.detectChanges();

    // The input is closed (not left stuck open) and the failure is surfaced.
    expect(el.querySelector('[data-testid=rename-input-m1]')).toBeNull();
    const toasts = TestBed.inject(ToasterService).toasts();
    expect(toasts.map((t) => t.tone)).toEqual(['error']);
  });

  it('cancels an inline rename on Escape without saving', async () => {
    const fixture = await renderWith([summary({ id: 'm1', name: 'Aldermoor' })]);
    const el = fixture.nativeElement as HTMLElement;

    (el.querySelector('[data-testid=rename-m1]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const input = el.querySelector('[data-testid=rename-input-m1]') as HTMLInputElement;
    input.value = 'Discarded';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    // No rename round-trip, original name stays put with the editor closed.
    expect(entities.rename).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid=rename-input-m1]')).toBeNull();
    expect(titlesOf(el)).toEqual(['Aldermoor']);
  });

  it('deletes a map, then refreshes from page one (ADR-0025)', async () => {
    const fixture = await renderWith([
      summary({ id: 'm1', name: 'Aldermoor' }),
      summary({ id: 'm2', name: 'The Whisperwood' }),
    ]);
    entities.delete.mockReturnValue(of(undefined));
    // The post-delete refresh re-lists page one, now without the deleted map.
    entities.list.mockReturnValue(of(page([summary({ id: 'm2', name: 'The Whisperwood' })])));

    (
      fixture.nativeElement.querySelector('[data-testid=delete-m1]') as HTMLButtonElement
    ).click();
    await tick();
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();

    expect(entities.delete).toHaveBeenCalledWith('m1');
    expect(titlesOf(fixture.nativeElement)).toEqual(['The Whisperwood']);
  });

  it('keeps the card and surfaces an error toast when a delete fails', async () => {
    const fixture = await renderWith([summary({ id: 'm1', name: 'Aldermoor' })]);
    entities.delete.mockReturnValue(throwError(() => new Error('failed')));

    (
      fixture.nativeElement.querySelector('[data-testid=delete-m1]') as HTMLButtonElement
    ).click();
    await tick();
    fixture.detectChanges();

    // The card stays (the delete didn't take) and the failure is surfaced.
    expect(fixture.nativeElement.querySelector('[data-testid=open-m1]')).not.toBeNull();
    const toasts = TestBed.inject(ToasterService).toasts();
    expect(toasts.map((t) => t.tone)).toEqual(['error']);
  });
});
