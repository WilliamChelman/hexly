import { provideTranslocoTesting } from '../../../testing/transloco-testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { defineField, EntityDetail, WorldSummary } from '@hexly/domain';
import { emptyContent } from '@hexly/plugin-content';
import { ActiveWorld, EntitiesClient, WorldStore } from '@hexly/web-core';
import { MockEntitiesClient } from '@hexly/web-core/testing';
import { CreateEntityDialogState } from './create-entity-dialog.state';
import { CreateEntityDialogComponent } from './create-entity-dialog.component';
import { TypeRegistry } from '../../entity-types/type-registry';
import { TypeDefinition } from '@hexly/web-entity';
import { CORE_VIEW_CONTENT, providePluginContent } from '@hexly/plugin-content/web';
import { providePluginHexmap } from '@hexly/plugin-hexmap/web';

/** The required Field the monster type references by id (ADR-0054); set on the registry where it registers. */
const lairField = defineField({
  id: 'test.lair',
  label: 'Lair',
  dataType: { kind: 'string' },
  required: true,
});

/** A plugin-style type declaring one required Field — to exercise the create-time required-Fields form. */
const monster: TypeDefinition = {
  id: 'test.monster',
  icon: 'label',
  views: [CORE_VIEW_CONTENT],
  fieldRefs: ['test.lair'],
  graphColorToken: '--color-ink-muted',
  labels: {
    eyebrow: 'monster.eyebrow',
    titleLabel: 'monster.titleLabel',
    rename: 'monster.rename',
    editorLabel: 'monster.editorLabel',
    create: 'monster.create',
    untitled: 'monster.untitled',
  },
};

