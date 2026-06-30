import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { emptyContent, EntityDetail } from '@hexly/domain';
import { of } from 'rxjs';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { MockEntitySession } from '../../../core/testing/mock-entity-session';
import { EntitySession } from '../services/entity-session';
import { HexMapStore } from '../services/hexmap-store';
import { EntityHeader } from './entity-header';
import { noteDetail } from './entity-detail.fixtures';

describe('EntityHeader', () => {
  let session: MockEntitySession;

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

  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

  /** Open `detail` through the session facade (drives the header's `current()`). */
  function open(detail: EntityDetail): void {
    session.setCurrent(detail);
  }

  beforeEach(async () => {
    session = new MockEntitySession();
    await TestBed.configureTestingModule({
      imports: [EntityHeader, provideTranslocoTesting()],
      providers: [
        { provide: EntitySession, useValue: session },
        provideRouter([]),
      ],
    }).compileComponents();
  });

  it('shows the open entity name', () => {
    open({ ...aldermoor, name: 'The Whisperwood' });

    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('The Whisperwood');
  });

  it('mounts the tag editor for the open entity', () => {
    open(aldermoor);

    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-testid=entity-tags]'),
    ).not.toBeNull();
  });

  it('renames the open entity when the title is edited', async () => {
    open(aldermoor);
    // A clean rename advances the open Entity — the header mirrors the new name.
    session.rename.mockImplementation((name) => {
      const renamed = { ...aldermoor, name };
      session.setCurrent(renamed);
      return of(renamed);
    });
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    // Edit in place (contenteditable), commit on blur.
    const title = fixture.nativeElement.querySelector('[data-testid=title]') as HTMLElement;
    title.textContent = 'The Whisperwood';
    title.dispatchEvent(new Event('blur'));
    await tick();
    fixture.detectChanges();

    expect(session.rename).toHaveBeenCalledWith('The Whisperwood');
    expect(fixture.nativeElement.textContent).toContain('The Whisperwood');
  });

  it('does not call the API when the title is left unchanged', async () => {
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('[data-testid=title]') as HTMLElement).dispatchEvent(
      new Event('blur'),
    );
    await tick();

    // No rename round-trip on an unchanged title.
    expect(session.rename).not.toHaveBeenCalled();
  });

  it('no longer carries app-level navigation — that lives in the rail (ADR-0022)', () => {
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    // All Maps / Design System are rail destinations, not header buttons.
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('All maps');
    expect(text).not.toContain('Design system');
    expect(fixture.nativeElement.querySelector('a[href="/entities"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/styleguide"]')).toBeNull();
  });

  // The Home Entity's title is the World's name (ADR-0029): read-only here, renamed
  // via the World. The note view shows it but never lets the user edit it in place.
  it('renders the Home Entity title read-only, with a tooltip pointing to the World', () => {
    open({ ...noteDetail('Aldermoor'), isHome: true });
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    const title = fixture.nativeElement.querySelector('[data-testid=title]') as HTMLElement;
    // Not editable: no contenteditable, no keyboard reach.
    expect(title.getAttribute('contenteditable')).toBeNull();
    expect(title.getAttribute('tabindex')).toBeNull();
    // Renamed via the World, not here — the hint says so.
    expect(title.getAttribute('title')).toBe('Renamed with the world');
    expect(title.textContent).toContain('Aldermoor');
  });

  it('does not rename when an unchanged title blur fires on the Home Entity', async () => {
    open({ ...noteDetail('Aldermoor'), isHome: true });
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('[data-testid=title]') as HTMLElement).dispatchEvent(
      new Event('blur'),
    );
    await tick();

    expect(session.rename).not.toHaveBeenCalled();
  });

  it('renders its chrome and actions in French when French is the active language', () => {
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
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
    open({ ...aldermoor, name: 'Save' }); // collides with a UI action label
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    const title = fixture.nativeElement.querySelector('[data-testid=title]') as HTMLButtonElement;
    expect(title.textContent?.trim()).toBe('Save');
  });

  // Map/Note toggle (#75): a hexmap carries both a grid and a Content body, so the
  // header switches between the two editor surfaces.
  it('offers a Map/Note view toggle for a hexmap, with Map active by default', () => {
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    const map = fixture.nativeElement.querySelector('[data-testid=view-map]') as HTMLButtonElement;
    const noteBtn = fixture.nativeElement.querySelector('[data-testid=view-note]') as HTMLButtonElement;
    expect(map).not.toBeNull();
    expect(noteBtn).not.toBeNull();
    // Default is the grid: Map pressed, Note not.
    expect(map.getAttribute('aria-pressed')).toBe('true');
    expect(noteBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('omits the view toggle for a note — it has no grid surface to switch to', () => {
    open(noteDetail('Lady Mara'));
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid=view-map]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid=view-note]')).toBeNull();
    // The title is still editable — a note can be renamed too.
    expect(fixture.nativeElement.textContent).toContain('Lady Mara');
  });

  it('switches the editor surface to the Note view when Note is clicked', () => {
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('[data-testid=view-note]') as HTMLButtonElement).click();
    fixture.detectChanges();

    // The store is the single owner of the surface choice (shared with the shell).
    expect(TestBed.inject(HexMapStore).view()).toBe('note');
    expect(
      (fixture.nativeElement.querySelector('[data-testid=view-note]') as HTMLButtonElement).getAttribute(
        'aria-pressed',
      ),
    ).toBe('true');
  });

  it('mirrors the chosen view to the URL so a refresh keeps it (#75)', () => {
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    (fixture.nativeElement.querySelector('[data-testid=view-note]') as HTMLButtonElement).click();
    // Persisted as ?view=note (replaceUrl — a view flip is not a navigation).
    expect(nav).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { view: 'note' }, replaceUrl: true }),
    );

    (fixture.nativeElement.querySelector('[data-testid=view-map]') as HTMLButtonElement).click();
    // The default Map view drops the param to keep the URL clean.
    expect(nav).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { view: null }, replaceUrl: true }),
    );
  });
});
