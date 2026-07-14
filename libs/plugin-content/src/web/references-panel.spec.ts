import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EntityDetail, EntityReferences } from '@hexly/domain';
import { FakeEntitySession, provideFakeEntitySession } from '@hexly/web-entity/testing';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { CONTENT_EDITOR_TEST_CATALOGS } from '../i18n/test-catalogs';
import { CORE_NOTE } from '../lib';
import { ReferencesStore } from './references-store';
import { RightDock } from './right-dock';
import { ReferencesPanel } from './references-panel';

/**
 * The References panel (ADR-0046, #179): an Entity's own links (*References*) and the Entities
 * that link to it (*Referenced by*), read from the derived edge index. The server has already
 * dropped every inbound edge whose source this viewer may not read, so the panel renders what it
 * is given.
 *
 * Driven through `ENTITY_SESSION` + `RightDock` — the same seam the app binds (ADR-0051) — so the
 * panel's specs never reach for `apps/web`'s concrete session or the map plugin's testing barrel.
 */
describe('ReferencesPanel', () => {
  const NONE: EntityReferences = { references: [], referencedBy: [] };

  /** A minimal note detail — the panel reads only the Entity's id/seq off `current` (ADR-0045). */
  const noteDetail = (name: string, id = 'n1'): EntityDetail => ({
    id,
    worldId: 'w1',
    name,
    types: [CORE_NOTE],
    tags: [],
    visibility: 'private',
    version: 1,
    seq: 1,
    createdAt: 1,
    updatedAt: 1,
    document: {},
  });

  let store: ReferencesStore;
  let session: FakeEntitySession;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReferencesPanel, provideTranslocoTesting(CONTENT_EDITOR_TEST_CATALOGS)],
      providers: [
        // The store is route-scoped and reads the open Entity off the session; no Entity is
        // adopted here, so its fetch effect never fires and `adopt` is the only source.
        provideFakeEntitySession(),
        RightDock,
        ReferencesStore,
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
    session = TestBed.inject(FakeEntitySession);
    store = TestBed.inject(ReferencesStore);
  });

  function render(references: Partial<EntityReferences>): HTMLElement {
    // The panel is closed by default, so the store's fetch never fires; `adopt` is the only source.
    session.loadDetail(noteDetail('Ealdred'));
    store.adopt('n1', { ...NONE, ...references });
    const fixture = TestBed.createComponent(ReferencesPanel);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('lists a resolved outbound target as a link to it, with its Link Descriptor', () => {
    const el = render({
      references: [
        {
          targetId: 'mira',
          descriptor: 'spouse',
          target: { id: 'mira', name: 'Mira', types: [CORE_NOTE] },
        },
      ],
    });

    const item = el.querySelector('[data-testid=reference-out]');
    expect(item?.textContent).toContain('Mira');
    expect(item?.textContent).toContain('spouse');
    expect(item?.querySelector('a')?.getAttribute('href')).toBe('/entities/mira');
  });

  /** A deleted or unreadable target is indistinguishable, and neither is navigable (#78). */
  it('renders an unresolved outbound target as a non-navigable dangling label', () => {
    const el = render({
      references: [{ targetId: 'gone', descriptor: null, target: null }],
    });

    const item = el.querySelector('[data-testid=reference-out]');
    expect(item?.querySelector('a')).toBeNull();
    expect(item?.querySelector('[data-dangling]')).not.toBeNull();
  });

  it('lists each inbound source as a link back to it', () => {
    const el = render({
      referencedBy: [
        {
          descriptor: 'capital of',
          source: { id: 'avalon', name: 'Avalon', types: [CORE_NOTE] },
        },
      ],
    });

    const item = el.querySelector('[data-testid=reference-in]');
    expect(item?.textContent).toContain('Avalon');
    expect(item?.querySelector('a')?.getAttribute('href')).toBe('/entities/avalon');
  });

  /** "Nothing links here" is a claim about the edge index, not about the fetch: it must not appear before the list lands. */
  it('claims nothing until the list has landed', () => {
    session.loadDetail(noteDetail('Ealdred'));
    const fixture = TestBed.createComponent(ReferencesPanel);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    // Nothing adopted yet: the fetch is still in flight.
    expect(el.querySelector('[data-testid=references-out-empty]')).toBeNull();
    expect(el.querySelector('[data-testid=references-in-empty]')).toBeNull();

    store.adopt('n1', NONE);
    fixture.detectChanges();

    expect(el.querySelector('[data-testid=references-out-empty]')).not.toBeNull();
    expect(el.querySelector('[data-testid=references-in-empty]')).not.toBeNull();
  });

  it('shows an empty state per section when nothing links either way', () => {
    const el = render({});

    expect(el.querySelector('[data-testid=references-out-empty]')).not.toBeNull();
    expect(el.querySelector('[data-testid=references-in-empty]')).not.toBeNull();
  });

  /**
   * The page keeps this store alive across `:id` changes, so a list held for the Entity just
   * closed must never be shown against the one just opened.
   */
  it('drops a held list when a different Entity is opened', () => {
    const el = render({
      references: [
        {
          targetId: 'mira',
          descriptor: null,
          target: { id: 'mira', name: 'Mira', types: [CORE_NOTE] },
        },
      ],
    });
    expect(el.querySelector('[data-testid=reference-out]')).not.toBeNull();

    session.loadDetail(noteDetail('Mira', 'n2'));
    TestBed.tick();

    // Blanks to *nothing* — not to "this entity links to nothing", which would be a claim about
    // an Entity whose list has not been fetched.
    expect(el.querySelector('[data-testid=reference-out]')).toBeNull();
    expect(el.querySelector('[data-testid=references-out-empty]')).toBeNull();
  });
});
