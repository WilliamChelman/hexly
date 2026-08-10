import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { defineField, EntityType } from '@hexly/domain';
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
  ): { fixture: ComponentFixture<EntityTypeManagerComponent>; el: HTMLElement } {
    TestBed.configureTestingModule({
      imports: [EntityTypeManagerComponent, provideTranslocoTesting(WEB_ENTITY_TEST_CATALOGS)],
      providers: [
        provideFakeEntitySession(),
        provideEntityTypesTesting([deityDef, heroDef, knightDef], [epithet]),
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
});
