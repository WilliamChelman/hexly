import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EntityDetail, EntityReferences, EntityType } from '@hexly/domain';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { FakeEntitySession, provideFakeEntitySession } from '../testing';
import { WEB_ENTITY_TEST_CATALOGS } from '../i18n/test-catalogs';
import { ReferencesStore } from '../services/references-store';
import { ReferencesPanelComponent } from './references-panel.component';

/**
 * The References Panel (ADR-0046) — now a universal Dock Panel in the core web-entity layer (ADR-0067):
 * an Entity's own links (*References*) and the Entities that link to it (*Referenced by*), read from
 * the derived edge index. The server has already dropped every inbound edge whose source this viewer
 * may not read, so the panel renders what it is given.
 *
 * Driven through `ENTITY_SESSION` — the same seam the app binds — so the panel's specs never reach for
 * `apps/web`'s concrete session. The store is Panel-scoped, so a fixture takes it from the component's
 * own injector.
 */
describe('ReferencesPanel', () => {
  const NOTE = 'core.type.note' as EntityType;
  const NONE: EntityReferences = { references: [], referencedBy: [] };

  /** A minimal note detail — the panel reads only the Entity's id/seq off `current` (ADR-0045). */
  const noteDetail = (name: string, id = 'n1'): EntityDetail => ({
    id,
    worldId: 'w1',
    name,
    types: [NOTE],
    tags: [],
    visibility: 'private',
    version: 1,
    seq: 1,
    createdAt: 1,
    updatedAt: 1,
    document: {},
  });

  let session: FakeEntitySession;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReferencesPanelComponent, provideTranslocoTesting(WEB_ENTITY_TEST_CATALOGS)],
      providers: [provideFakeEntitySession(), provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    session = TestBed.inject(FakeEntitySession);
  });

  /**
   * The store is Panel-scoped, so it fetches for the open Entity the moment the Panel mounts; the
   * unflushed request stays pending (no `verify`), and `adopt` is the seam that seeds the rendered
   * list without racing that fetch — mirroring the closed-panel path the old dock provided.
   */
  function mount(references: Partial<EntityReferences>): {
    fixture: ComponentFixture<ReferencesPanelComponent>;
    el: HTMLElement;
    store: ReferencesStore;
  } {
    session.loadDetail(noteDetail('Ealdred'));
    const fixture = TestBed.createComponent(ReferencesPanelComponent);
    const store = fixture.debugElement.injector.get(ReferencesStore);
    store.adopt('n1', { ...NONE, ...references });
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, store };
  }

  it('lists a resolved outbound target as a link to it, with its Link Descriptor', () => {
    const { el } = mount({
      references: [
        { targetId: 'mira', descriptor: 'spouse', decor: false, target: { id: 'mira', name: 'Mira', types: [NOTE] } },
      ],
    });

    const item = el.querySelector('[data-testid=reference-out]');
    expect(item?.textContent).toContain('Mira');
    expect(item?.textContent).toContain('spouse');
    expect(item?.querySelector('a')?.getAttribute('href')).toBe('/entities/mira');
  });

  /** A resolved Thumbnail (ADR-0066, #290) renders before the name; a target without one shows no image. */
  it('renders a linked target’s thumbnail when present, and none when absent', () => {
    const { el } = mount({
      references: [
        {
          targetId: 'mira',
          descriptor: null,
          decor: false,
          target: { id: 'mira', name: 'Mira', types: [NOTE], thumbnailUrl: '/assets/w1/abc.thumb.webp' },
        },
        { targetId: 'gwen', descriptor: null, decor: false, target: { id: 'gwen', name: 'Gwen', types: [NOTE] } },
      ],
    });

    expect(el.querySelector<HTMLImageElement>('[data-testid=reference-thumbnail-mira]')?.src).toContain(
      '/assets/w1/abc.thumb.webp',
    );
    expect(el.querySelector('[data-testid=reference-thumbnail-gwen]')).toBeNull();
  });

  /** A deleted or unreadable target is indistinguishable, and neither is navigable (#78). */
  it('renders an unresolved outbound target as a non-navigable dangling label', () => {
    const { el } = mount({ references: [{ targetId: 'gone', descriptor: null, decor: false, target: null }] });

    const item = el.querySelector('[data-testid=reference-out]');
    expect(item?.querySelector('a')).toBeNull();
    expect(item?.querySelector('[data-dangling]')).not.toBeNull();
  });

  it('lists each inbound source as a link back to it', () => {
    const { el } = mount({
      referencedBy: [
        { descriptor: 'capital of', decor: false, source: { id: 'avalon', name: 'Avalon', types: [NOTE] } },
      ],
    });

    const item = el.querySelector('[data-testid=reference-in]');
    expect(item?.textContent).toContain('Avalon');
    expect(item?.querySelector('a')?.getAttribute('href')).toBe('/entities/avalon');
  });

  /**
   * The outbound section is a *relation* surface (ADR-0069): a Decor Link — a Thumbnail designation, a
   * prose image — is hidden by default, and the ephemeral reveal shows it on demand. A semantic row is
   * never hidden.
   */
  it('hides an outbound Decor Link until the reveal is toggled', () => {
    const { el, fixture } = mount({
      references: [
        { targetId: 'mira', descriptor: null, decor: false, target: { id: 'mira', name: 'Mira', types: [NOTE] } },
        { targetId: 'crest', descriptor: null, decor: true, target: { id: 'crest', name: 'Crest', types: [NOTE] } },
      ],
    });

    // Default: the semantic row shows, the decor row is hidden, and the reveal control is offered.
    expect(el.querySelectorAll('[data-testid=reference-out]')).toHaveLength(1);
    expect(el.textContent).toContain('Mira');
    expect(el.textContent).not.toContain('Crest');
    const toggle = el.querySelector<HTMLButtonElement>('[data-testid=references-decor-toggle]');
    expect(toggle).not.toBeNull();

    // Reveal: the decor row joins, marked as decor to set it apart from a semantic relation.
    toggle?.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-testid=reference-out]')).toHaveLength(2);
    expect(el.textContent).toContain('Crest');
    expect(el.querySelector('[data-testid=reference-decor-mark]')).not.toBeNull();
  });

  /** No decor to reveal → no dead control. */
  it('offers no reveal control when nothing outbound is decor', () => {
    const { el } = mount({
      references: [
        { targetId: 'mira', descriptor: null, decor: false, target: { id: 'mira', name: 'Mira', types: [NOTE] } },
      ],
    });

    expect(el.querySelector('[data-testid=references-decor-toggle]')).toBeNull();
  });

  /**
   * The inbound section is a *usage* surface (ADR-0069): it never filters, so a decor edge shows
   * unconditionally — marked, so a mere thumbnail reads apart from a prose mention.
   */
  it('shows an inbound Decor Link unconditionally, visually marked', () => {
    const { el } = mount({
      referencedBy: [{ descriptor: null, decor: true, source: { id: 'deity', name: 'Vashenka', types: [NOTE] } }],
    });

    const item = el.querySelector('[data-testid=reference-in]');
    expect(item?.textContent).toContain('Vashenka');
    expect(item?.querySelector('[data-testid=reference-decor-mark]')).not.toBeNull();
  });

  /** "Nothing links here" is a claim about the edge index, not about the fetch: it must not appear before the list lands. */
  it('claims nothing until the list has landed', () => {
    session.loadDetail(noteDetail('Ealdred'));
    const fixture = TestBed.createComponent(ReferencesPanelComponent);
    const store = fixture.debugElement.injector.get(ReferencesStore);
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
    const { el } = mount({});

    expect(el.querySelector('[data-testid=references-out-empty]')).not.toBeNull();
    expect(el.querySelector('[data-testid=references-in-empty]')).not.toBeNull();
  });

  /**
   * The Panel stays open across `:id` changes, so a list held for the Entity just closed must never be
   * shown against the one just opened.
   */
  it('drops a held list when a different Entity is opened', () => {
    const { el } = mount({
      references: [
        { targetId: 'mira', descriptor: null, decor: false, target: { id: 'mira', name: 'Mira', types: [NOTE] } },
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
