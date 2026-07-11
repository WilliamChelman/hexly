import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { EntityDetail, EntityVerb, FieldSchema } from '@hexly/domain';
import { ENTITY_SESSION } from '@hexly/web-entity';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { EntitySession } from '../services/entity-session';
import { TypeRegistry } from '../../../entity-types/type-registry';
import { GenericFieldView } from './generic-field-view';

const beastFields: FieldSchema[] = [
  { key: 'name', label: 'Name', dataType: { kind: 'string' }, required: true, facetable: false },
  {
    key: 'size',
    label: 'Size',
    dataType: { kind: 'enum', options: ['small', 'large'] },
    required: false,
    facetable: false,
  },
  { key: 'cr', label: 'CR', dataType: { kind: 'number' }, required: false, facetable: false },
];

describe('GenericFieldView', () => {
  const detail = (
    types: string[],
    metadata: Record<string, unknown> | undefined,
    rights: EntityVerb[],
  ): EntityDetail => ({
    id: 'e1',
    worldId: 'w1',
    name: 'Aboleth',
    types,
    tags: [],
    visibility: 'private',
    version: 1,
    seq: 1,
    createdAt: 1,
    updatedAt: 1,
    rights,
    document: { content: { format: 'tiptap-v1', snapshot: {} }, metadata },
  });

  let session: EntitySession;
  let registry: TypeRegistry;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GenericFieldView, provideTranslocoTesting()],
      providers: [
        EntitySession,
        { provide: ENTITY_SESSION, useExisting: EntitySession },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
    session = TestBed.inject(EntitySession);
    registry = TestBed.inject(TypeRegistry);
  });

  function render(detailToOpen: EntityDetail) {
    session.adopt(detailToOpen);
    const fixture = TestBed.createComponent(GenericFieldView);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('renders a type’s declared Fields off Metadata, labelled and typed', () => {
    registry.register(definitionWithFields('test.beast', beastFields));
    const { el } = render(detail(['test.beast'], { name: 'Aboleth', size: 'large' }, ['edit']));

    // The string Field shows its Metadata value; the enum Field renders its options as a <select>.
    const name = el.querySelector('[data-testid=field-name] input') as HTMLInputElement;
    expect(name.value).toBe('Aboleth');
    const size = el.querySelector('[data-testid=field-size] select') as HTMLSelectElement;
    expect(size.value).toBe('large');
    expect(Array.from(size.options).map((o) => o.value)).toEqual(['', 'small', 'large']);
  });

  it('writes an edited Field value back into the Metadata map', () => {
    registry.register(definitionWithFields('test.beast', beastFields));
    const { fixture, el } = render(detail(['test.beast'], { name: 'Aboleth' }, ['edit']));

    const name = el.querySelector('[data-testid=field-name] input') as HTMLInputElement;
    name.value = 'Kraken';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // The value lands in the one Metadata map — no separate store (CONTEXT.md → Field).
    expect(session.body().metadata).toMatchObject({ name: 'Kraken' });
  });

  it('renders a read-only opener’s controls disabled', () => {
    registry.register(definitionWithFields('test.beast', beastFields));
    const { el } = render(detail(['test.beast'], { name: 'Aboleth' }, ['read']));

    expect((el.querySelector('[data-testid=field-name] input') as HTMLInputElement).disabled).toBe(true);
  });

  it('falls back to an inert chip + plain Metadata for a type with no registered view', () => {
    // No definition registered for `dnd.monster`: the missing-plugin fallback.
    const { el } = render(detail(['dnd.monster'], { lore: 'ancient', power: 9 }, ['edit']));

    const chip = el.querySelector('[data-testid=type-chip]');
    expect(chip?.textContent).toContain('dnd.monster');
    // Its values fall through to the plain-Metadata display — nothing hidden, nothing editable.
    const plain = el.querySelector('[data-testid=field-plain-metadata]');
    expect(plain?.textContent).toContain('lore');
    expect(plain?.textContent).toContain('ancient');
    expect(el.querySelector('[data-testid=field-lore]')).toBeNull();
    expect(el.querySelector('input')).toBeNull();
  });
});

/** A TypeDefinition carrying a Field schema — the rest of the shape is irrelevant to this view. */
function definitionWithFields(id: string, fields: FieldSchema[]) {
  return {
    id: id as `${string}.${string}`,
    icon: 'label' as const,
    views: [],
    fields,
    graphColorToken: '--color-ink-muted',
    labels: {
      eyebrow: `${id}.eyebrow`,
      titleLabel: `${id}.titleLabel`,
      rename: `${id}.rename`,
      editorLabel: `${id}.editorLabel`,
      create: `${id}.create`,
      untitled: `${id}.untitled`,
    },
  };
}
