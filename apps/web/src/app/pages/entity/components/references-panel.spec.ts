import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CORE_HEXMAP, CORE_NOTE, EntityReferences } from '@hexly/domain';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { EntitySession } from '../services/entity-session';
import { ENTITY_SESSION } from '@hexly/web-entity';
import { ReferencesStore } from '../services/references-store';
import { RightDock } from '../services/right-dock';
import { noteDetail } from './entity-detail.fixtures';
import { ReferencesPanel } from './references-panel';

/**
 * The References panel (ADR-0046, #179): an Entity's own links (*References*) and the Entities
 * that link to it (*Referenced by*), read from the derived edge index. The server has already
 * dropped every inbound edge whose source this viewer may not read, so the panel renders what it
 * is given — the only judgement it makes is navigable vs dangling.
 */
describe('ReferencesPanel', () => {
  const NONE: EntityReferences = { references: [], referencedBy: [] };

  let store: ReferencesStore;
  let session: EntitySession;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReferencesPanel, provideTranslocoTesting()],
      providers: [
        // The store is route-scoped and reads the open Entity off the session; no Entity is
        // adopted here, so its fetch effect never fires and `adopt` is the only source.
        EntitySession,
        { provide: ENTITY_SESSION, useExisting: EntitySession },
        RightDock,
        ReferencesStore,
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
    session = TestBed.inject(EntitySession);
    store = TestBed.inject(ReferencesStore);
  });

  function render(references: Partial<EntityReferences>): HTMLElement {
    // The panel is closed by default, so the store's fetch never fires; `adopt` is the only source.
    session.adopt(noteDetail('Ealdred'));
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
        { descriptor: 'capital of', source: { id: 'avalon', name: 'Avalon', types: [CORE_HEXMAP] } },
      ],
    });

    const item = el.querySelector('[data-testid=reference-in]');
    expect(item?.textContent).toContain('Avalon');
    expect(item?.querySelector('a')?.getAttribute('href')).toBe('/entities/avalon');
  });

  /**
   * "Nothing links here" is a claim about the edge index, not about the fetch. Asserting it before
   * the response lands tells the reader something false, and they cannot tell it from the truth.
   */
  it('claims nothing until the list has landed', () => {
    session.adopt(noteDetail('Ealdred'));
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
   * closed must never be shown against the one just opened — a reader would attribute Ealdred's
   * links to Mira for as long as the next fetch takes.
   */
  it('drops a held list when a different Entity is opened', () => {
    const el = render({
      references: [
        { targetId: 'mira', descriptor: null, target: { id: 'mira', name: 'Mira', types: [CORE_NOTE] } },
      ],
    });
    expect(el.querySelector('[data-testid=reference-out]')).not.toBeNull();

    session.adopt({ ...noteDetail('Mira'), id: 'n2' });
    TestBed.tick();

    // Blanks to *nothing* — not to "this entity links to nothing", which would be a claim about
    // an Entity whose list has not been fetched.
    expect(el.querySelector('[data-testid=reference-out]')).toBeNull();
    expect(el.querySelector('[data-testid=references-out-empty]')).toBeNull();
  });
});
