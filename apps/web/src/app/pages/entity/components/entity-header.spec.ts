import { provideTranslocoTesting } from '../../../../testing/transloco-testing';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { EntityDetail, WorldDetail, WorldVerb } from '@hexly/domain';
import { emptyContent } from '@hexly/plugin-content';
import { CORE_HEXMAP, HEX_GRID_FIELD } from '@hexly/plugin-hexmap';
import { MockEntitiesClient, MockWorldsClient, MockUserDirectoryClient, MockAuthClient } from '@hexly/web-core/testing';
import { EntitiesClient, WorldsClient, ActiveWorld, UserDirectoryClient, AuthClient } from '@hexly/web-core';
import { EntitySession } from '../services/entity-session';
import { CORE_VIEW_CONTENT, CORE_VIEW_MAP, ENTITY_SESSION, viewInstanceKey } from '@hexly/web-entity';
import { EntityViewStore } from '../services/entity-view-store';
import { ViewRegistry } from '../../../entity-types/view-registry';
import { CORE_VIEW_DEFINITIONS } from '../views/core-views';
import { OwnerSet } from '@hexly/web-ui';
import { providePluginHexmap } from '@hexly/plugin-hexmap/web';
import { EntityHeader } from './entity-header';
import { noteDetail } from './note-detail.fixtures';

/** The Hex Map's map View, as the toggle keys it: the View id plus the Field it renders. */
const MAP_VIEW_KEY = viewInstanceKey({ viewId: CORE_VIEW_MAP, fieldKey: HEX_GRID_FIELD.key });

