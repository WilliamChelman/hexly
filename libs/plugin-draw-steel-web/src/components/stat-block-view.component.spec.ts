import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { EntityDetail, EntityDocument } from '@hexly/domain';
import { produceWithPatches } from '@hexly/immer';
import { ENTITY_SESSION, EntitySession, VIEW_FIELD_KEY } from '@hexly/web-entity';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { DS_STAT_BLOCK_KEY, DS_STAT_FIELDS } from '@hexly/plugin-draw-steel';
import { DICE_RNG, Rng } from '@hexly/dice-web';
import { DICE_TEST_CATALOGS } from '@hexly/dice-web/testing';
import { DS_TEST_CATALOGS } from '../i18n/test-catalogs';
import { StatBlockViewComponent } from './stat-block-view.component';

/**
 * The `draw-steel.datatype.stat-block` data-type's View (#243, ADR-0055) — the classic card, one View in two modes.
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
      types: signal<readonly string[]>([]).asReadonly(),
      fields: signal<readonly string[]>([]).asReadonly(),
      mutate: (recipe) => {
        const [next, redo, undo] = produceWithPatches(doc(), recipe);
        doc.set(next);
        return { redo, undo };
      },
      applyPatches: () => undefined,
      registerEditor: () => () => undefined,
      setTypes: () => undefined,
      attachField: () => undefined,
      detachField: () => undefined,
    };
  }

  /** An RNG that replays `values` in order, then keeps yielding the last — the seam a power-roll spec seeds. */
  const scripted = (values: readonly number[]): Rng => {
    let cursor = 0;
    return () => values[Math.min(cursor++, values.length - 1)];
  };

  /**
   * Render the View over a stat block seeded at {@link DS_STAT_BLOCK_KEY} — the key the page injects. A seeded
   * `rng` makes a read-view power roll deterministic (#252); the dice catalogs feed the bubble's own copy.
   */
  function render(block: Record<string, unknown>, writable = true, name = 'Angulotl Cleaver', rng?: Rng) {
    const session = fakeSession(block, writable, name);
    TestBed.configureTestingModule({
      imports: [StatBlockViewComponent, provideTranslocoTesting(DS_TEST_CATALOGS, DICE_TEST_CATALOGS)],
      providers: [
        { provide: ENTITY_SESSION, useValue: session },
        { provide: VIEW_FIELD_KEY, useValue: DS_STAT_BLOCK_KEY },
        ...(rng ? [{ provide: DICE_RNG, useValue: rng }] : []),
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
    const { el } = render(
      { role: 'brute', organization: 'elite', level: 3, might: 2, keywords: ['angulotl'], immunities: { poison: 5 } },
      false,
    );

    // The name rides the band, echoed from the Entity (authored in the page header, read-only here).
    expect(el.querySelector('[data-testid=stat-block-name]')?.textContent).toContain('Angulotl Cleaver');
    // The identity sentence composes Level · organization · role, Title-cased from the raw enum keys.
    expect(el.querySelector('[data-testid=stat-block-identity]')?.textContent).toContain('Level 3 Elite Brute');
    // The keyword flavour line joins for legibility.
    expect(el.querySelector('[data-testid=stat-keywords]')?.textContent).toContain('angulotl');
    // The plugin ships its own copy (ADR-0049): a spec-rail label, a damage-type label on the immunity
    // chip, and the lore hint all resolve — not the raw key a missing scope would print.
    expect(el.textContent).toContain('Stamina');
    expect(el.textContent).toContain('Poison');
    expect(el.textContent).toContain('Switch to the Note view');
    // The characteristic prints signed (Draw Steel convention) beside its language-neutral badge letter.
    expect(el.querySelector('[data-testid=stat-might]')?.textContent).toContain('+2');
  });

  it('renders the Abilities section above the Traits section — abilities lead the card', () => {
    const { el } = render({}, false);
    const traits = el.querySelector('[data-testid=section-traits]') as Element;
    const abilities = el.querySelector('[data-testid=section-abilities]') as Element;
    expect(traits).not.toBeNull();
    expect(abilities).not.toBeNull();
    // Abilities sits above the Traits section.
    expect(abilities.compareDocumentPosition(traits) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it('reorders Traits within the section by swapping with a neighbour', () => {
    const { fixture, session, el } = render({
      traits: [
        { name: 'First', effect: 'a' },
        { name: 'Second', effect: 'b' },
      ],
    });
    startEditing(el, fixture);

    // The first trait can't move up (button disabled); moving it down swaps it past the second.
    expect((el.querySelector('[data-testid=trait-0] [data-testid=trait-move-up]') as HTMLButtonElement).disabled).toBe(
      true,
    );
    (el.querySelector('[data-testid=trait-0] [data-testid=trait-move-down]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(statBlock(session)).toEqual({
      traits: [
        { name: 'Second', effect: 'b' },
        { name: 'First', effect: 'a' },
      ],
    });
  });

  it('suppresses Trait editing for a read-only opener (writable: false is the ADR-0037 gate)', () => {
    const { el } = render({ traits: [{ name: 'Crafty', effect: 'x' }] }, false);
    expect(el.querySelector('[data-testid=trait-add]')).toBeNull();
    expect(el.querySelector('[data-testid=trait-0] [data-testid=trait-name]')).toBeNull();
  });

  it('prints an ability with its power-roll tiers, and one with a flat effect, for a reader (#246)', () => {
    const { el } = render(
      {
        abilities: [
          {
            name: 'Cleave',
            type: 'main',
            category: 'signature',
            keywords: ['melee', 'weapon'],
            distance: 'Melee 1',
            target: 'One creature',
            powerRoll: { characteristic: 'might', t1: '2 damage', t2: '5 damage', t3: '8 damage; push 1' },
          },
          {
            name: 'Watchful',
            type: 'triggered',
            keywords: [],
            distance: 'Self',
            target: 'Self',
            trigger: 'An enemy moves adjacent',
            effect: 'The creature shifts 1.',
          },
        ],
      },
      false,
    );

    const cleave = el.querySelector('[data-testid=section-abilities] [data-testid=ability-0]');
    expect(cleave?.textContent).toContain('Cleave');
    expect(cleave?.textContent).toContain('Melee 1');
    // The three tiers render from the flat texts — Hexly never rolls (#246).
    expect(cleave?.querySelector('[data-testid=ability-powerroll]')?.textContent).toContain('8 damage; push 1');

    const watchful = el.querySelector('[data-testid=section-abilities] [data-testid=ability-1]');
    expect(watchful?.textContent).toContain('An enemy moves adjacent');
    // No power roll → the flat effect stands in.
    expect(watchful?.querySelector('[data-testid=ability-powerroll]')).toBeNull();
    expect(watchful?.querySelector('[data-testid=ability-effect]')?.textContent).toContain('The creature shifts 1.');
    // A reader gets no editing affordance.
    expect(el.querySelector('[data-testid=ability-add]')).toBeNull();
  });

  it('adds an ability, edits its fields, and toggles a power roll into the one grouped block value (#246)', () => {
    const { fixture, session, el } = render({}); // empty → opens in edit mode

    (el.querySelector('[data-testid=ability-add]') as HTMLButtonElement).click();
    fixture.detectChanges();
    // A fresh ability opens well-formed with a default type and no power roll (its flat effect editor shows).
    expect(statBlock(session)).toEqual({
      abilities: [{ name: '', type: 'main', keywords: [], distance: '', target: '' }],
    });

    const name = el.querySelector('[data-testid=ability-0] [data-testid=ability-name]') as HTMLInputElement;
    name.value = 'Cleave';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const distance = el.querySelector('[data-testid=ability-0] [data-testid=ability-distance]') as HTMLInputElement;
    distance.value = 'Melee 1';
    distance.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // Toggle a power roll on: the flat-effect editor is replaced by the characteristic + three tiers.
    (el.querySelector('[data-testid=ability-0] [data-testid=ability-powerroll-add]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid=ability-0] [data-testid=ability-effect]')).toBeNull();

    const t3 = el.querySelector('[data-testid=ability-0] [data-testid=ability-t3]') as HTMLInputElement;
    t3.value = '8 damage; push 1';
    t3.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(statBlock(session)).toEqual({
      abilities: [
        {
          name: 'Cleave',
          type: 'main',
          keywords: [],
          distance: 'Melee 1',
          target: '',
          powerRoll: { characteristic: 'might', t1: '', t2: '', t3: '8 damage; push 1' },
        },
      ],
    });

    // Removing the last ability clears the key — no `{ abilities: [] }` husk into the frontmatter.
    (el.querySelector('[data-testid=ability-0] [data-testid=ability-remove]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(statBlock(session)).toEqual({});
  });

  it('reorders Abilities within the section by swapping with a neighbour', () => {
    const { fixture, session, el } = render({
      abilities: [
        { name: 'First', type: 'main', keywords: [], distance: '', target: '' },
        { name: 'Second', type: 'main', keywords: [], distance: '', target: '' },
      ],
    });
    startEditing(el, fixture);

    // The last ability can't move down (button disabled); moving it up swaps it above the first.
    expect(
      (el.querySelector('[data-testid=ability-1] [data-testid=ability-move-down]') as HTMLButtonElement).disabled,
    ).toBe(true);
    (el.querySelector('[data-testid=ability-1] [data-testid=ability-move-up]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(statBlock(session)).toEqual({
      abilities: [
        { name: 'Second', type: 'main', keywords: [], distance: '', target: '' },
        { name: 'First', type: 'main', keywords: [], distance: '', target: '' },
      ],
    });
  });

  it('suppresses Ability editing for a read-only opener (writable: false is the ADR-0037 gate) (#246)', () => {
    const { el } = render(
      { abilities: [{ name: 'Cleave', type: 'main', keywords: [], distance: '', target: '' }] },
      false,
    );
    expect(el.querySelector('[data-testid=ability-add]')).toBeNull();
    expect(el.querySelector('[data-testid=ability-0] [data-testid=ability-name]')).toBeNull();
  });

  // --- Read-view ephemeral power-roll resolution (#252) --------------------------------------------

  /** A read-view monster with one rolling ability keyed on `characteristic`, seeded for a deterministic Roll. */
  function withRoll(characteristic: string, block: Record<string, unknown>, rng: Rng) {
    return render(
      {
        ...block,
        abilities: [
          {
            name: 'Cleave',
            type: 'main',
            keywords: [],
            distance: '',
            target: '',
            powerRoll: { characteristic, t1: 'a', t2: 'b', t3: 'c' },
          },
        ],
      },
      false,
      'Angulotl Cleaver',
      rng,
    );
  }

  const rollBtn = (el: HTMLElement) => el.querySelector('[data-testid=ability-roll]') as HTMLButtonElement;

  it('shows a roll button on a read-view power roll, absent on a flat-effect ability (#252)', () => {
    const { el } = render(
      {
        abilities: [
          {
            name: 'Cleave',
            type: 'main',
            keywords: [],
            distance: '',
            target: '',
            powerRoll: { characteristic: 'might', t1: 'a', t2: 'b', t3: 'c' },
          },
          {
            name: 'Watchful',
            type: 'triggered',
            keywords: [],
            distance: '',
            target: '',
            effect: 'The creature shifts 1.',
          },
        ],
      },
      false,
    );
    expect(el.querySelector('[data-testid=ability-0] [data-testid=ability-roll]')).not.toBeNull();
    expect(el.querySelector('[data-testid=ability-1] [data-testid=ability-roll]')).toBeNull();
  });

  it('hides the roll button in edit mode — rolling is a read-view affordance (#252)', () => {
    const { fixture, el } = render({
      abilities: [
        {
          name: 'Cleave',
          type: 'main',
          keywords: [],
          distance: '',
          target: '',
          powerRoll: { characteristic: 'might', t1: 'a', t2: 'b', t3: 'c' },
        },
      ],
    }); // writable, non-empty → opens on the read card, roll button present
    expect(rollBtn(el)).not.toBeNull();
    startEditing(el, fixture);
    expect(el.querySelector('[data-testid=ability-roll]')).toBeNull();
  });

  it('rolls 2d10 + the characteristic, bubbles the total + tier, and highlights that tier row (#252)', () => {
    // might 2; two 6-faces → 2d10 = 12, + 2 = 14 → Tier 2 (12–16).
    const { fixture, el } = withRoll('might', { might: 2 }, scripted([0.5, 0.5]));
    rollBtn(el).click();
    fixture.detectChanges();

    expect(el.querySelector('[data-testid=ability-roll-bubble]')).not.toBeNull();
    expect(el.querySelector('[data-testid=ability-roll-total]')?.textContent).toContain('14');
    expect(el.querySelector('[data-testid=ability-roll-tier]')?.textContent).toContain('Tier 2');
    // The matching tier row highlights in place; the others do not.
    expect(el.querySelector('[data-testid=ability-tier-t2]')?.getAttribute('data-active')).toBe('true');
    expect(el.querySelector('[data-testid=ability-tier-t1]')?.getAttribute('data-active')).toBeNull();
    expect(el.querySelector('[data-testid=ability-tier-t3]')?.getAttribute('data-active')).toBeNull();
  });

  it('rolls + 0 when the characteristic has no value on the block (#252)', () => {
    // No agility on the block; faces 1 and 10 → 2d10 = 11, + 0 = 11 → Tier 1 (≤11).
    const { fixture, el } = withRoll('agility', {}, scripted([0.0, 0.95]));
    rollBtn(el).click();
    fixture.detectChanges();

    expect(el.querySelector('[data-testid=ability-roll-total]')?.textContent).toContain('11');
    expect(el.querySelector('[data-testid=ability-tier-t1]')?.getAttribute('data-active')).toBe('true');
  });

  it('keeps the bubble across change detection, replaces it on re-roll, and clears it on dismiss (#252)', () => {
    // First click: 6,6 → 14 (Tier 2). Second click: 10,10 → 22 (Tier 3).
    const { fixture, el } = withRoll('might', { might: 2 }, scripted([0.5, 0.5, 0.9, 0.9]));
    rollBtn(el).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid=ability-roll-total]')?.textContent).toContain('14');

    // Sticky across an unrelated change-detection pass.
    fixture.detectChanges();
    expect(el.querySelector('[data-testid=ability-roll-bubble]')).not.toBeNull();

    // A re-roll replaces the previous bubble in one click — one bubble, not two.
    rollBtn(el).click();
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-testid=ability-roll-bubble]').length).toBe(1);
    expect(el.querySelector('[data-testid=ability-roll-total]')?.textContent).toContain('22');
    expect(el.querySelector('[data-testid=ability-tier-t3]')?.getAttribute('data-active')).toBe('true');

    // Explicit dismiss clears the bubble and its highlight.
    (el.querySelector('[data-testid=ability-roll-dismiss]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid=ability-roll-bubble]')).toBeNull();
    expect(el.querySelector('[data-testid=ability-tier-t3]')?.getAttribute('data-active')).toBeNull();
  });

  it('clears the bubble on an outside click (#252)', () => {
    const { fixture, el } = withRoll('might', { might: 2 }, scripted([0.5, 0.5]));
    rollBtn(el).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid=ability-roll-bubble]')).not.toBeNull();

    // A click anywhere outside the button/bubble dismisses it (the document listener).
    document.body.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid=ability-roll-bubble]')).toBeNull();
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

  // --- Schema delta #254: save, turns, condition immunities, ability malice + category ----------------

  it('prints the save and turns defences on the rail for a reader (#254)', () => {
    const { el } = render({ save: 4, turns: 2 }, false);
    expect(el.querySelector('[data-testid=stat-save]')?.textContent).toContain('4');
    expect(el.querySelector('[data-testid=stat-turns]')?.textContent).toContain('2');
  });

  it('edits the save defence back through the same lens the rest of the card writes (#254)', () => {
    const { fixture, session, el } = render({ save: 4, turns: 2 });
    startEditing(el, fixture);
    const save = el.querySelector('[data-testid=stat-save] input') as HTMLInputElement;
    expect(save.value).toBe('4');
    save.value = '5';
    save.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(statBlock(session)).toMatchObject({ save: 5, turns: 2 });
  });

  it('constrains condition immunities to the pinned set, adding one into a nested list (#254)', () => {
    const { fixture, session, el } = render({}); // empty → edit mode

    const add = el.querySelector('[data-testid=stat-condition_immunities] select') as HTMLSelectElement;
    const options = Array.from(add.options).map((o) => o.value);
    expect(options).toContain('frightened');
    expect(options).not.toContain('stunned');

    add.value = 'prone';
    add.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(statBlock(session)).toEqual({ condition_immunities: ['prone'] });
  });

  it('prints condition immunities joined for a reader (#254)', () => {
    const { el } = render({ condition_immunities: ['frightened', 'prone'] }, false);
    expect(el.querySelector('[data-testid=stat-condition_immunities]')?.textContent).toContain('frightened, prone');
  });

  it('edits an ability malice (number) and category (enum) into the block, dropping blanks (#254)', () => {
    const { fixture, session, el } = render({
      abilities: [{ name: 'Doom', type: 'villain', keywords: [], distance: '', target: '' }],
    });
    startEditing(el, fixture);

    const category = el.querySelector('[data-testid=ability-0] [data-testid=ability-category]') as HTMLSelectElement;
    expect(Array.from(category.options).map((o) => o.value)).toContain('villain');
    category.value = 'villain';
    category.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const malice = el.querySelector('[data-testid=ability-0] [data-testid=ability-malice]') as HTMLInputElement;
    malice.value = '3';
    malice.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(statBlock(session)).toEqual({
      abilities: [
        { name: 'Doom', type: 'villain', category: 'villain', malice: 3, keywords: [], distance: '', target: '' },
      ],
    });

    // Clearing the malice drops it — no husk into the frontmatter.
    malice.value = '';
    malice.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(statBlock(session)).toEqual({
      abilities: [{ name: 'Doom', type: 'villain', category: 'villain', keywords: [], distance: '', target: '' }],
    });
  });

  it('reads a hand-authored malice + category ability, showing the category and the malice (#254)', () => {
    const { el } = render(
      {
        abilities: [
          {
            name: 'Doom',
            type: 'villain',
            category: 'villain',
            malice: 3,
            keywords: [],
            distance: '',
            target: '',
            effect: 'Everyone suffers.',
          },
        ],
      },
      false,
    );
    const ability = el.querySelector('[data-testid=section-abilities] [data-testid=ability-0]');
    expect(ability?.querySelector('[data-testid=ability-category-read]')?.textContent).toContain('Villain');
    expect(ability?.querySelector('[data-testid=ability-malice-read]')?.textContent).toContain('3');
  });

  it('drives the signature highlight off the category enum, not a cost string (#254)', () => {
    const { el } = render(
      {
        abilities: [
          {
            name: 'Cleave',
            type: 'triggered',
            category: 'signature',
            keywords: [],
            distance: '',
            target: '',
            effect: 'x',
          },
        ],
      },
      false,
    );
    // A signature-categorised ability gets the gold accent bar even when its turn-slot type is not `main`.
    expect(el.querySelector('[data-testid=ability-0]')?.getAttribute('class')).toContain('border-gold');
  });
});
