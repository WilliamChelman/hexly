import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { EntitySummary } from '@hexly/domain';
import { AuthStore } from '../auth/auth.store';
import { ToasterService } from '../core/toaster.service';
import { provideTranslocoTesting } from '../core/i18n/transloco-testing';
import { EntityBrowser } from './entity-browser';

describe('EntityBrowser', () => {
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  const summary = (over: Partial<EntitySummary>): EntitySummary => ({
    id: 'x',
    ownerId: 'u1',
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
    await TestBed.configureTestingModule({
      imports: [EntityBrowser, provideTranslocoTesting()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    // A signed-in user the library header can display.
    TestBed.inject(AuthStore).login('ada@hexly.test', 'pw').subscribe();
    http.expectOne('/auth/login').flush({
      id: 'u1',
      email: 'ada@hexly.test',
      displayName: 'Ada',
    });
  });

  afterEach(() => http.verify());

  /** Create the library and resolve its initial list with `entities`. */
  function renderWith(entities: EntitySummary[]) {
    const fixture = TestBed.createComponent(EntityBrowser);
    fixture.detectChanges(); // ngOnInit -> GET /entities
    http.expectOne('/entities').flush(entities);
    fixture.detectChanges();
    return fixture;
  }

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

  it('lists the entities the user owns, newest first', () => {
    const fixture = renderWith([
      summary({ id: 'older', name: 'The Whisperwood', updatedAt: 100 }),
      summary({ id: 'newest', name: 'Aldermoor', updatedAt: 300 }),
    ]);

    const titles = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid=map-title]'),
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
    expect(
      (el.querySelector('[data-testid=rename-m1]') as HTMLElement).textContent,
    ).toContain('Renommer');
  });

  it('renders a card’s Delete action in French when French is the active language', () => {
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor' })]);

    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    const del = fixture.nativeElement.querySelector(
      '[data-testid=delete-m1]',
    ) as HTMLElement;
    expect(del.textContent).toContain('Supprimer');
    expect(del.textContent).not.toContain('Delete');
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
      '[data-testid=map-title]',
    ) as HTMLElement;
    expect(title.textContent?.trim()).toBe('New map');
    expect(title.textContent).not.toContain('Nouvelle carte');
  });

  it('shows an empty state when the user has no entities', () => {
    const fixture = renderWith([]);

    expect(fixture.nativeElement.querySelector('[data-testid=empty]')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid=map-title]'),
    ).toBeNull();
  });

  it('renders the load-error state in French when French is the active language', () => {
    const fixture = TestBed.createComponent(EntityBrowser);
    fixture.detectChanges(); // ngOnInit -> GET /entities
    http
      .expectOne('/entities')
      .flush(null, { status: 500, statusText: 'Server Error' });
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
    const fixture = TestBed.createComponent(EntityBrowser);
    fixture.detectChanges(); // ngOnInit -> GET /entities
    http
      .expectOne('/entities')
      .flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    // A failed list surfaces an error panel rather than a permanently blank page.
    expect(
      fixture.nativeElement.querySelector('[data-testid=load-error]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid=empty]')).toBeNull();
  });

  it('creates a new hexmap and opens it in the editor', () => {
    const fixture = renderWith([]);

    (
      fixture.nativeElement.querySelector('[data-testid=new-map]') as HTMLButtonElement
    ).click();

    const req = http.expectOne('/entities');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Untitled map', type: 'hexmap' });
    req.flush({
      ...summary({ id: 'created', name: 'Untitled map' }),
      document: { type: 'hexmap', content: { format: 'tiptap-v1', snapshot: {} }, hexes: {}, regions: [], labels: [] },
    });

    expect(navigate).toHaveBeenCalledWith(['/entities', 'created']);
  });

  it('creates a new note and opens it', () => {
    const fixture = renderWith([]);

    (
      fixture.nativeElement.querySelector('[data-testid=new-note]') as HTMLButtonElement
    ).click();

    const req = http.expectOne('/entities');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Untitled note', type: 'note' });
    req.flush({
      ...summary({ id: 'created', name: 'Untitled note', type: 'note' }),
      document: { type: 'note', content: { format: 'tiptap-v1', snapshot: {} } },
    });

    expect(navigate).toHaveBeenCalledWith(['/entities', 'created']);
  });

  it('opens a map when its card is activated', () => {
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor' })]);

    (
      fixture.nativeElement.querySelector('[data-testid=open-m1]') as HTMLElement
    ).click();

    expect(navigate).toHaveBeenCalledWith(['/entities', 'm1']);
  });

  it('renames an entity in place, changing only its name', () => {
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor', version: 4 })]);
    const el = fixture.nativeElement as HTMLElement;

    (el.querySelector('[data-testid=rename-m1]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const input = el.querySelector('[data-testid=rename-input-m1]') as HTMLInputElement;
    input.value = 'Aldermoor Keep';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    const req = http.expectOne('/entities/m1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'Aldermoor Keep' });
    req.flush({
      ...summary({ id: 'm1', name: 'Aldermoor Keep', version: 4 }),
      document: { type: 'hexmap', content: { format: 'tiptap-v1', snapshot: {} }, hexes: {}, regions: [], labels: [] },
    });
    fixture.detectChanges();

    // The card shows the new name and the input is gone (back to read mode).
    expect(
      (el.querySelector('[data-testid=map-title]') as HTMLElement).textContent?.trim(),
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
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    http
      .expectOne('/entities/m1')
      .flush(null, { status: 500, statusText: 'Server Error' });
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

    // No PATCH (afterEach http.verify() would fail on a pending request), and the
    // original name stays put with the editor closed.
    expect(el.querySelector('[data-testid=rename-input-m1]')).toBeNull();
    expect(
      (el.querySelector('[data-testid=map-title]') as HTMLElement).textContent?.trim(),
    ).toBe('Aldermoor');
  });

  it('deletes a map and removes it from the list', () => {
    const fixture = renderWith([
      summary({ id: 'm1', name: 'Aldermoor' }),
      summary({ id: 'm2', name: 'The Whisperwood' }),
    ]);

    (
      fixture.nativeElement.querySelector('[data-testid=delete-m1]') as HTMLButtonElement
    ).click();
    http.expectOne('/entities/m1').flush(null);
    fixture.detectChanges();

    const titles = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid=map-title]'),
    ).map((el) => (el as HTMLElement).textContent?.trim());
    expect(titles).toEqual(['The Whisperwood']);
  });

  it('keeps the card and surfaces an error toast when a delete fails', () => {
    const fixture = renderWith([summary({ id: 'm1', name: 'Aldermoor' })]);

    (
      fixture.nativeElement.querySelector('[data-testid=delete-m1]') as HTMLButtonElement
    ).click();
    http
      .expectOne('/entities/m1')
      .flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    // The card stays (the delete didn't take) and the failure is surfaced.
    expect(fixture.nativeElement.querySelector('[data-testid=open-m1]')).not.toBeNull();
    const toasts = TestBed.inject(ToasterService).toasts();
    expect(toasts.map((t) => t.tone)).toEqual(['error']);
  });
});
