import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { EntityDetail, EntityVerb, Metadata } from '@hexly/domain';
import { DND_MONSTER } from '@hexly/plugins';
import { ENTITY_SESSION } from '@hexly/web-entity';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { EntitySession } from '../../pages/entity/services/entity-session';
import { StatBlockView } from './stat-block-view';

/**
 * The bundled plugin's bespoke View (#192). Nothing here registers a type: `dnd.monster` is already
 * in the root {@link TypeRegistry} because the plugin registered it at startup — which is the thing
 * being proved.
 */
describe('StatBlockView', () => {
  const monster = (metadata: Metadata, rights: EntityVerb[] = ['edit'], types: string[] = [DND_MONSTER]) =>
    ({
      id: 'e1',
      worldId: 'w1',
      name: 'Ancient Red Dragon',
      types,
      tags: [],
      visibility: 'private',
      version: 1,
      seq: 1,
      createdAt: 1,
      updatedAt: 1,
      rights,
      document: { content: { format: 'tiptap-v1', snapshot: {} }, metadata },
    }) satisfies EntityDetail;

  let session: EntitySession;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatBlockView, provideTranslocoTesting()],
      providers: [
        EntitySession,
        { provide: ENTITY_SESSION, useExisting: EntitySession },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
    session = TestBed.inject(EntitySession);
  });

  function render(detail: EntityDetail) {
    session.adopt(detail);
    const fixture = TestBed.createComponent(StatBlockView);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('prints the monster as a stat block, not as raw Metadata', () => {
    const { el } = render(
      monster({ size: 'Huge', creature_type: 'dragon', alignment: 'chaotic evil', challenge_rating: 24, strength: 30 }),
    );

    expect(el.querySelector('[data-testid=stat-block-view]')).not.toBeNull();
    // The flavour line a player reads first — derived from the Fields, never authored as prose.
    expect(el.querySelector('[data-testid=stat-block-subtitle]')?.textContent).toContain('Huge dragon, chaotic evil');
    // The derived ability modifier is the whole point of a bespoke view: a raw 30 means +10.
    expect(el.querySelector('[data-testid=stat-mod-strength]')?.textContent).toContain('+10');
  });

  it('edits a stat straight into the one Metadata map every other View reads', () => {
    const { fixture, el } = render(monster({ challenge_rating: 5 }));

    const cr = el.querySelector('[data-testid=stat-challenge_rating] input') as HTMLInputElement;
    expect(cr.value).toBe('5');
    cr.value = '13';
    cr.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // A Field is a lens: the stat block writes the same Metadata the Browser facets on (#188).
    expect(session.body().metadata).toMatchObject({ challenge_rating: 13 });
  });

  /**
   * The block is the *only* surface a monster's optional Fields have — the create dialog collects
   * required ones only, and a type with a bespoke view affords no generic Field view. So every
   * declared Field must be editable here, or a facetable Field would be unsettable in the whole app.
   */
  it('offers an editable slot for every Field the type declares, not just the required one', () => {
    const { fixture, el } = render(monster({ challenge_rating: 5 }));

    const size = el.querySelector('[data-testid=stat-size] select') as HTMLSelectElement;
    expect(Array.from(size.options).map((o) => o.value)).toContain('Huge');
    size.value = 'Huge';
    size.dispatchEvent(new Event('change'));

    const alignment = el.querySelector('[data-testid=stat-alignment] input') as HTMLInputElement;
    alignment.value = 'chaotic evil';
    alignment.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(session.body().metadata).toMatchObject({ size: 'Huge', alignment: 'chaotic evil' });
    // The subtitle is derived, so it re-reads the moment its Fields are edited.
    expect(el.querySelector('[data-testid=stat-block-subtitle]')?.textContent).toContain('Huge, chaotic evil');
  });

  it('flags a missing required Field rather than silently accepting an incomplete monster', () => {
    const { el } = render(monster({ size: 'Large' }));

    const cr = el.querySelector('[data-testid=stat-challenge_rating] input') as HTMLInputElement;
    expect(cr.getAttribute('aria-invalid')).toBe('true');
  });

  it('prints, rather than edits, for a read-only opener', () => {
    const { el } = render(monster({ challenge_rating: 5, dexterity: 8 }, ['read']));

    expect(el.querySelector('input')).toBeNull();
    expect(el.querySelector('[data-testid=stat-challenge_rating]')?.textContent).toContain('5');
    expect(el.querySelector('[data-testid=stat-mod-dexterity]')?.textContent).toContain('-1');
  });

  it('leaves an unfilled stat blank instead of deriving a bogus modifier (forward-only tolerance)', () => {
    const { el } = render(monster({ challenge_rating: 1 }, ['read']));

    expect(el.querySelector('[data-testid=stat-mod-wisdom]')?.textContent).toContain('—');
    expect(el.querySelector('[data-testid=stat-block-subtitle]')?.textContent?.trim()).toBe('');
  });
});