/** The active World the header reads for pin state — 'm1' is the opened entity's id. */
function worldDetail(pinnedEntityIds: string[] = [], rights: WorldVerb[] = ['read', 'manage']): WorldDetail {
  return {
    id: 'w1',
    name: 'Aldermoor',
    owners: ['ada'],
    rights,
    entityCount: 1,
    pinnedEntityIds,
    seq: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('EntityHeader', () => {
  let entities: MockEntitiesClient;
  let worlds: MockWorldsClient;
  let world: WritableSignal<WorldDetail | null>;
  let activeWorldSet: ReturnType<typeof vi.fn>;

  const aldermoor: EntityDetail = {
    id: 'm1',
    worldId: 'w1',
    name: 'The Reach of Aldermoor',
    types: [CORE_HEXMAP],
    tags: [],
    visibility: 'private',
    version: 3,
    seq: 1,
    createdAt: 1,
    updatedAt: 1,
    // The default opener is an Owner — full Rights (ADR-0039): writable and can manage sharing.
    rights: ['read', 'edit', 'delete', 'set-visibility', 'manage'],
    document: { content: emptyContent(), grid: { hexes: {}, regions: [], labels: [] } },
  };

  /** Open an entity through the real session so the header has one to show/save. */
  function open(detail: EntityDetail): void {
    entities.load.mockReturnValue(of(detail));
    TestBed.inject(EntitySession).open(detail.id).subscribe();
  }

  beforeEach(async () => {
    entities = new MockEntitiesClient();
    worlds = new MockWorldsClient();
    world = signal<WorldDetail | null>(worldDetail());
    activeWorldSet = vi.fn((w: WorldDetail | null) => world.set(w));
    await TestBed.configureTestingModule({
      imports: [EntityHeader, provideTranslocoTesting()],
      providers: [
        providePluginHexmap(),
        EntitySession,
        { provide: ENTITY_SESSION, useExisting: EntitySession },
        // Page-scoped in the app (provided on EntityPage); provided here since this spec
        // mounts the header alone, and it reads the active View off this store.
        EntityViewStore,
        { provide: EntitiesClient, useValue: entities },
        { provide: WorldsClient, useValue: worlds },
        {
          provide: ActiveWorld,
          useValue: {
            worldId: signal('w1'),
            name: signal('Aldermoor'),
            world,
            set: activeWorldSet,
            // Delegates to the client like the real service, so the pin-toggle tests still
            // assert the ids reaching setPins; the toast-on-error path is covered in active-world.spec.
            commitPins: vi.fn((ids: string[]) =>
              worlds.setPins('w1', ids).subscribe({
                next: (d) => (activeWorldSet as (w: WorldDetail) => void)(d),
              }),
            ),
          },
        },
        {
          provide: UserDirectoryClient,
          useValue: new MockUserDirectoryClient(),
        },
        { provide: AuthClient, useValue: new MockAuthClient() },
        provideRouter([]),
      ],
    }).compileComponents();
    // EntityPage registers the core Views in the running app; the header spec mounts the
    // header alone, so seed the registry here for the toggle to resolve labels + testids.
    const views = TestBed.inject(ViewRegistry);
    for (const def of CORE_VIEW_DEFINITIONS) views.register(def);
  });

  // The actions live in a CDK menu overlay (attached to the document body); tear it
  // down between specs so a lingering menu never leaks into the next.
  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  /** Open the entity actions overflow menu; its items render into the overlay. */
  function openActions(fixture: ComponentFixture<EntityHeader>): void {
    (fixture.nativeElement.querySelector('[data-testid=entity-actions]') as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  /** A menu item by its test id — the menu renders into the document, not the fixture. */
  function menuItem(testid: string): HTMLButtonElement | null {
    return document.querySelector(`[data-testid=${testid}]`);
  }

  it('opens the entity owner set from the Share action', () => {
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.directive(OwnerSet))).toBeNull();

    openActions(fixture);
    menuItem('manage-owners')!.click();
    fixture.detectChanges();

    const set = fixture.debugElement.query(By.directive(OwnerSet))?.componentInstance as OwnerSet;
    expect(set.kind()).toBe('entity');
    expect(set.id()).toBe('m1');
  });

  it('closes the owner set from its Close action', () => {
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();
    openActions(fixture);
    menuItem('manage-owners')!.click();
    fixture.detectChanges();

    fixture.nativeElement.querySelector('[data-testid=owners-close]').click();
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.directive(OwnerSet))).toBeNull();
  });

  it('hides the Share action for a read-only opener (no manage Right)', () => {
    // A Viewer grant / read-only member / Public Link reader (ADR-0039): content shows,
    // but Share (owner/grant/link management) is owner-only and must be withheld.
    open({ ...aldermoor, rights: ['read'] });
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    openActions(fixture);
    expect(menuItem('manage-owners')).toBeNull();
  });

  it('hides the Share action for a writer who is not an Owner (no manage Right)', () => {
    // An entity-level Editor or a World Owner opens writable (has `edit`) but can't manage
    // sharing — the dialog is owner-only, so the item must stay hidden or it opens onto 403s.
    open({ ...aldermoor, rights: ['read', 'edit'] });
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    openActions(fixture);
    expect(menuItem('manage-owners')).toBeNull();
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

    expect(fixture.nativeElement.querySelector('[data-testid=entity-tags]')).not.toBeNull();
  });

  it('renames the open entity when the title is edited', () => {
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    // Edit in place (contenteditable), commit on blur.
    entities.patch.mockReturnValue(of({ ...aldermoor, name: 'The Whisperwood' }));
    const title = fixture.nativeElement.querySelector('[data-testid=title]') as HTMLElement;
    title.textContent = 'The Whisperwood';
    title.dispatchEvent(new Event('blur'));

    expect(entities.patch).toHaveBeenCalledWith('m1', {
      name: 'The Whisperwood',
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('The Whisperwood');
  });

  it('does not call the API when the title is left unchanged', () => {
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('[data-testid=title]') as HTMLElement).dispatchEvent(new Event('blur'));

    expect(entities.patch).not.toHaveBeenCalled();
  });

  it('toggles the open entity’s visibility from the actions menu', () => {
    open(aldermoor); // private
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    openActions(fixture);
    const toggle = menuItem('visibility-toggle')!;
    expect(toggle).not.toBeNull();
    // Reflects current visibility: private → unchecked.
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    entities.patch.mockReturnValue(of({ ...aldermoor, visibility: 'shared' }));
    toggle.click();
    fixture.detectChanges();

    expect(entities.patch).toHaveBeenCalledWith('m1', { visibility: 'shared' });
    // Re-open the menu: the item now reads as shared (checked).
    openActions(fixture);
    expect(menuItem('visibility-toggle')!.getAttribute('aria-checked')).toBe('true');
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
      openActions(fixture);
      menuItem('visibility-toggle')!.click();
      fixture.detectChanges();

      // A bare subscribe would report the rejection as an unhandled error on a timer;
      // the error handler makes it a no-op, so draining timers throws nothing.
      expect(() => vi.runOnlyPendingTimers()).not.toThrow();
      // State stays as the server has it: still private (re-open to read the item).
      openActions(fixture);
      expect(menuItem('visibility-toggle')!.getAttribute('aria-checked')).toBe('false');
    } finally {
      vi.useRealTimers();
    }
  });

  // A read-only World member (no edit Right, ADR-0039) sees the entity but can't edit it:
  // the title is read-only and the owner-only visibility toggle is absent from the menu.
  it('renders a read-only entity’s title non-editable, with no visibility toggle', () => {
    open({ ...aldermoor, rights: ['read'] });
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    const title = fixture.nativeElement.querySelector('[data-testid=title]') as HTMLElement;
    expect(title.getAttribute('contenteditable')).toBeNull();
    expect(title.getAttribute('tabindex')).toBeNull();
    openActions(fixture);
    expect(menuItem('visibility-toggle')).toBeNull();
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

  it('renders its chrome and actions in French when French is the active language', () => {
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    // No reload: flipping the active language re-renders the live component.
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    // The Share action now lives in the overflow menu; open it to see its label.
    openActions(fixture);
    expect((document.querySelector('[role=menu]') as HTMLElement).textContent).toContain('Partager');
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

  // Map/Note toggle (#75): a hexmap carries both a grid and a Content body, so the header switches
  // between the two editor surfaces. The map View is the grid *Field*'s, so its button is keyed and
  // labelled by that Field (ADR-0050).
  it('offers a Map/Note view toggle for a hexmap, with the Map active by default', () => {
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    const map = fixture.nativeElement.querySelector(`[data-testid="${MAP_VIEW_KEY}"]`) as HTMLButtonElement;
    const noteBtn = fixture.nativeElement.querySelector('[data-testid="core.view.content"]') as HTMLButtonElement;
    expect(map).not.toBeNull();
    expect(noteBtn).not.toBeNull();
    // Labelled from the Field it renders, and still translated: the grid Field ships copy, so its
    // `labelKey` resolves, where a World Owner's Field would show its authored name verbatim.
    expect(map.textContent?.trim()).toBe('Map');
    // Default is the grid: Map pressed, Note not.
    expect(map.getAttribute('aria-pressed')).toBe('true');
    expect(noteBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('omits the view toggle for a note — it has no grid surface to switch to', () => {
    open(noteDetail('Lady Mara'));
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector(`[data-testid="${MAP_VIEW_KEY}"]`)).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="core.view.content"]')).toBeNull();
    // The title is still editable — a note can be renamed too.
    expect(fixture.nativeElement.textContent).toContain('Lady Mara');
  });

  it('switches to the Content view when Note is clicked', () => {
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('[data-testid="core.view.content"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    // The store is the single owner of the active-View choice (shared with the page body).
    expect(TestBed.inject(EntityViewStore).activeView()).toEqual({ viewId: CORE_VIEW_CONTENT });
    expect(
      (fixture.nativeElement.querySelector('[data-testid="core.view.content"]') as HTMLButtonElement).getAttribute(
        'aria-pressed',
      ),
    ).toBe('true');
  });

  // Pin to Dashboard (ADR-0043, #169): a World Owner features the open Entity on the
  // World Dashboard straight from its header, without a trip to the Dashboard picker.
  it('shows the Pin toggle to a World Owner, reflecting the not-yet-pinned state', () => {
    world.set(worldDetail([])); // Owner (manage), 'm1' not pinned
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    openActions(fixture);
    const toggle = menuItem('pin-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute('aria-checked')).toBe('false');
  });

  it('hides the Pin toggle for a non-Owner of the World (no manage Right)', () => {
    world.set(worldDetail([], ['read'])); // a Contributor/Viewer of the World
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    openActions(fixture);
    expect(menuItem('pin-toggle')).toBeNull();
  });

  it('reflects that the open Entity is already pinned', () => {
    world.set(worldDetail(['m1'])); // 'm1' is in the shared pin set
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    openActions(fixture);
    expect(menuItem('pin-toggle')!.getAttribute('aria-checked')).toBe('true');
  });

  it('pins the open Entity, PATCHing the id onto the set and re-pinning the World', () => {
    world.set(worldDetail(['p1']));
    worlds.setPins.mockReturnValue(of(worldDetail(['p1', 'm1'])));
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    openActions(fixture);
    menuItem('pin-toggle')!.click();
    fixture.detectChanges();

    // The current Entity's id is appended and the set sent wholesale (ADR-0043).
    expect(worlds.setPins).toHaveBeenCalledWith('w1', ['p1', 'm1']);
    // The returned Detail re-pins the active World so the toggle reflects the new state.
    expect(activeWorldSet).toHaveBeenCalledWith(worldDetail(['p1', 'm1']));
    // Re-open the menu: the item now reads as pinned (checked).
    openActions(fixture);
    expect(menuItem('pin-toggle')!.getAttribute('aria-checked')).toBe('true');
  });

  it('unpins the open Entity by omitting its id from the set', () => {
    world.set(worldDetail(['p1', 'm1']));
    worlds.setPins.mockReturnValue(of(worldDetail(['p1'])));
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    openActions(fixture);
    menuItem('pin-toggle')!.click();

    expect(worlds.setPins).toHaveBeenCalledWith('w1', ['p1']);
  });

  it('mirrors the chosen view to the URL so a refresh keeps it (#75)', () => {
    open(aldermoor);
    const fixture = TestBed.createComponent(EntityHeader);
    fixture.detectChanges();

    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    (fixture.nativeElement.querySelector('[data-testid="core.view.content"]') as HTMLButtonElement).click();
    // Persisted as the View's key (replaceUrl — a view flip is not a navigation).
    expect(nav).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { view: CORE_VIEW_CONTENT },
        replaceUrl: true,
      }),
    );

    (fixture.nativeElement.querySelector(`[data-testid="${MAP_VIEW_KEY}"]`) as HTMLButtonElement).click();
    // The default Map view drops the param to keep the URL clean.
    expect(nav).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { view: null },
        replaceUrl: true,
      }),
    );
  });
});
