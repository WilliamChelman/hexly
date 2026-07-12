import { provideTranslocoTesting } from '../../../../testing/transloco-testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { EntityDetail, EntityVerb, FieldSchema } from '@hexly/domain';
import { ENTITY_SESSION } from '@hexly/web-entity';
import { EntitySession } from '../services/entity-session';
import { TypeRegistry } from '../../../entity-types/type-registry';
import { GenericFieldView } from './generic-field-view';

const beastFields: FieldSchema[] = [
  {
    key: 'name',
    label: 'Name',
    dataType: { kind: 'string' },
    required: true,
    facetable: false,
  },
  {
    key: 'size',
    label: 'Size',
    dataType: { kind: 'enum', options: ['small', 'large'] },
    required: false,
    facetable: false,
  },
  {
    key: 'cr',
    label: 'CR',
    dataType: { kind: 'number' },
    required: false,
    facetable: false,
  },
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

  it('renders an Entity-Link Field by its last-known name, with a picker toggle when editable (#190)', () => {
    const lair: FieldSchema = {
      key: 'lair',
      label: 'Lair',
      dataType: { kind: 'entityLink', targetTypes: ['world.place'] },
      required: false,
      facetable: false,
    };
    registry.register(definitionWithFields('test.monster', [lair]));
    const value = { lair: { entityId: 'whisperwood', label: 'The Whisperwood' } };

    // Editable: the link shows its last-known name and offers a "change entity" toggle + a clear.
    const editable = render(detail(['test.monster'], value, ['edit']));
    expect(editable.el.querySelector('[data-testid=entity-link-value]')?.textContent).toContain('The Whisperwood');
    expect(editable.el.querySelector('[data-testid=entity-link-open]')).not.toBeNull();
    expect(editable.el.querySelector('[data-testid=entity-link-clear]')).not.toBeNull();
    // The picker is closed until the toggle is clicked, so no premature search fires.
    expect(editable.el.querySelector('[data-testid=entity-link-picker-menu]')).toBeNull();
  });

  it('renders an Entity-Link Field inert (name only, no controls) for a read-only opener (#190)', () => {
    const lair: FieldSchema = {
      key: 'lair',
      label: 'Lair',
      dataType: { kind: 'entityLink' },
      required: false,
      facetable: false,
    };
    registry.register(definitionWithFields('test.monster', [lair]));
    const { el } = render(
      detail(['test.monster'], { lair: { entityId: 'whisperwood', label: 'The Whisperwood' } }, ['read']),
    );

    expect(el.querySelector('[data-testid=entity-link-value]')?.textContent).toContain('The Whisperwood');
    expect(el.querySelector('[data-testid=entity-link-open]')).toBeNull();
    expect(el.querySelector('[data-testid=entity-link-clear]')).toBeNull();
  });

  it('falls back to an inert chip + plain Metadata for a type with no registered view', () => {
    // No definition registered for `pathfinder.monster` — the graceful-absence path an Entity takes
    // when the plugin that typed it isn't compiled into *this* instance (#192).
    const { el } = render(detail(['pathfinder.monster'], { lore: 'ancient', power: 9 }, ['edit']));

    const chip = el.querySelector('[data-testid=type-chip]');
    expect(chip?.textContent).toContain('pathfinder.monster');
    // Its values fall through to the plain-Metadata display — nothing hidden, nothing editable.
    const plain = el.querySelector('[data-testid=field-plain-metadata]');
    expect(plain?.textContent).toContain('lore');
    expect(plain?.textContent).toContain('ancient');
    expect(el.querySelector('[data-testid=field-lore]')).toBeNull();
    expect(el.querySelector('input')).toBeNull();
  });

  it('shows a Structured Field neither as a control nor as plain Metadata (ADR-0050)', () => {
    // A Structured Field's value is a document with its own View — an Entity that is both a
    // user-defined type and a Hex Map edits its grid on the map, never as a row here. And being
    // *declared*, it does not fall through to the plain-Metadata display either: it would dump a
    // wall of JSON on the reader.
    const grid: FieldSchema = {
      key: 'grid',
      label: 'Grid',
      dataType: { kind: 'core.hex-grid' },
      required: false,
      facetable: false,
    };
    registry.register(definitionWithFields('world.realm', [...beastFields, grid]));

    const { el } = render(
      detail(['world.realm'], { name: 'Aldermoor', grid: { hexes: {}, regions: [], labels: [] } }, ['edit']),
    );

    // The type's ordinary Fields still render.
    expect((el.querySelector('[data-testid=field-name] input') as HTMLInputElement).value).toBe('Aldermoor');
    expect(el.querySelector('[data-testid=field-grid]')).toBeNull();
    expect(el.querySelector('[data-testid=field-plain-metadata]')).toBeNull();
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
