import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { defineField, EntityType } from '@hexly/domain';
import { IconName } from '@hexly/web-ui';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { ENTITY_TYPES } from '../models/entity-types';
import { TypeDefinition } from '../models/type-definition';
import { FakeEntitySession, provideFakeEntitySession } from '../testing';
import { FakeEntityTypes, provideEntityTypesTesting } from '../testing/entity-types.fake';
import { WEB_ENTITY_TEST_CATALOGS } from '../i18n/test-catalogs';
import { EntityTypeManagerComponent } from './entity-type-manager.component';

/**
 * The reusable entity type manager (#438) — driven through the `ENTITY_SESSION`/`ENTITY_TYPES` seams,
 * so the spec asserts on what a user observes (which options and Create row appear, what lands in the
 * type set, what gets minted), never on internals or HTTP.
 */
describe('EntityTypeManager', () => {
  const DEITY = 'world.type.deity' as EntityType;
  const HERO = 'world.type.hero' as EntityType;
  const KNIGHT = 'world.type.knight' as EntityType;

  const def = (id: string, labelText: string, fieldRefs: string[] = []): TypeDefinition => ({
    id: id as EntityType,
    icon: 'label',
    views: [],
    labelText,
    fieldRefs,
  });

  const deityDef = def(DEITY, 'Deity');
  const heroDef = def(HERO, 'Hero');
  const knightDef = def(KNIGHT, 'Knight', ['world.field.epithet']);
  const epithet = defineField({
    id: 'world.field.epithet',
    label: 'Epithet',
    dataType: { kind: 'string' },
    required: true,
  });

  let session: FakeEntitySession;
  let types: FakeEntityTypes;

  function mount(
    seed: EntityType[],
    writable = true,
    extraDefs: TypeDefinition[] = [],
  ): { fixture: ComponentFixture<EntityTypeManagerComponent>; el: HTMLElement } {
    TestBed.configureTestingModule({
      imports: [EntityTypeManagerComponent, provideTranslocoTesting(WEB_ENTITY_TEST_CATALOGS)],
      providers: [
        provideFakeEntitySession(),
        provideEntityTypesTesting([deityDef, heroDef, knightDef, ...extraDefs], [epithet]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    session = TestBed.inject(FakeEntitySession);
    types = TestBed.inject(ENTITY_TYPES) as FakeEntityTypes;
    session.setTypes(seed);
    session.setWritable(writable);
    const fixture = TestBed.createComponent(EntityTypeManagerComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const q = (el: HTMLElement, testid: string) => el.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;

  function type(el: HTMLElement, text: string, fixture: ComponentFixture<EntityTypeManagerComponent>): void {
    const input = q(el, 'type-add') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('badges the first type as primary and reorders to re-primary it', () => {
    const { el, fixture } = mount([DEITY, HERO]);
    expect(q(el, 'type-chip-world.type.deity')?.querySelector('[data-testid=type-primary]')).not.toBeNull();
    expect(q(el, 'type-chip-world.type.hero')?.querySelector('[data-testid=type-primary]')).toBeNull();

    q(el, 'type-move-up-world.type.hero')?.click();
    fixture.detectChanges();
    expect(session.types()).toEqual([HERO, DEITY]);
  });

  it('removes a type, but never the last one', () => {
    const { el, fixture } = mount([DEITY, HERO]);
    q(el, 'type-remove-world.type.hero')?.click();
    fixture.detectChanges();
    expect(session.types()).toEqual([DEITY]);
    // The lone remaining type offers no remove.
    expect(q(el, 'type-remove-world.type.deity')).toBeNull();
  });

  it('fuzzy-filters the creatable list and adds a picked existing type', () => {
    const { el, fixture } = mount([DEITY]);
    type(el, 'her', fixture);
    expect(q(el, 'type-option-world.type.hero')).not.toBeNull();
    // Deity is already carried, so it is never offered.
    expect(q(el, 'type-option-world.type.deity')).toBeNull();

    q(el, 'type-option-world.type.hero')?.click();
    fixture.detectChanges();
    expect(session.types()).toEqual([DEITY, HERO]);
  });

  it('shows the Create row to an Owner and never to a non-Owner (#438)', () => {
    const { el, fixture } = mount([DEITY]);
    types.setCanCreate(true);
    type(el, 'Villain', fixture);
    expect(q(el, 'type-create')).not.toBeNull();

    types.setCanCreate(false);
    type(el, 'Villain', fixture);
    expect(q(el, 'type-create')).toBeNull();
  });

  it('keeps the Create row present even when a partial match is listed (#438)', () => {
    const { el, fixture } = mount([KNIGHT]);
    types.setCanCreate(true);
    type(el, 'Her', fixture);
    // Both the partial match and the Create row — a longer existing name never blocks a mint.
    expect(q(el, 'type-option-world.type.hero')).not.toBeNull();
    expect(q(el, 'type-create')).not.toBeNull();
  });

  it('mints a fresh name, then adds the returned id to the set', async () => {
    const { el, fixture } = mount([DEITY]);
    types.setCanCreate(true);
    type(el, 'Villain', fixture);
    q(el, 'type-create')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(types.created).toEqual(['Villain']);
    expect(session.types()).toEqual([DEITY, 'world.type.villain']);
    // The minted type reads as a named chip, not a raw id.
    expect(q(el, 'type-chip-world.type.villain')?.textContent).toContain('Villain');
  });

  it('reconciles an exact name to the existing type instead of minting a duplicate (#438)', async () => {
    const { el, fixture } = mount([HERO]);
    types.setCanCreate(true);
    // Case-insensitively exact against the existing "Deity" — Create adds it, never a second type.
    type(el, 'deity', fixture);
    q(el, 'type-create')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(types.created).toEqual([]);
    expect(session.types()).toEqual([HERO, DEITY]);
  });

  it('folds accents when reconciling, so "Déïty" resolves to the existing Deity (#438, US8)', async () => {
    const { el, fixture } = mount([HERO]);
    types.setCanCreate(true);
    // The slug would fold "Déïty" to `deity` and collide; the name match must fold too, or it mints a
    // visual duplicate `world.type.deity-2` instead of selecting the existing type.
    type(el, 'Déïty', fixture);
    q(el, 'type-create')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(types.created).toEqual([]);
    expect(session.types()).toEqual([HERO, DEITY]);
  });

  it('prompts for a newly-added type’s required Fields, then collects them on confirm (ADR-0074)', () => {
    const { el, fixture } = mount([DEITY]);
    type(el, 'Knight', fixture);
    q(el, 'type-option-world.type.knight')?.click();
    fixture.detectChanges();

    expect(q(el, 'type-add-prompt')).not.toBeNull();
    const input = q(el, 'pending-field-world.field.epithet')?.querySelector('input') as HTMLInputElement;
    input.value = 'Grey-eyed';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    q(el, 'type-add-confirm')?.click();
    fixture.detectChanges();
    expect(session.types()).toEqual([DEITY, KNIGHT]);
    expect(session.doc()['world.field.epithet']).toBe('Grey-eyed');
  });

  it('shows no management affordances for a read-only opener', () => {
    const { el } = mount([DEITY, HERO], false);
    expect(q(el, 'type-add')).toBeNull();
    expect(q(el, 'type-remove-world.type.deity')).toBeNull();
    // The ordered chips still render, so a viewer sees the type set.
    expect(q(el, 'type-chip-world.type.deity')).not.toBeNull();
  });

  // ── A. Restored coverage (behaviours still shipping, untested since the old editor spec was deleted) ──

  /**
   * Hue alone can't separate eight categories for a dichromat, so the glyph carries the category and the
   * tone is decoration (ADR-0075) — a chip without its icon is a regression.
   */
  it('renders the type’s icon on its chip and wears its derived tone (ADR-0075)', () => {
    const CROWN = 'world.type.crown' as EntityType;
    // A pinned tone so the assertion is a fixed value, not one recomputed from the same derivation.
    const crownDef: TypeDefinition = {
      id: CROWN,
      icon: 'crown' as IconName,
      tone: 'tone-4',
      views: [],
      labelText: 'Crown',
      fieldRefs: [],
    };
    const { el } = mount([CROWN], true, [crownDef]);

    const chip = q(el, 'type-chip-world.type.crown');
    // The icon channel is present — a neutral `[icon]="null"` chip renders no <app-icon> at all.
    expect(chip?.querySelector('app-icon')).not.toBeNull();
    // …and the chip wears the tone binding, so the category rides a colour too.
    expect(chip?.classList.contains('is-tone-4')).toBe(true);
  });

  it('adds the type from the prompt with its required Fields left empty, writing nothing (ADR-0074)', () => {
    const { el, fixture } = mount([DEITY]);
    type(el, 'Knight', fixture);
    q(el, 'type-option-world.type.knight')?.click();
    fixture.detectChanges();
    expect(q(el, 'type-add-prompt')).not.toBeNull();

    q(el, 'type-add-bare')?.click();
    fixture.detectChanges();
    // The type lands (Incomplete), but no value is written for the unfilled required Field.
    expect(session.types()).toEqual([DEITY, KNIGHT]);
    expect(session.doc()['world.field.epithet']).toBeUndefined();
    expect(q(el, 'type-add-prompt')).toBeNull();
  });

  it('dismisses the prompt without adding the type, so a mis-picked type is recoverable (#338)', () => {
    const { el, fixture } = mount([DEITY]);
    type(el, 'Knight', fixture);
    q(el, 'type-option-world.type.knight')?.click();
    fixture.detectChanges();
    expect(q(el, 'type-add-prompt')).not.toBeNull();

    q(el, 'type-add-cancel')?.click();
    fixture.detectChanges();
    // Nothing committed: not the type, not a document value, and the picker is back.
    expect(q(el, 'type-add-prompt')).toBeNull();
    expect(session.types()).toEqual([DEITY]);
    expect(session.doc()['world.field.epithet']).toBeUndefined();
    expect(q(el, 'type-add')).not.toBeNull();
  });

  it('reorders adjacent types with move-down (↓)', () => {
    const { el, fixture } = mount([DEITY, HERO]);
    q(el, 'type-move-down-world.type.deity')?.click();
    fixture.detectChanges();
    expect(session.types()).toEqual([HERO, DEITY]);
  });

  // ── B. New behaviour (#438) ──

  it('reconciles across punctuation/whitespace by slug, adding the existing type not a duplicate (US8)', async () => {
    const FIRE_GOD = 'world.type.fire-god' as EntityType;
    const fireGodDef = def(FIRE_GOD, 'Fire-God');
    const { el, fixture } = mount([HERO], true, [fireGodDef]);
    types.setCanCreate(true);
    // "Fire God" (space, no hyphen) slugs to `fire-god` — the same id "Fire-God" derives, so Create
    // reconciles onto the existing type. Accent-fold alone would not fold the space and would mint.
    type(el, 'Fire God', fixture);
    q(el, 'type-create')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(types.created).toEqual([]);
    expect(session.types()).toEqual([HERO, FIRE_GOD]);
  });

  it('mints a valid world.type id from a non-Latin label, showing the verbatim chip (#438)', async () => {
    const { el, fixture } = mount([DEITY]);
    types.setCanCreate(true);
    // "神" has no Latin alphanumerics, so its slug is empty; the mint must still derive a valid id.
    type(el, '神', fixture);
    q(el, 'type-create')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(types.created).toEqual(['神']);
    // A valid, well-formed user-type id (the fake derives `world.type.type` for an empty slug).
    const added = session.types().find((t) => t !== DEITY) as EntityType;
    expect(added).toMatch(/^world\.type\..+/);
    // The chip reads the verbatim label, not the derived id.
    expect(q(el, `type-chip-${added}`)?.textContent).toContain('神');
  });

  it('surfaces an inline error when the mint fails, retaining the query and clearing on retype (#438)', async () => {
    const { el, fixture } = mount([DEITY]);
    types.setCanCreate(true);
    types.setCreateShouldFail(true);
    type(el, 'Villain', fixture);
    q(el, 'type-create')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const error = q(el, 'type-create-error');
    expect(error).not.toBeNull();
    expect(error?.getAttribute('role')).toBe('alert');
    // Nothing added, and the typed text stays put so the author can retry.
    expect(session.types()).toEqual([DEITY]);
    expect(types.created).toEqual([]);
    expect((q(el, 'type-add') as HTMLInputElement).value).toBe('Villain');

    // Typing again clears the stale error.
    type(el, 'Villains', fixture);
    expect(q(el, 'type-create-error')).toBeNull();
  });

  it('drives the highlight by keyboard, and Enter takes the highlighted Create row over a partial match (#438)', async () => {
    const { el, fixture } = mount([KNIGHT]);
    types.setCanCreate(true);
    // "Her" partial-matches Hero AND offers Create — the two options, in walk order.
    type(el, 'Her', fixture);
    const input = q(el, 'type-add') as HTMLInputElement;
    expect(q(el, 'type-option-world.type.hero')).not.toBeNull();
    expect(q(el, 'type-create')).not.toBeNull();
    // The highlight opens on the first option.
    expect(input.getAttribute('aria-activedescendant')).toBe('type-opt-world.type.hero');

    // ArrowDown moves the highlight to the Create row. CDK's ListKeyManager reads `keyCode`, which
    // jsdom does not derive from `key`, so send it the way a real browser would (see the palette spec).
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true } as KeyboardEventInit),
    );
    fixture.detectChanges();
    expect(input.getAttribute('aria-activedescendant')).toBe('type-opt-create');
    expect(q(el, 'type-create')?.getAttribute('aria-selected')).toBe('true');

    // Enter acts on the *visible* highlight: it mints, it does not silently pick the partial-match Hero.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(types.created).toEqual(['Her']);
    expect(session.types()).not.toContain(HERO);
    expect(session.types()).toEqual([KNIGHT, 'world.type.her']);
  });
});
