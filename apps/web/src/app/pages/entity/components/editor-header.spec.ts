import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { emptyContent, EntityDetail } from '@hexly/domain';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { EntitySession } from '../services/entity-session';
import { HexMapStore } from '../services/hexmap-store';
import { EditorHeader } from './editor-header';

describe('EditorHeader', () => {
  let http: HttpTestingController;

  const aldermoor: EntityDetail = {
    id: 'm1',
    ownerId: 'u1',
    worldId: 'w1',
    name: 'The Reach of Aldermoor',
    type: 'hexmap',
    tags: [],
    visibility: 'private',
    version: 3,
    createdAt: 1,
    updatedAt: 1,
    document: { type: 'hexmap', content: emptyContent(), hexes: {}, regions: [], labels: [] },
  };

  /** Open an entity through the real session so the header has one to show/save. */
  function openMap(detail: EntityDetail): void {
    TestBed.inject(EntitySession).open(detail.id).subscribe();
    http.expectOne(`/api/entities/${detail.id}`).flush(detail);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EditorHeader, provideTranslocoTesting()],
      providers: [
        EntitySession,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('shows the open entity name', () => {
    openMap({ ...aldermoor, name: 'The Whisperwood' });

    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('The Whisperwood');
  });

  it('mounts the tag editor for the open map', () => {
    openMap(aldermoor);

    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-testid=entity-tags]'),
    ).not.toBeNull();
  });

  it('renames the open entity when the title is edited', () => {
    openMap(aldermoor);
    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    // Edit in place (contenteditable), commit on blur.
    const title = fixture.nativeElement.querySelector(
      '[data-testid=title]',
    ) as HTMLElement;
    title.textContent = 'The Whisperwood';
    title.dispatchEvent(new Event('blur'));

    const req = http.expectOne('/api/entities/m1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'The Whisperwood' });
    req.flush({ ...aldermoor, name: 'The Whisperwood' });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('The Whisperwood');
  });

  it('does not call the API when the title is left unchanged', () => {
    openMap(aldermoor);
    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector('[data-testid=title]') as HTMLElement
    ).dispatchEvent(new Event('blur'));

    http.expectNone('/api/entities/m1');
  });

  it('no longer carries app-level navigation — that lives in the rail (ADR-0022)', () => {
    openMap(aldermoor);
    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    // All Maps / Design System are rail destinations, not header buttons.
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('All maps');
    expect(text).not.toContain('Design system');
    expect(fixture.nativeElement.querySelector('a[href="/entities"]')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('a[href="/styleguide"]'),
    ).toBeNull();
  });

  it('renders its chrome and actions in French when French is the active language', () => {
    openMap(aldermoor);
    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    // No reload: flipping the active language re-renders the live component.
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Partager');
    // The autosave status chip (no Save button anymore, ADR-0026): clean → "Enregistré".
    expect(el.textContent).toContain('Enregistré');
    expect(el.textContent).not.toContain('Saved');
  });

  it('keeps the user’s entity name verbatim — never translated — under French', () => {
    openMap({ ...aldermoor, name: 'Save' }); // collides with a UI action label
    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    const title = fixture.nativeElement.querySelector(
      '[data-testid=title]',
    ) as HTMLButtonElement;
    expect(title.textContent?.trim()).toBe('Save');
  });

  // Map/Note toggle (#75): a hexmap carries both a grid and a Content body, so the
  // header switches between the two editor surfaces.
  it('offers a Map/Note view toggle, with Map active by default', () => {
    openMap(aldermoor);
    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    const map = fixture.nativeElement.querySelector(
      '[data-testid=view-map]',
    ) as HTMLButtonElement;
    const note = fixture.nativeElement.querySelector(
      '[data-testid=view-note]',
    ) as HTMLButtonElement;
    expect(map).not.toBeNull();
    expect(note).not.toBeNull();
    // Default is the grid: Map pressed, Note not.
    expect(map.getAttribute('aria-pressed')).toBe('true');
    expect(note.getAttribute('aria-pressed')).toBe('false');
  });

  it('switches the editor surface to the Note view when Note is clicked', () => {
    openMap(aldermoor);
    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector('[data-testid=view-note]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    // The store is the single owner of the surface choice (shared with the shell).
    expect(TestBed.inject(HexMapStore).view()).toBe('note');
    expect(
      (
        fixture.nativeElement.querySelector('[data-testid=view-note]') as HTMLButtonElement
      ).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('mirrors the chosen view to the URL so a refresh keeps it (#75)', () => {
    openMap(aldermoor);
    const fixture = TestBed.createComponent(EditorHeader);
    fixture.detectChanges();

    const nav = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);

    (
      fixture.nativeElement.querySelector('[data-testid=view-note]') as HTMLButtonElement
    ).click();
    // Persisted as ?view=note (replaceUrl — a view flip is not a navigation).
    expect(nav).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { view: 'note' }, replaceUrl: true }),
    );

    (
      fixture.nativeElement.querySelector('[data-testid=view-map]') as HTMLButtonElement
    ).click();
    // The default Map view drops the param to keep the URL clean.
    expect(nav).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { view: null }, replaceUrl: true }),
    );
  });
});
