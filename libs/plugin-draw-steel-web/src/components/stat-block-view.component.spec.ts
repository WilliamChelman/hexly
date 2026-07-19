import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { EntityDetail, EntityDocument } from '@hexly/domain';
import { produceWithPatches } from '@hexly/immer';
import { ENTITY_SESSION, EntitySession, VIEW_FIELD_KEY } from '@hexly/web-entity';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { DS_STAT_BLOCK_KEY, DS_STAT_FIELDS } from '@hexly/plugin-draw-steel';
import { DS_TEST_CATALOGS } from '../i18n/test-catalogs';
import { StatBlockViewComponent } from './stat-block-view.component';

/**
 * The `draw-steel.stat-block` data-type's View (#243, ADR-0055) — the classic card, one View in two modes.
 * It binds to the {@link ENTITY_SESSION} contract plus {@link VIEW_FIELD_KEY} (the one document key its
 * whole block lives at), so a minimal fake session and a fixed key stand in for the app's.
 */
describe('StatBlockView (draw-steel)', () => {
  /** A stand-in for the app's central store: the one Entity Document every View reads its slice off. */
  function fakeSession(block: Record<string, unknown>, writable = true, name = 'Angulotl Cleaver'): EntitySession {
    const doc = signal<EntityDocument>({
      content: { format: 'tiptap-v1', snapshot: {} },
      [DS_STAT_BLOCK_KEY]: block,
    });
    return {
      current: signal({ name } as EntityDetail).asReadonly(),
      doc: doc.asReadonly(),
      writable: signal(writable).asReadonly(),
      loadGeneration: signal(0).asReadonly(),
      mutate: (recipe) => {
        const [next, redo, undo] = produceWithPatches(doc(), recipe);
        doc.set(next);
        return { redo, undo };
      },
      applyPatches: () => undefined,
      registerEditor: () => () => undefined,
    };
  }

  /** Render the View over a stat block seeded at {@link DS_STAT_BLOCK_KEY} — the key the page injects. */
  function render(block: Record<string, unknown>, writable = true, name = 'Angulotl Cleaver') {
    const session = fakeSession(block, writable, name);
    TestBed.configureTestingModule({
      imports: [StatBlockViewComponent, provideTranslocoTesting(DS_TEST_CATALOGS)],
      providers: [
        { provide: ENTITY_SESSION, useValue: session },
        { provide: VIEW_FIELD_KEY, useValue: DS_STAT_BLOCK_KEY },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const fixture = TestBed.createComponent(StatBlockViewComponent);
    fixture.detectChanges();
    return { fixture, session, el: fixture.nativeElement as HTMLElement };
  }

  /** The stat block as it sits inside the document — the value at the injected key. */
  const statBlock = (session: EntitySession) => session.doc()[DS_STAT_BLOCK_KEY];

  /** Flip the header toggle into edit mode — an existing (non-empty) block opens on the read card. */
  function startEditing(el: HTMLElement, fixture: { detectChanges(): void }) {
    (el.querySelector('[data-testid=stat-block-edit-toggle]') as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  /** Type a keyword into the tags input and commit it with Enter (the free-tag TokenList). */
  function addTag(el: HTMLElement, token: string, fixture: { detectChanges(): void }) {
    const input = el.querySelector('[data-testid=stat-keywords] input') as HTMLInputElement;
    input.value = token;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
  }

  it('prints the card from one grouped value, with translated labels and the echoed name', () => {
    const { el } = render({ role: 'brute', organization: 'elite', level: 3, might: 2, keywords: ['angulotl'] }, false);

    // The name rides the band, echoed from the Entity (authored in the page header, read-only here).
    expect(el.querySelector('[data-testid=stat-block-name]')?.textContent).toContain('Angulotl Cleaver');
    // The identity sentence composes Level · organization · role, Title-cased from the raw enum keys.
    expect(el.querySelector('[data-testid=stat-block-identity]')?.textContent).toContain('Level 3 Elite Brute');
    // The keyword flavour line joins for legibility.
    expect(el.querySelector('[data-testid=stat-keywords]')?.textContent).toContain('angulotl');
    // The plugin ships its own copy (ADR-0049): a strip label, the immunity section header, and the lore
    // hint all resolve — not the raw key a missing scope would print.
    expect(el.textContent).toContain('Stamina');
    expect(el.textContent).toContain('Immunity');
    expect(el.textContent).toContain('Switch to the Note view');
    // The characteristic prints signed (Draw Steel convention) beside its language-neutral badge letter.
    expect(el.querySelector('[data-testid=stat-might]')?.textContent).toContain('+2');
  });

  it('renders the Traits section above the abilities stub — the printed-card order (#245)', () => {
    const { el } = render({}, false);
    const traits = el.querySelector('[data-testid=section-traits]') as Element;
    const abilities = el.querySelector('[data-testid=section-abilities]') as Element;
    expect(traits).not.toBeNull();
    expect(abilities).not.toBeNull();
    // Traits sits above the future Abilities section.
    expect(traits.compareDocumentPosition(abilities) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('prints passive Traits (name + effect) for a reader (#245)', () => {
    const { el } = render({ traits: [{ name: 'Crafty', effect: 'Ignores difficult terrain.' }] }, false);
    const trait = el.querySelector('[data-testid=section-traits] [data-testid=trait-0]');
    expect(trait?.textContent).toContain('Crafty');
    expect(trait?.textContent).toContain('Ignores difficult terrain.');
    // A reader gets no editing affordance.
    expect(el.querySelector('[data-testid=trait-add]')).toBeNull();
  });

  it('adds, edits, and removes a passive Trait into the one grouped block value (#245)', () => {
    const { fixture, session, el } = render({}); // empty → opens in edit mode

    (el.querySelector('[data-testid=trait-add]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(statBlock(session)).toEqual({ traits: [{ name: '', effect: '' }] });

    const name = el.querySelector('[data-testid=trait-0] [data-testid=trait-name]') as HTMLInputElement;
    name.value = 'Crafty';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const effect = el.querySelector('[data-testid=trait-0] [data-testid=trait-effect]') as HTMLTextAreaElement;
    effect.value = 'Ignores difficult terrain.';
    effect.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(statBlock(session)).toEqual({ traits: [{ name: 'Crafty', effect: 'Ignores difficult terrain.' }] });

    // Removing the last trait clears the key — no `{ traits: [] }` husk into the frontmatter.
    (el.querySelector('[data-testid=trait-0] [data-testid=trait-remove]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(statBlock(session)).toEqual({});
  });

  it('suppresses Trait editing for a read-only opener (writable: false is the ADR-0037 gate)', () => {
    const { el } = render({ traits: [{ name: 'Crafty', effect: 'x' }] }, false);
    expect(el.querySelector('[data-testid=trait-add]')).toBeNull();
    expect(el.querySelector('[data-testid=trait-0] [data-testid=trait-name]')).toBeNull();
  });

  it('shows the minion-only lines (EV suffix, With Captain) for a minion', () => {
    const { el } = render({ organization: 'minion', ev: 3, with_captain: '+1 damage' }, false);
    expect(el.textContent).toContain('for four minions');
    expect(el.querySelector('[data-testid=stat-with_captain]')?.textContent).toContain('+1 damage');
  });

  it('hides the minion-only lines for a non-minion', () => {
    const { el } = render({ organization: 'elite', ev: 3 }, false);
    expect(el.textContent).not.toContain('for four minions');
    expect(el.querySelector('[data-testid=stat-with_captain]')).toBeNull();
  });

  it('edits a scalar stat back into the one grouped block value every other View reads', () => {
    const { fixture, session, el } = render({ level: 5 });
    startEditing(el, fixture);

    const level = el.querySelector('[data-testid=stat-level] input') as HTMLInputElement;
    expect(level.value).toBe('5');
    level.value = '7';
    level.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // A structured Field is a lens: the block writes back at its one key (#188/#236).
    expect(statBlock(session)).toMatchObject({ level: 7 });
  });

  it('offers an editable slot for every stat — the enum role and the free-text keywords list', () => {
    const { fixture, session, el } = render({ level: 3 });
    startEditing(el, fixture);

    // The enum role is the design-system styled select (appSelect — still a native <select>).
    const role = el.querySelector('[data-testid=stat-role] select') as HTMLSelectElement;
    expect(Array.from(role.options).map((o) => o.value)).toContain('brute');
    role.value = 'brute';
    role.dispatchEvent(new Event('change'));

    // Keywords are a tags input: each Enter commits one token as a removable chip.
    addTag(el, 'humanoid', fixture);
    addTag(el, 'goblin', fixture);

    expect(statBlock(session)).toMatchObject({ level: 3, role: 'brute', keywords: ['humanoid', 'goblin'] });
  });

  it('edits movement through a constrained multi-select — the pinned set only (walk gone, hover in)', () => {
    const { fixture, session, el } = render({}); // empty → opens in edit mode

    const add = el.querySelector('[data-testid=stat-movement_types] select') as HTMLSelectElement;
    const options = Array.from(add.options).map((o) => o.value);
    expect(options).toContain('hover');
    expect(options).not.toContain('walk');

    add.value = 'climb';
    add.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(statBlock(session)).toEqual({ movement_types: ['climb'] });
  });

  it('constrains size to the pinned token set (1T…5), offered as a select', () => {
    const { el } = render({}); // empty → edit mode
    const size = el.querySelector('[data-testid=stat-size] select') as HTMLSelectElement;
    const options = Array.from(size.options).map((o) => o.value);
    expect(options).toEqual(expect.arrayContaining(['1T', '1S', '1M', '1L', '2', '5']));
    expect(options).not.toContain('6');
  });

  it('adds a damage type through the dropdown, edits it into a nested map, then clears the map', () => {
    const { fixture, session, el } = render({});

    // The compact editor mints a row only when a type is picked — no nine fixed rows, no `{}` husk.
    const add = el.querySelector('[data-testid=damage-immunities-add]') as HTMLSelectElement;
    add.value = 'fire';
    add.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const fire = el.querySelector('[data-testid=damage-immunities-fire] input') as HTMLInputElement;
    fire.value = '5';
    fire.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(statBlock(session)).toEqual({ immunities: { fire: 5 } });

    // Emptying the only entry drops the whole map — no husk survives into the frontmatter.
    fire.value = '';
    fire.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(statBlock(session)).toEqual({});
  });

  it('does not flag a missing stat — the reusable block imposes no required stat (ADR-0055)', () => {
    const { fixture, el } = render({ role: 'brute' });
    startEditing(el, fixture);

    const level = el.querySelector('[data-testid=stat-level] input') as HTMLInputElement;
    expect(level.getAttribute('aria-invalid')).not.toBe('true');
  });

  it('flags an at-rest ill-typed stat — a string where a number belongs (forward-only)', () => {
    const { fixture, el } = render({ stamina: 'lots' as unknown as number });
    startEditing(el, fixture);

    const stamina = el.querySelector('[data-testid=stat-stamina] input') as HTMLInputElement;
    expect(stamina.getAttribute('aria-invalid')).toBe('true');
  });

  it('prints, rather than edits, for a read-only opener', () => {
    const { el } = render({ level: 5, might: 2, movement_types: ['climb', 'fly'] }, false);

    expect(el.querySelector('input')).toBeNull();
    // A list prints joined for legibility, not as a bare `climb,fly`.
    expect(el.querySelector('[data-testid=stat-movement_types]')?.textContent).toContain('climb, fly');
  });

  it('mints the block on the first edit of an Entity that had none (an attach-and-afford opener)', () => {
    const { fixture, session, el } = render({});
    expect(statBlock(session)).toEqual({});

    const might = el.querySelector('[data-testid=stat-might] input') as HTMLInputElement;
    might.value = '3';
    might.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(statBlock(session)).toEqual({ might: 3 });
  });

  it('opens an existing block on the read card, then toggles into edit and back', () => {
    const { fixture, el } = render({ level: 5 });
    // A writer still opens on the clean card — no controls until they choose to edit.
    expect(el.querySelector('input')).toBeNull();
    expect(el.querySelector('[data-testid=stat-block-edit-toggle]')).not.toBeNull();

    startEditing(el, fixture);
    expect(el.querySelector('[data-testid=stat-level] input')).not.toBeNull();

    startEditing(el, fixture);
    expect(el.querySelector('input')).toBeNull();
  });

  it('opens an empty block straight in edit mode — the create flow lands on controls', () => {
    const { el } = render({});
    expect(el.querySelector('[data-testid=stat-level] input')).not.toBeNull();
  });

  it('offers no edit toggle to a viewer — writable is the ADR-0037 gate, not the local toggle', () => {
    const { el } = render({ level: 5 }, false);
    expect(el.querySelector('[data-testid=stat-block-edit-toggle]')).toBeNull();
    expect(el.querySelector('input')).toBeNull();
  });

  it('offers a settable slot for every flat stat — none is unrendered, so none is unsettable', () => {
    // A minion writable opener surfaces the captain line too; every DS_STAT_FIELDS key must have a slot.
    const { fixture, el } = render({ organization: 'minion' });
    startEditing(el, fixture);
    for (const stat of DS_STAT_FIELDS) {
      expect(el.querySelector(`[data-testid=stat-${stat.id}]`)).not.toBeNull();
    }
  });
});