function world(id: string, name: string): WorldSummary {
  return {
    id,
    name,
    owners: ['u1'],
    rights: ['read', 'manage'],
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('CreateEntityDialog', () => {
  let entitiesClient: MockEntitiesClient;
  let navigate: ReturnType<typeof vi.spyOn>;
  let state: CreateEntityDialogState;

  function render(worlds: WorldSummary[], activeWorldId: string | null) {
    entitiesClient = new MockEntitiesClient();
    TestBed.configureTestingModule({
      imports: [CreateEntityDialogComponent, provideTranslocoTesting()],
      providers: [
        providePluginContent(),
        providePluginHexmap(),
        provideRouter([]),
        { provide: EntitiesClient, useValue: entitiesClient },
        { provide: WorldStore, useValue: { worlds: () => worlds } },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    TestBed.inject(ActiveWorld).set(activeWorldId);
    state = TestBed.inject(CreateEntityDialogState);
    const fixture = TestBed.createComponent(CreateEntityDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  function q(fixture: ReturnType<typeof render>, testid: string) {
    return fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);
  }

  it('stays closed until the dialog state names a type to create', () => {
    const fixture = render([world('w1', 'Aldermoor')], 'w1');
    expect(fixture.nativeElement.querySelector('dialog')?.open).toBeFalsy();
  });

  it('opens prefilled to the active World when Create Note runs', () => {
    const fixture = render([world('w1', 'Aldermoor'), world('w2', 'Whisperwood')], 'w2');

    state.open('core.note');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('dialog')?.open).toBe(true);
    const select: HTMLSelectElement = q(fixture, 'create-entity-world');
    expect(select.value).toBe('w2');
  });

  it("falls back to the first loaded World when there's no active World", () => {
    const fixture = render([world('w1', 'Aldermoor'), world('w2', 'Whisperwood')], null);

    state.open('core.hexmap');
    fixture.detectChanges();

    const select: HTMLSelectElement = q(fixture, 'create-entity-world');
    expect(select.value).toBe('w1');
  });

  it('creates the Entity in the selected World and navigates to it', () => {
    const fixture = render([world('w1', 'Aldermoor')], 'w1');
    const created: EntityDetail = {
      id: 'e1',
      name: 'The Reach',
      worldId: 'w1',
      types: ['core.note'],
      tags: [],
      visibility: 'private',
      version: 1,
      seq: 1,
      createdAt: 1,
      updatedAt: 1,
      document: { content: emptyContent() },
    };
    entitiesClient.create.mockReturnValue(of(created));

    state.open('core.note');
    fixture.detectChanges();

    const nameInput: HTMLInputElement = q(fixture, 'create-entity-name');
    nameInput.value = 'The Reach';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (q(fixture, 'create-entity-submit') as HTMLButtonElement).click();
    fixture.detectChanges();

    // The seeded type rides as a one-element ordered set; no EntityDocument (core types declare no Fields).
    expect(entitiesClient.create).toHaveBeenCalledWith('The Reach', ['core.note'], 'w1', undefined);
    expect(navigate).toHaveBeenCalledWith(['/w', 'w1', 'entities', 'e1']);
    expect(fixture.nativeElement.querySelector('dialog')?.open).toBeFalsy();
  });

  it('lets the author add a second type before creating, sending the ordered set (#189)', () => {
    const fixture = render([world('w1', 'Aldermoor')], 'w1');
    entitiesClient.create.mockReturnValue(
      of({
        id: 'e1',
        name: 'Untitled note',
        worldId: 'w1',
        types: ['core.note', 'core.hexmap'],
        tags: [],
        visibility: 'private',
        version: 1,
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        document: { content: emptyContent() },
      } as EntityDetail),
    );

    state.open('core.note');
    fixture.detectChanges();

    // Add the hexmap type through the embedded editor's picker.
    const add: HTMLSelectElement = q(fixture, 'type-add');
    add.value = 'core.hexmap';
    add.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    (q(fixture, 'create-entity-submit') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(entitiesClient.create).toHaveBeenCalledWith('Untitled note', ['core.note', 'core.hexmap'], 'w1', undefined);
  });

  it('collects a seeded required-Field type’s Fields, gating Create until supplied (#189)', () => {
    const fixture = render([world('w1', 'Aldermoor')], 'w1');
    const registry = TestBed.inject(TypeRegistry);
    registry.setWorldFields([lairField]);
    registry.register(monster);
    entitiesClient.create.mockReturnValue(
      of({
        id: 'e1',
        name: 'Balthazar',
        worldId: 'w1',
        types: ['test.monster'],
        tags: [],
        visibility: 'private',
        version: 1,
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        document: { 'core.content': emptyContent(), 'test.lair': 'Sunken keep' },
      } as EntityDetail),
    );

    // Open seeded with the required-Field type (as a "Create Monster" command would).
    state.open('test.monster');
    fixture.detectChanges();

    const nameInput: HTMLInputElement = q(fixture, 'create-entity-name');
    nameInput.value = 'Balthazar';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // Create is inert until the seeded type's required Field is filled — no dead-end (#189).
    const submit = q(fixture, 'create-entity-submit') as HTMLButtonElement;
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    submit.click();
    fixture.detectChanges();
    expect(entitiesClient.create).not.toHaveBeenCalled();

    // Fill the required Field, rendered inline in the dialog.
    const lair = (q(fixture, 'create-field-test.lair') as HTMLElement).querySelector('input') as HTMLInputElement;
    lair.value = 'Sunken keep';
    lair.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(submit.getAttribute('aria-disabled')).toBeNull();

    submit.click();
    fixture.detectChanges();
    // The collected value rides the create as initial EntityDocument.
    expect(entitiesClient.create).toHaveBeenCalledWith('Balthazar', ['test.monster'], 'w1', {
      'test.lair': 'Sunken keep',
    });
  });

  it('closes without creating anything on cancel', () => {
    const fixture = render([world('w1', 'Aldermoor')], 'w1');
    state.open('core.note');
    fixture.detectChanges();

    (q(fixture, 'create-entity-cancel') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(entitiesClient.create).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('dialog')?.open).toBeFalsy();
  });
});
