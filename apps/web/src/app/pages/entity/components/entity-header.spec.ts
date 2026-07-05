import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { emptyContent, EntityDetail } from '@hexly/domain';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { EntitiesClient } from '../../../core/services/entities.client';
import { MockEntitiesClient } from '../../../core/testing/entities-client.mock';
import { UsersClient } from '../../../core/services/users.client';
import { MockUsersClient } from '../../../core/testing/users-client.mock';
import { AuthClient } from '../../../core/services/auth.client';
import { MockAuthClient } from '../../../core/testing/auth-client.mock';
import { EntitySession } from '../services/entity-session';
import { HexMapStore } from '../services/hexmap-store';
import { OwnerSet } from '../../../ui/owner-set';
import { EntityHeader } from './entity-header';
import { noteDetail } from './entity-detail.fixtures';

describe('EntityHeader', () => {
  let entities: MockEntitiesClient;

  const aldermoor: EntityDetail = {
    id: 'm1',
    worldId: 'w1',
    name: 'The Reach of Aldermoor',
    type: 'hexmap',
    tags: [],
    visibility: 'private',
    version: 3,
    createdAt: 1,
    updatedAt: 1,
    // The default opener is an Owner: writable and can manage sharing (ADR-0037).
    canManage: true,
    document: { type: 'hexmap', content: emptyContent(), hexes: {}, regions: [], labels: [] },
  };

  /** Open an entity through the real session so the header has one to show/save. */
  function open(detail: EntityDetail): void {
    entities.load.mockReturnValue(of(detail));
    TestBed.inject(EntitySession).open(detail.id).subscribe();
  }

  beforeEach(async () => {
    entities = new MockEntitiesClient();
    await TestBed.configureTestingModule({
      imports: [EntityHeader, provideTranslocoTesting()],
      providers: [
        EntitySession,
        { provide: EntitiesClient, useValue: entities },
        { provide: UsersClient, useValue: new MockUsersClient() },
        { provide: AuthClient, useValue: new MockAuthClient() },
        provideRouter([]),
      ],
    }).compileComponents();
  });

  it('opens the entity owner set from the Share action', () => {
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.directive(OwnerSet))).toBeNull();

    fixture.nativeElement
      .querySelector('[data-testid=manage-owners]')
      .click();
    fixture.detectChanges();

    const set = fixture.debugElement.query(By.directive(OwnerSet))
      ?.componentInstance as OwnerSet;
    expect(set.kind()).toBe('entity');
    expect(set.id()).toBe('m1');
  });

  it('closes the owner set from its Close action', () => {
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid=manage-owners]').click();
    fixture.detectChanges();

    fixture.nativeElement.querySelector('[data-testid=owners-close]').click();
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.directive(OwnerSet))).toBeNull();
  });

  it('hides the Share action for a read-only opener (canManage:false)', () => {
    // A Viewer grant / read-only member / Public Link reader (ADR-0037): content shows,
    // but Share (owner/grant/link management) is owner-only and must be withheld.
    open({ ...aldermoor, canWrite: false, canManage: false });
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid=manage-owners]')).toBeNull();
  });

  it('hides the Share action for a writer who is not an Owner (canManage:false)', () => {
    // An entity-level Editor or a World Owner opens writable (canWrite:true) but can't manage
    // sharing — the dialog is owner-only, so the button must stay hidden or it opens onto 403s.
    open({ ...aldermoor, canWrite: true, canManage: false });
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid=manage-owners]')).toBeNull();
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

  it('renames the open entity when the title is edited', () => {
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    // Edit in place (contenteditable), commit on blur.
    entities.patch.mockReturnValue(of({ ...aldermoor, name: 'The Whisperwood' }));
    const title = fixture.nativeElement.querySelector(
      '[data-testid=title]',
    ) as HTMLElement;
    title.textContent = 'The Whisperwood';
    title.dispatchEvent(new Event('blur'));

    expect(entities.patch).toHaveBeenCalledWith('m1', { name: 'The Whisperwood' });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('The Whisperwood');
  });

  it('does not call the API when the title is left unchanged', () => {
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector('[data-testid=title]') as HTMLElement
    ).dispatchEvent(new Event('blur'));

    expect(entities.patch).not.toHaveBeenCalled();
  });

  it('toggles the open entity’s visibility from the header', () => {
    open(aldermoor); // private
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector(
      '[data-testid=visibility-toggle]',
    ) as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    // Reflects current visibility: private → not shared.
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    entities.patch.mockReturnValue(of({ ...aldermoor, visibility: 'shared' }));
    toggle.click();
    fixture.detectChanges();

    expect(entities.patch).toHaveBeenCalledWith('m1', { visibility: 'shared' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  // FIX #5: a rejected flip (e.g. a writable-then-revoked 403 race) must be a graceful
  // no-op — handled like a failed rename — not an unhandled RxJS error on a macrotask.
  it('handles a rejected visibility flip gracefully, without an unhandled error', () => {
    vi.useFakeTimers();
    try {
      open(aldermoor); // private
      const fixture = TestBed.createComponent(EntityHeader);
      fixture.detectChanges();

      entities.patch.mockReturnValue(throwError(() => new Error('403')));
      const toggle = fixture.nativeElement.querySelector(
        '[data-testid=visibility-toggle]',
      ) as HTMLButtonElement;
      toggle.click();
      fixture.detectChanges();

      // A bare subscribe would report the rejection as an unhandled error on a timer;
      // the error handler makes it a no-op, so draining timers throws nothing.
      expect(() => vi.runOnlyPendingTimers()).not.toThrow();
      // State stays as the server has it: still private.
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
    } finally {
      vi.useRealTimers();
    }
  });

  // The Home Entity is locked `shared` (ADR-0037) — no toggle, like its read-only title.
  it('hides the visibility toggle on the Home Entity', () => {
    open({ ...noteDetail('Aldermoor'), isHome: true });
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-testid=visibility-toggle]'),
    ).toBeNull();
  });

  // A read-only World member (canWrite:false, ADR-0037) sees the entity but can't edit it:
  // the title is read-only and the owner-only visibility toggle is hidden, like the Home Entity.
  it('renders a read-only entity’s title non-editable, with no visibility toggle', () => {
    open({ ...aldermoor, canWrite: false });
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    const title = fixture.nativeElement.querySelector(
      '[data-testid=title]',
    ) as HTMLElement;
    expect(title.getAttribute('contenteditable')).toBeNull();
    expect(title.getAttribute('tabindex')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid=visibility-toggle]'),
    ).toBeNull();
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
    expect(
      fixture.nativeElement.querySelector('a[href="/styleguide"]'),
    ).toBeNull();
  });

  // The Home Entity's title is the World's name (ADR-0029): read-only here, renamed
  // via the World. The note view shows it but never lets the user edit it in place.
  it('renders the Home Entity title read-only, with a tooltip pointing to the World', () => {
    open({ ...noteDetail('Aldermoor'), isHome: true });
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    const title = fixture.nativeElement.querySelector(
      '[data-testid=title]',
    ) as HTMLElement;
    // Not editable: no contenteditable, no keyboard reach.
    expect(title.getAttribute('contenteditable')).toBeNull();
    expect(title.getAttribute('tabindex')).toBeNull();
    // Renamed via the World, not here — the hint says so.
    expect(title.getAttribute('title')).toBe('Renamed with the world');
    expect(title.textContent).toContain('Aldermoor');
  });

  it('does not rename when an unchanged title blur fires on the Home Entity', () => {
    open({ ...noteDetail('Aldermoor'), isHome: true });
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector('[data-testid=title]') as HTMLElement
    ).dispatchEvent(new Event('blur'));

    expect(entities.patch).not.toHaveBeenCalled();
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

    const title = fixture.nativeElement.querySelector(
      '[data-testid=title]',
    ) as HTMLButtonElement;
    expect(title.textContent?.trim()).toBe('Save');
  });

  // Map/Note toggle (#75): a hexmap carries both a grid and a Content body, so the
  // header switches between the two editor surfaces.
  it('offers a Map/Note view toggle for a hexmap, with Map active by default', () => {
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    const map = fixture.nativeElement.querySelector(
      '[data-testid=view-map]',
    ) as HTMLButtonElement;
    const noteBtn = fixture.nativeElement.querySelector(
      '[data-testid=view-note]',
    ) as HTMLButtonElement;
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
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
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
