import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { defineField, EntityDetail, EntityType } from '@hexly/domain';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { FakeEntitySession, provideFakeEntitySession } from '../testing';
import { provideEntityTypesTesting } from '../testing/entity-types.fake';
import { TypeDefinition } from '../models/type-definition';
import { WEB_ENTITY_TEST_CATALOGS } from '../i18n/test-catalogs';
import { DetailsPanelComponent } from './details-panel.component';

/**
 * The Details panel (ADR-0067) — the second universal Dock Panel: the open Entity's Types (inline
 * add/remove), its declared Fields edited in place (inline attach/detach), and its untyped document
 * keys read-only. Driven through `ENTITY_SESSION`/`ENTITY_TYPES`, the seams `apps/web` binds, so the
 * panel's specs never reach for the concrete session or registry.
 */
describe('DetailsPanel', () => {
  const DEITY = 'world.type.deity' as EntityType;
  const HERO = 'world.type.hero' as EntityType;
  const KNIGHT = 'world.type.knight' as EntityType;

  /** A user-defined type whose name is authored data — Deity declares the Domain Field by default. */
  const deityDef: TypeDefinition = {
    id: DEITY,
    icon: 'label',
    views: [],
    labelText: 'Deity',
    fieldRefs: ['world.field.domain'],
    graphColorToken: '--color-ink-muted',
  };
  /** A type declaring two `required` Fields — the Incomplete reading's fixture (ADR-0074). */
  const knightDef: TypeDefinition = {
    id: KNIGHT,
    icon: 'label',
    views: [],
    labelText: 'Knight',
    fieldRefs: ['world.field.epithet', 'world.field.rank'],
    graphColorToken: '--color-ink-muted',
  };
  const heroDef: TypeDefinition = {
    id: HERO,
    icon: 'label',
    views: [],
    labelText: 'Hero',
    // A Hero declares a Structured Data Type Field by default — its own View edits it, never a form row.
    fieldRefs: ['world.field.grid'],
    graphColorToken: '--color-ink-muted',
  };

  const domainField = defineField({ id: 'world.field.domain', label: 'Domain', dataType: { kind: 'string' } });
  const mottoField = defineField({ id: 'world.field.motto', label: 'Motto', dataType: { kind: 'string' } });
  const gridField = defineField({ id: 'world.field.grid', label: 'Grid', dataType: { kind: 'core.datatype.grid' } });
  // A `required` string and a `required` number, so absence (Incomplete) and an ill-typed value (invalid) part.
  const epithetField = defineField({
    id: 'world.field.epithet',
    label: 'Epithet',
    dataType: { kind: 'string' },
    required: true,
  });
  const rankField = defineField({
    id: 'world.field.rank',
    label: 'Rank',
    dataType: { kind: 'number' },
    required: true,
  });

  const deityDetail = (document: Record<string, unknown> = {}): EntityDetail => ({
    id: 'd1',
    worldId: 'w1',
    name: 'Athena',
    types: [DEITY],
    tags: [],
    visibility: 'private',
    version: 1,
    seq: 1,
    createdAt: 1,
    updatedAt: 1,
    document,
  });

  /** The same Entity also typed Knight, so its two `required` Fields ride the effective set. */
  const knightDetail = (document: Record<string, unknown> = {}): EntityDetail => ({
    ...deityDetail(document),
    types: [DEITY, KNIGHT],
  });

  let session: FakeEntitySession;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DetailsPanelComponent, provideTranslocoTesting(WEB_ENTITY_TEST_CATALOGS)],
      providers: [
        provideFakeEntitySession(),
        provideEntityTypesTesting(
          [deityDef, heroDef, knightDef],
          [domainField, mottoField, gridField, epithetField, rankField],
        ),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
    session = TestBed.inject(FakeEntitySession);
  });

  function mount(): { fixture: ComponentFixture<DetailsPanelComponent>; el: HTMLElement } {
    const fixture = TestBed.createComponent(DetailsPanelComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const q = (el: HTMLElement, testid: string) => el.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;

  it('shows the Entity’s Types, its declared Fields, and its untyped document keys', () => {
    session.loadDetail(deityDetail({ 'world.field.domain': 'War', 'legacy.key': 'kept' }));
    const { el } = mount();

    // The type, by its authored name.
    expect(q(el, 'detail-type-world.type.deity')?.textContent).toContain('Deity');
    // Its declared Field, with an editable control holding the value.
    const domain = q(el, 'detail-field-world.field.domain');
    expect(domain).not.toBeNull();
    expect(domain?.querySelector('input')?.value).toBe('War');
    // The untyped key, read-only in the plain block.
    expect(q(el, 'detail-plain')?.textContent).toContain('legacy.key');
    expect(q(el, 'detail-plain')?.textContent).toContain('kept');
  });

  it('persists a Field value edited in place', () => {
    session.loadDetail(deityDetail());
    const { el, fixture } = mount();

    const input = q(el, 'detail-field-world.field.domain')?.querySelector('input') as HTMLInputElement;
    input.value = 'Wisdom';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(session.doc()['world.field.domain']).toBe('Wisdom');
  });

  it('adds a Type inline, updating the Entity’s type set', () => {
    session.loadDetail(deityDetail());
    const { el, fixture } = mount();

    const add = q(el, 'detail-type-add') as HTMLSelectElement;
    add.value = HERO;
    add.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(session.types()).toEqual([DEITY, HERO]);
  });

  it('removes a Type inline, but never the last one', () => {
    session.loadDetail({ ...deityDetail(), types: [DEITY, HERO] });
    const { el, fixture } = mount();

    q(el, 'detail-type-remove-world.type.hero')?.click();
    fixture.detectChanges();
    expect(session.types()).toEqual([DEITY]);

    // The lone remaining type offers no remove control.
    expect(q(el, 'detail-type-remove-world.type.deity')).toBeNull();
  });

  it('attaches a Field inline and detaches an attached one', () => {
    session.loadDetail(deityDetail());
    const { el, fixture } = mount();

    // Motto is a registered Field the deity type never named — attachable.
    const attach = q(el, 'detail-field-add') as HTMLSelectElement;
    attach.value = 'world.field.motto';
    attach.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(session.fields()).toContain('world.field.motto');
    expect(q(el, 'detail-field-world.field.motto')).not.toBeNull();

    // The attached extra offers a detach; a type-default Field does not.
    expect(q(el, 'detail-field-detach-world.field.domain')).toBeNull();
    q(el, 'detail-field-detach-world.field.motto')?.click();
    fixture.detectChanges();
    expect(session.fields()).not.toContain('world.field.motto');
  });

  it('leaves a type-default Structured Field off, but shows an attached one as a detachable row', () => {
    // Hero's grid is a type default: no control, and not a management row.
    session.loadDetail({ ...deityDetail(), types: [DEITY, HERO] });
    const { el } = mount();
    expect(q(el, 'detail-field-world.field.grid')).toBeNull();

    // Attached directly, the same Structured Field shows — a labelled, detachable row with no control.
    session.loadDetail(deityDetail());
    session.attachField('world.field.grid');
    const second = mount();
    const row = q(second.el, 'detail-field-world.field.grid');
    expect(row).not.toBeNull();
    expect(row?.querySelector('input')).toBeNull();
    expect(q(second.el, 'detail-field-detach-world.field.grid')).not.toBeNull();
  });

  it('keeps an untyped key from a missing/disabled Plugin visible and read-only', () => {
    session.loadDetail(deityDetail({ 'absent.plugin.field': 'still here' }));
    const { el } = mount();

    const plain = q(el, 'detail-plain');
    expect(plain?.textContent).toContain('absent.plugin.field');
    expect(plain?.textContent).toContain('still here');
    // No control edits it — a plain read-only row.
    expect(plain?.querySelector('input')).toBeNull();
  });

  it('marks an unfilled required Field Incomplete, and never with the invalid treatment', () => {
    session.loadDetail(knightDetail({ 'world.field.rank': 3 }));
    const { el } = mount();

    // Absent: the Incomplete mark, and nothing of the invalid treatment (ADR-0074).
    const epithet = q(el, 'detail-field-world.field.epithet');
    expect(q(el, 'detail-field-incomplete-world.field.epithet')).not.toBeNull();
    expect(epithet?.querySelector('[aria-invalid]')).toBeNull();
    // Filled: no mark at all, though the Field is still declared `required`.
    expect(q(el, 'detail-field-incomplete-world.field.rank')).toBeNull();
  });

  it('keeps a Field the Incomplete mark flags editable — it prompts, it never blocks', () => {
    session.loadDetail(knightDetail());
    const { el, fixture } = mount();

    const input = q(el, 'detail-field-world.field.epithet')?.querySelector('input') as HTMLInputElement;
    expect(input.disabled).toBe(false);
    input.value = 'Grey-eyed';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(session.doc()['world.field.epithet']).toBe('Grey-eyed');
    // Filling it clears the reading.
    expect(q(el, 'detail-field-incomplete-world.field.epithet')).toBeNull();
  });

  it('reads a present but ill-typed required value as invalid, not as Incomplete', () => {
    session.loadDetail(knightDetail({ 'world.field.rank': 'archon' }));
    const { el } = mount();

    const rank = q(el, 'detail-field-world.field.rank');
    expect(rank?.querySelector('[aria-invalid]')).not.toBeNull();
    expect(q(el, 'detail-field-incomplete-world.field.rank')).toBeNull();
  });

  it('renders fully read-only for a read-only session — values shown, no management controls', () => {
    session.setWritable(false);
    session.loadDetail(knightDetail({ 'world.field.domain': 'War', 'legacy.key': 'kept' }));
    session.setFields(['world.field.motto']);
    const { el } = mount();

    // Values are still shown, and so is the Incomplete reading — the panel's substance is always readable.
    expect(q(el, 'detail-field-world.field.domain')?.querySelector('input')?.value).toBe('War');
    expect(q(el, 'detail-plain')?.textContent).toContain('kept');
    expect(q(el, 'detail-field-incomplete-world.field.epithet')).not.toBeNull();
    // The Field control is disabled.
    expect(q(el, 'detail-field-world.field.domain')?.querySelector('input')?.disabled).toBe(true);
    // No add/remove/attach/detach affordances.
    expect(q(el, 'detail-type-add')).toBeNull();
    expect(q(el, 'detail-type-remove-world.type.deity')).toBeNull();
    expect(q(el, 'detail-field-add')).toBeNull();
    expect(q(el, 'detail-field-detach-world.field.motto')).toBeNull();
  });
});
