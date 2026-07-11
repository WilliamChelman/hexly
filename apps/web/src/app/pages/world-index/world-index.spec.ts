import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { Subject, of, throwError } from 'rxjs';
import { ImportSummary, WorldSummary } from '@hexly/domain';
import { AuthClient, WorldsClient, ToasterService } from '@hexly/web-core';
import { MockAuthClient, MockWorldsClient, provideTranslocoTesting } from '@hexly/web-core/testing';
import { WorldIndex } from './world-index';

function world(id: string, name = id, ownerId = 'u1'): WorldSummary {
  // Rights drive the owned/member distinction now (ADR-0039): the caller (u1) owning it
  // carries `manage`; anyone else's World is reachable read-only.
  const owned = ownerId === 'u1';
  return {
    id,
    name,
    owners: [ownerId],
    rights: owned ? ['read', 'manage'] : ['read'],
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('WorldIndex', () => {
  let worldsClient: MockWorldsClient;
  let navigate: ReturnType<typeof vi.spyOn>;
  let auth: MockAuthClient;

  beforeEach(async () => {
    auth = new MockAuthClient();
    worldsClient = new MockWorldsClient();
    await TestBed.configureTestingModule({
      imports: [WorldIndex, provideTranslocoTesting()],
      providers: [
        provideRouter([]),
        { provide: AuthClient, useValue: auth },
        { provide: WorldsClient, useValue: worldsClient },
      ],
    }).compileComponents();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    // The caller (u1) — used to tell owned Worlds from member Worlds.
    auth.setUser({
      id: 'u1',
      email: 'ada@hexly.test',
      displayName: 'Ada',
      preferences: {},
      roles: ['create-worlds'],
      isSuperadmin: false,
    });
  });

  /**
   * Render the Index and resolve its world list. The list resolves via a Subject
   * (not `of`) so the emission lands AFTER the first detectChanges: WorldStore's
   * user-change effect runs for the first time on that tick and unconditionally
   * resets its state, which would otherwise wipe a synchronously-emitted load()
   * result before it's ever rendered.
   */
  function render(worlds: WorldSummary[]) {
    const list$ = new Subject<WorldSummary[]>();
    worldsClient.list.mockReturnValue(list$);
    const fixture = TestBed.createComponent(WorldIndex);
    fixture.detectChanges(); // load() -> WorldStore.load()
    list$.next(worlds);
    list$.complete();
    fixture.detectChanges();
    return fixture;
  }

  const $ = (el: HTMLElement, sel: string) => el.querySelector(sel);

  it('lists every reachable World by name', () => {
    const el = render([world('w1', 'Aldermoor'), world('w2', 'Whisperwood', 'someone-else')])
      .nativeElement as HTMLElement;

    const names = Array.from(el.querySelectorAll('[data-testid^=world-]')).map(
      (n) => (n as HTMLElement).textContent ?? '',
    );
    expect(names.join(' ')).toContain('Aldermoor');
    expect(names.join(' ')).toContain('Whisperwood');
  });

  it('distinguishes owned Worlds from member Worlds', () => {
    const el = render([
      world('w1', 'Aldermoor'), // ownerId u1 = the caller → owned
      world('w2', 'Whisperwood', 'someone-else'), // → member
    ]).nativeElement as HTMLElement;

    expect($(el, '[data-testid=owned-w1]')).not.toBeNull();
    expect($(el, '[data-testid=member-w1]')).toBeNull();
    expect($(el, '[data-testid=member-w2]')).not.toBeNull();
    expect($(el, '[data-testid=owned-w2]')).toBeNull();
  });

  it('links a World’s card to its Dashboard (ADR-0043)', () => {
    const el = render([world('w1', 'Aldermoor')]).nativeElement as HTMLElement;

    // The whole card is a routerLink anchor (stretched-link inset), so assert the
    // resolved href rather than a navigate() call. The card's front door is the
    // World Dashboard now, not the Entity Browser.
    expect(($(el, '[data-testid=world-w1]') as HTMLAnchorElement).getAttribute('href')).toBe('/w/w1');
  });

  it('shows an empty state with a create affordance when there are no Worlds', () => {
    const el = render([]).nativeElement as HTMLElement;

    expect($(el, '[data-testid=worlds-empty]')).not.toBeNull();
    expect($(el, '[data-testid=create-world]')).not.toBeNull();
  });

  it('hides the create affordance from a user without World Creation (ADR-0040)', () => {
    // A user the operator has gated from World Creation — the server would 403 a
    // create attempt, so the button is hidden to match.
    auth.setUser({
      id: 'u1',
      email: 'ada@hexly.test',
      displayName: 'Ada',
      preferences: {},
      roles: [],
      isSuperadmin: false,
    });

    // Present in a populated list…
    const populated = render([world('w1', 'Aldermoor')]).nativeElement as HTMLElement;
    expect($(populated, '[data-testid=create-world]')).toBeNull();

    // …and in the empty state.
    const empty = render([]).nativeElement as HTMLElement;
    expect($(empty, '[data-testid=worlds-empty]')).not.toBeNull();
    expect($(empty, '[data-testid=create-world]')).toBeNull();
  });

  it('creating a World lands on its Dashboard (ADR-0043)', () => {
    const el = render([]).nativeElement as HTMLElement;

    worldsClient.create.mockReturnValue(
      of({
        ...world('w9', 'Untitled world'),
        entityCount: 0,
        pinnedEntityIds: [],
        seq: 1,
      }),
    );
    ($(el, '[data-testid=create-world]') as HTMLButtonElement).click();

    expect(navigate).toHaveBeenCalledWith(['/w', 'w9']);
  });

  const importSummary = (over: Partial<ImportSummary> = {}): ImportSummary => ({
    worldId: 'w9',
    notesImported: 3,
    filesSkipped: 0,
    linksResolved: 1,
    linksDangling: 0,
    assetsStored: 0,
    constructsDegraded: {},
    ...over,
  });

  /** Pick a `.zip` on the hidden file input (jsdom can't build a real FileList). */
  function pickVault(el: HTMLElement, name = 'Aldermoor.zip') {
    const input = $(el, '[data-testid=import-vault-input]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], name, {
      type: 'application/zip',
    });
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));
    return file;
  }

  it('imports a picked vault and, from the summary, lands in the new World', () => {
    const fixture = render([]);
    const el = fixture.nativeElement as HTMLElement;

    worldsClient.importVault.mockReturnValue(of(importSummary()));
    const file = pickVault(el);
    fixture.detectChanges();

    expect(worldsClient.importVault).toHaveBeenCalledWith(file);
    // Summary modal reports what landed (ADR-0033 "what did we lose").
    const modal = $(el, '[data-testid=import-summary]');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain('3');

    ($(el, '[data-testid=open-imported]') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(['/w', 'w9', 'entities']);
  });

  it('shows a spinner on the Import affordance while the import runs', () => {
    const fixture = render([]);
    const el = fixture.nativeElement as HTMLElement;

    const pending = new Subject<ImportSummary>();
    worldsClient.importVault.mockReturnValue(pending);
    pickVault(el);
    fixture.detectChanges();

    const trigger = $(el, '[data-testid=import-vault]') as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);

    pending.next(importSummary());
    pending.complete();
    fixture.detectChanges();
    expect(trigger.disabled).toBe(false);
  });

  it('surfaces an error toast when importing a vault fails', () => {
    const fixture = render([]);
    const el = fixture.nativeElement as HTMLElement;

    worldsClient.importVault.mockReturnValue(throwError(() => new Error('bad zip')));
    pickVault(el);
    fixture.detectChanges();

    expect(
      TestBed.inject(ToasterService)
        .toasts()
        .map((t) => t.tone),
    ).toEqual(['error']);
    expect($(el, '[data-testid=import-summary]')).toBeNull();
    expect(($(el, '[data-testid=import-vault]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('offers rename + delete on owned Worlds only, not on member Worlds', () => {
    const el = render([
      world('w1', 'Aldermoor'), // owned by the caller (u1)
      world('w2', 'Whisperwood', 'someone-else'), // member
    ]).nativeElement as HTMLElement;

    expect($(el, '[data-testid=rename-world-w1]')).not.toBeNull();
    expect($(el, '[data-testid=delete-world-w1]')).not.toBeNull();
    expect($(el, '[data-testid=export-world-w1]')).not.toBeNull();
    expect($(el, '[data-testid=rename-world-w2]')).toBeNull();
    expect($(el, '[data-testid=delete-world-w2]')).toBeNull();
    expect($(el, '[data-testid=export-world-w2]')).toBeNull();
  });

  it('links an owned World to its settings page, but not a member World', () => {
    const el = render([
      world('w1', 'Aldermoor'), // owned by the caller (u1)
      world('w2', 'Whisperwood', 'someone-else'), // member
    ]).nativeElement as HTMLElement;

    // World Settings moved to /settings when the World root became the Dashboard (ADR-0043).
    expect(($(el, '[data-testid=owners-world-w1]') as HTMLAnchorElement).getAttribute('href')).toBe('/w/w1/settings');
    expect($(el, '[data-testid=owners-world-w2]')).toBeNull();
  });

  it('exports an owned World as a named .zip download', () => {
    const el = render([world('w1', 'Aldermoor')]).nativeElement as HTMLElement;
    const zip = new Blob([new Uint8Array([1, 2, 3])], {
      type: 'application/zip',
    });
    worldsClient.exportVault.mockReturnValue(of(zip));

    // happy-dom doesn't implement object URLs or a real anchor click — stub them.
    URL.createObjectURL = vi.fn(() => 'blob:zip');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    ($(el, '[data-testid=export-world-w1]') as HTMLButtonElement).click();

    expect(worldsClient.exportVault).toHaveBeenCalledWith('w1');
    expect(URL.createObjectURL).toHaveBeenCalledWith(zip);
    // The download anchor fires with the World's name as the filename.
    expect(click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:zip');
  });

  it('surfaces an error toast when exporting a World fails', () => {
    const el = render([world('w1', 'Aldermoor')]).nativeElement as HTMLElement;
    worldsClient.exportVault.mockReturnValue(throwError(() => new Error('boom')));

    ($(el, '[data-testid=export-world-w1]') as HTMLButtonElement).click();

    expect(
      TestBed.inject(ToasterService)
        .toasts()
        .map((t) => t.tone),
    ).toEqual(['error']);
  });

  it('renames an owned World from the Index, updating the list', () => {
    const fixture = render([world('w1', 'Aldermoor')]);
    const el = fixture.nativeElement as HTMLElement;

    ($(el, '[data-testid=rename-world-w1]') as HTMLButtonElement).click();
    fixture.detectChanges();

    worldsClient.rename.mockReturnValue(
      of({
        ...world('w1', 'The Reach of Aldermoor'),
        entityCount: 1,
        pinnedEntityIds: [],
        seq: 1,
      }),
    );
    const input = $(el, '[data-testid=rename-world-input-w1]') as HTMLInputElement;
    input.value = 'The Reach of Aldermoor';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();

    expect(worldsClient.rename).toHaveBeenCalledWith('w1', 'The Reach of Aldermoor');
    expect($(el, '[data-testid=world-w1]')?.textContent).toContain('The Reach of Aldermoor');
  });

  it('opens a delete modal that shows the count of Entities to be destroyed', () => {
    const fixture = render([world('w1', 'Aldermoor')]);
    const el = fixture.nativeElement as HTMLElement;

    // The modal fetches the World's Detail for its entity count (#120).
    worldsClient.get.mockReturnValue(
      of({
        ...world('w1', 'Aldermoor'),
        entityCount: 3,
        pinnedEntityIds: [],
        seq: 1,
      }),
    );
    ($(el, '[data-testid=delete-world-w1]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(worldsClient.get).toHaveBeenCalledWith('w1');
    expect($(el, '[data-testid=delete-modal]')).not.toBeNull();
    expect($(el, '[data-testid=delete-count]')?.textContent).toContain('3');
  });

  /** Open the delete modal for w1 and resolve its entity count. */
  function openDeleteModal(name: string, count = 2) {
    const fixture = render([world('w1', name)]);
    const el = fixture.nativeElement as HTMLElement;
    worldsClient.get.mockReturnValue(
      of({
        ...world('w1', name),
        entityCount: count,
        pinnedEntityIds: [],
        seq: 1,
      }),
    );
    ($(el, '[data-testid=delete-world-w1]') as HTMLButtonElement).click();
    fixture.detectChanges();
    return fixture;
  }

  it('enables Delete only once the typed name matches the World exactly', () => {
    const fixture = openDeleteModal('Aldermoor');
    const el = fixture.nativeElement as HTMLElement;
    // aria-disabled, not the native attribute, so the gated button stays focusable.
    const armed = () =>
      ($(el, '[data-testid=confirm-delete]') as HTMLButtonElement).getAttribute('aria-disabled') === null;
    const input = $(el, '[data-testid=delete-confirm-input]') as HTMLInputElement;

    expect(armed()).toBe(false);

    input.value = 'Aldermor'; // typo → still locked
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(armed()).toBe(false);

    input.value = 'Aldermoor'; // exact match → armed
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(armed()).toBe(true);
  });

  it('deletes the World on confirm, removing it from the Index', () => {
    const fixture = openDeleteModal('Aldermoor');
    const el = fixture.nativeElement as HTMLElement;

    const input = $(el, '[data-testid=delete-confirm-input]') as HTMLInputElement;
    input.value = 'Aldermoor';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    worldsClient.delete.mockReturnValue(of(undefined));
    ($(el, '[data-testid=confirm-delete]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(worldsClient.delete).toHaveBeenCalledWith('w1');
    expect($(el, '[data-testid=world-w1]')).toBeNull();
    expect($(el, '[data-testid=delete-modal]')).toBeNull();
  });

  it('renders its empty state in French when French is the active language', () => {
    const fixture = render([]);
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain("Aucun monde pour l'instant.");
  });

  it('shows an error state (not the empty state) when the World list fails to load', () => {
    const list$ = new Subject<WorldSummary[]>();
    worldsClient.list.mockReturnValue(list$);
    const fixture = TestBed.createComponent(WorldIndex);
    fixture.detectChanges(); // load() → WorldStore.load()
    list$.error(new Error('server error'));
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect($(el, '[data-testid=load-error]')).not.toBeNull();
    expect($(el, '[data-testid=worlds-empty]')).toBeNull();
  });

  it('surfaces an error toast when creating a World fails', () => {
    const el = render([]).nativeElement as HTMLElement;

    worldsClient.create.mockReturnValue(throwError(() => new Error('server error')));
    ($(el, '[data-testid=create-world]') as HTMLButtonElement).click();

    expect(
      TestBed.inject(ToasterService)
        .toasts()
        .map((t) => t.tone),
    ).toEqual(['error']);
  });

  /**
   * Simulate a tab visibility transition: jsdom's `visibilityState` is a getter, so
   * override it, then fire the event the Index listens on (ADR-0044: the Index refetches
   * on focus, off the nudge bus).
   */
  function fireVisibility(state: DocumentVisibilityState) {
    Object.defineProperty(document, 'visibilityState', {
      value: state,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }

  it('refetches the worlds directory when the tab is re-focused, reflecting changes made elsewhere (#172)', () => {
    const fixture = render([world('w1', 'Aldermoor')]);
    const el = fixture.nativeElement as HTMLElement;
    expect($(el, '[data-testid=world-w1]')).not.toBeNull();

    // While the tab was away, a World was renamed and another created elsewhere.
    worldsClient.list.mockReturnValue(of([world('w1', 'The Reach of Aldermoor'), world('w2', 'Whisperwood')]));
    fireVisibility('visible');
    fixture.detectChanges();

    expect($(el, '[data-testid=world-w1]')?.textContent).toContain('The Reach of Aldermoor');
    expect($(el, '[data-testid=world-w2]')).not.toBeNull();
  });

  it('does not refetch when the tab merely goes hidden (no redundant fire, #172)', () => {
    render([world('w1', 'Aldermoor')]);
    worldsClient.list.mockClear();

    fireVisibility('hidden');

    expect(worldsClient.list).not.toHaveBeenCalled();
  });

  it('keeps the last-good list when a re-focus refetch fails (#172)', () => {
    const fixture = render([world('w1', 'Aldermoor')]);
    const el = fixture.nativeElement as HTMLElement;

    // Session expired / network blipped while the tab was hidden.
    worldsClient.list.mockReturnValue(throwError(() => new Error('offline')));
    fireVisibility('visible');
    fixture.detectChanges();

    // Stale-but-present beats a blank Index; no error toast either.
    expect($(el, '[data-testid=world-w1]')?.textContent).toContain('Aldermoor');
    expect(TestBed.inject(ToasterService).toasts()).toEqual([]);
  });

  it('stops refetching once the user has navigated away from the Index (#172)', () => {
    const fixture = render([world('w1', 'Aldermoor')]);
    worldsClient.list.mockClear();

    fixture.destroy(); // navigate away → component (and its listener) torn down
    fireVisibility('visible');

    expect(worldsClient.list).not.toHaveBeenCalled();
  });
});
