import { provideTranslocoTesting } from '../../../../testing/transloco-testing';
import { TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { FieldSchema } from '@hexly/domain';
import { EntityTypesEditor } from './entity-types-editor';
import { TypeRegistry } from '../../../entity-types/type-registry';
import { CORE_VIEW_CONTENT, TypeDefinition } from '@hexly/web-entity';

function definition(id: string, fields?: readonly FieldSchema[]): TypeDefinition {
  return {
    id: id as TypeDefinition['id'],
    icon: 'label',
    views: [CORE_VIEW_CONTENT],
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

const lairField: FieldSchema = {
  key: 'lair',
  label: 'Lair',
  dataType: { kind: 'string' },
  required: true,
  facetable: false,
};

describe('EntityTypesEditor', () => {
  let ref: ComponentRef<EntityTypesEditor>;
  let el: HTMLElement;
  let emittedTypes: string[][];
  let emittedMetadata: Record<string, unknown>[];

  function render(types: string[], metadata: Record<string, unknown> = {}, writable = true) {
    TestBed.configureTestingModule({ imports: [EntityTypesEditor, provideTranslocoTesting()] });
    TestBed.inject(TypeRegistry).register(definition('test.monster', [lairField]));
    const fixture = TestBed.createComponent(EntityTypesEditor);
    ref = fixture.componentRef;
    ref.setInput('types', types);
    ref.setInput('metadata', metadata);
    ref.setInput('writable', writable);
    emittedTypes = [];
    emittedMetadata = [];
    fixture.componentInstance.typesChange.subscribe((t) => emittedTypes.push(t as string[]));
    fixture.componentInstance.metadataChange.subscribe((m) => emittedMetadata.push(m));
    fixture.detectChanges();
    el = fixture.nativeElement;
    return fixture;
  }

  const q = (testid: string) => el.querySelector(`[data-testid="${testid}"]`) as HTMLElement;

  it('badges the first type as primary', () => {
    render(['core.hexmap', 'core.note']);
    const chip = q('type-chip-core.hexmap');
    expect(chip.querySelector('[data-testid=type-primary]')).not.toBeNull();
    // The secondary chip carries no primary badge.
    expect(q('type-chip-core.note').querySelector('[data-testid=type-primary]')).toBeNull();
  });

  it('moves a type up one place with ↑, re-primarying it when it reaches the front', () => {
    render(['core.hexmap', 'core.note']);
    q('type-move-up-core.note').click();
    // A single step from index 1 lands it at index 0 — the new primary.
    expect(emittedTypes.at(-1)).toEqual(['core.note', 'core.hexmap']);
  });

  it('reorders adjacent types with move-down (↓)', () => {
    render(['core.note', 'core.hexmap']);
    q('type-move-down-core.note').click();
    expect(emittedTypes.at(-1)).toEqual(['core.hexmap', 'core.note']);
  });

  it('removes a type, but never the last one (typesSchema.min(1))', () => {
    const fixture = render(['core.note', 'core.hexmap']);
    q('type-remove-core.hexmap').click();
    expect(emittedTypes.at(-1)).toEqual(['core.note']);

    // With a single type the remove control is disabled — every Entity keeps a primary type.
    ref.setInput('types', ['core.note']);
    fixture.detectChanges();
    expect((q('type-remove-core.note') as HTMLButtonElement).disabled).toBe(true);
  });

  it('adds a type with no required Fields immediately (no prompt)', () => {
    render(['core.hexmap']);
    const add = q('type-add') as HTMLSelectElement;
    add.value = 'core.note';
    add.dispatchEvent(new Event('change'));
    expect(emittedTypes.at(-1)).toEqual(['core.hexmap', 'core.note']);
    expect(q('type-add-prompt')).toBeNull();
  });

  it('prompts for a newly-added type’s required Fields before it is added (#189)', () => {
    const fixture = render(['core.note']);

    // Adding a type with an unmet required Field opens the prompt instead of adding straight away.
    const add = q('type-add') as HTMLSelectElement;
    add.value = 'test.monster';
    add.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(q('type-add-prompt')).not.toBeNull();
    expect(emittedTypes).toEqual([]); // not added yet

    // Confirm is inert while the required Field is empty.
    expect((q('type-add-confirm') as HTMLElement).getAttribute('aria-disabled')).toBe('true');

    // Fill the required Field, then confirm: the EntityDocument rides metadataChange and the type is added.
    const input = q('pending-field-lair').querySelector('input') as HTMLInputElement;
    input.value = 'Sunken keep';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect((q('type-add-confirm') as HTMLElement).getAttribute('aria-disabled')).toBeNull();

    q('type-add-confirm').click();
    expect(emittedMetadata.at(-1)).toEqual({ lair: 'Sunken keep' });
    expect(emittedTypes.at(-1)).toEqual(['core.note', 'test.monster']);
  });

  it('skips the prompt when the required Field is already satisfied by existing EntityDocument (#189)', () => {
    // A re-added type whose values persist as free EntityDocument (CONTEXT.md → Field) needs no prompt.
    render(['core.note'], { lair: 'Sunken keep' });
    const add = q('type-add') as HTMLSelectElement;
    add.value = 'test.monster';
    add.dispatchEvent(new Event('change'));
    expect(q('type-add-prompt')).toBeNull();
    expect(emittedTypes.at(-1)).toEqual(['core.note', 'test.monster']);
  });

  it('shows no editing affordances for a read-only opener', () => {
    render(['core.note', 'core.hexmap'], {}, false);
    expect(q('type-remove-core.note')).toBeNull();
    expect(q('type-add')).toBeNull();
    // The ordered chips still render, so a viewer sees the type set.
    expect(q('type-chip-core.note')).not.toBeNull();
  });
});
