import { provideTranslocoTesting } from '../../../../testing/transloco-testing';
import { TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { defineField } from '@hexly/domain';
import { EntityTypesEditorComponent } from './entity-types-editor.component';
import { TypeRegistry } from '../../../entity-types/type-registry';
import { TypeDefinition } from '@hexly/web-entity';
import { CORE_VIEW_RICH_CONTENT, providePluginContent } from '@hexly/plugin-content/web';

function definition(id: string, fieldRefs?: readonly string[]): TypeDefinition {
  return {
    id: id as TypeDefinition['id'],
    icon: 'label',
    views: [CORE_VIEW_RICH_CONTENT],
    fieldRefs,
    graphColorToken: '--color-ink-muted',
    labels: {
      name: `${id}.name`,
      eyebrow: `${id}.eyebrow`,
      titleLabel: `${id}.titleLabel`,
      rename: `${id}.rename`,
      editorLabel: `${id}.editorLabel`,
      create: `${id}.create`,
      untitled: `${id}.untitled`,
    },
  };
}

const lairField = defineField({
  id: 'test.field.lair',
  label: 'Lair',
  dataType: { kind: 'string' },
  required: true,
});

describe('EntityTypesEditor', () => {
  let ref: ComponentRef<EntityTypesEditorComponent>;
  let el: HTMLElement;
  let emittedTypes: string[][];
  let emittedMetadata: Record<string, unknown>[];

  function render(types: string[], metadata: Record<string, unknown> = {}, writable = true) {
    TestBed.configureTestingModule({
      imports: [EntityTypesEditorComponent, provideTranslocoTesting()],
      providers: [providePluginContent()],
    });
    const registry = TestBed.inject(TypeRegistry);
    registry.setWorldFields([lairField]);
    registry.register(definition('test.type.monster', ['test.field.lair']));
    const fixture = TestBed.createComponent(EntityTypesEditorComponent);
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
    render(['core.type.hex-map', 'core.type.note']);
    const chip = q('type-chip-core.type.hex-map');
    expect(chip.querySelector('[data-testid=type-primary]')).not.toBeNull();
    // The secondary chip carries no primary badge.
    expect(q('type-chip-core.type.note').querySelector('[data-testid=type-primary]')).toBeNull();
  });

  it('moves a type up one place with ↑, re-primarying it when it reaches the front', () => {
    render(['core.type.hex-map', 'core.type.note']);
    q('type-move-up-core.type.note').click();
    // A single step from index 1 lands it at index 0 — the new primary.
    expect(emittedTypes.at(-1)).toEqual(['core.type.note', 'core.type.hex-map']);
  });

  it('reorders adjacent types with move-down (↓)', () => {
    render(['core.type.note', 'core.type.hex-map']);
    q('type-move-down-core.type.note').click();
    expect(emittedTypes.at(-1)).toEqual(['core.type.hex-map', 'core.type.note']);
  });

  it('removes a type, but never the last one (typesSchema.min(1))', () => {
    const fixture = render(['core.type.note', 'core.type.hex-map']);
    q('type-remove-core.type.hex-map').click();
    expect(emittedTypes.at(-1)).toEqual(['core.type.note']);

    // With a single type the remove control is disabled — every Entity keeps a primary type.
    ref.setInput('types', ['core.type.note']);
    fixture.detectChanges();
    expect((q('type-remove-core.type.note') as HTMLButtonElement).disabled).toBe(true);
  });

  it('adds a type with no required Fields immediately (no prompt)', () => {
    render(['core.type.hex-map']);
    const add = q('type-add') as HTMLSelectElement;
    add.value = 'core.type.note';
    add.dispatchEvent(new Event('change'));
    expect(emittedTypes.at(-1)).toEqual(['core.type.hex-map', 'core.type.note']);
    expect(q('type-add-prompt')).toBeNull();
  });

  it('prompts for a newly-added type’s required Fields before it is added (#189)', () => {
    const fixture = render(['core.type.note']);

    // Adding a type with an unmet required Field opens the prompt instead of adding straight away.
    const add = q('type-add') as HTMLSelectElement;
    add.value = 'test.type.monster';
    add.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(q('type-add-prompt')).not.toBeNull();
    expect(emittedTypes).toEqual([]); // not added yet

    // Confirm is inert while the required Field is empty.
    expect((q('type-add-confirm') as HTMLElement).getAttribute('aria-disabled')).toBe('true');

    // Fill the required Field, then confirm: the EntityDocument rides metadataChange and the type is added.
    const input = q('pending-field-test.field.lair').querySelector('input') as HTMLInputElement;
    input.value = 'Sunken keep';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect((q('type-add-confirm') as HTMLElement).getAttribute('aria-disabled')).toBeNull();

    q('type-add-confirm').click();
    expect(emittedMetadata.at(-1)).toEqual({ 'test.field.lair': 'Sunken keep' });
    expect(emittedTypes.at(-1)).toEqual(['core.type.note', 'test.type.monster']);
  });

  it('skips the prompt when the required Field is already satisfied by existing EntityDocument (#189)', () => {
    // A re-added type whose values persist as free EntityDocument (CONTEXT.md → Field) needs no prompt.
    render(['core.type.note'], { 'test.field.lair': 'Sunken keep' });
    const add = q('type-add') as HTMLSelectElement;
    add.value = 'test.type.monster';
    add.dispatchEvent(new Event('change'));
    expect(q('type-add-prompt')).toBeNull();
    expect(emittedTypes.at(-1)).toEqual(['core.type.note', 'test.type.monster']);
  });

  it('shows no editing affordances for a read-only opener', () => {
    render(['core.type.note', 'core.type.hex-map'], {}, false);
    expect(q('type-remove-core.type.note')).toBeNull();
    expect(q('type-add')).toBeNull();
    // The ordered chips still render, so a viewer sees the type set.
    expect(q('type-chip-core.type.note')).not.toBeNull();
  });
});
