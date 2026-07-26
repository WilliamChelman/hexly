import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { defineField, EntityDetail, WorldSummary } from '@hexly/domain';
import { emptyRichContent } from '@hexly/plugin-content';
import { ActiveWorld, EntitiesClient, WorldStore } from '@hexly/web-core';
import { MockEntitiesClient } from '@hexly/web-core/testing';
import { DialogRef } from '@hexly/web-ui';
import {
  CreateEntityDialogComponent,
  CreateEntityDialogData,
  CreateEntityDialogResult,
} from './create-entity-dialog.component';
import { TypeRegistry } from './type-registry';
import { TypeDefinition } from '@hexly/web-entity';
import { CORE_VIEW_RICH_CONTENT, providePluginContent } from '@hexly/plugin-content/web';
import { providePluginHexmap } from '@hexly/plugin-hexmap/web';

/** The required Field the monster type references by id (ADR-0054); set on the registry where it registers. */
const lairField = defineField({
  id: 'test.field.lair',
  label: 'Lair',
  dataType: { kind: 'string' },
  required: true,
});

/** A plugin-style type declaring one required Field — to exercise the create-time required-Fields form. */
const monster: TypeDefinition = {
  id: 'test.type.monster',
  icon: 'label',
  views: [CORE_VIEW_RICH_CONTENT],
  fieldRefs: ['test.field.lair'],
  graphColorToken: '--color-ink-muted',
  labels: {
    name: 'monster.name',
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
  let dialogRef: DialogRef<CreateEntityDialogData, CreateEntityDialogResult>;
  /** What the dialog closed with, in order — the seam its callers read (ADR-0073). */
  let closedWith: (CreateEntityDialogResult | undefined)[];

  // The dialog seeds itself from `DialogRef.data` at creation (no more open-state signal), so a
  // seeded type's registration must land via `setup` *before* the component is built.
  function render(
    worlds: WorldSummary[],
    activeWorldId: string | null,
    seedType = 'core.type.note',
    setup?: () => void,
    pinnedWorldId?: string,
  ) {
    entitiesClient = new MockEntitiesClient();
    dialogRef = new DialogRef<CreateEntityDialogData, CreateEntityDialogResult>({
      type: seedType,
      ...(pinnedWorldId ? { worldId: pinnedWorldId } : {}),
    });
    closedWith = [];
    dialogRef.closed.subscribe((entity) => closedWith.push(entity));
    vi.spyOn(dialogRef, 'close');
    TestBed.configureTestingModule({
      imports: [CreateEntityDialogComponent, provideTranslocoTesting()],
      // No `provideRouter`: the dialog returns its Entity and routes nowhere (ADR-0073), so a
      // reinstated Router injection fails the whole spec rather than passing a spy quietly.
      providers: [
        providePluginContent(),
        providePluginHexmap(),
        { provide: EntitiesClient, useValue: entitiesClient },
        { provide: WorldStore, useValue: { worlds: () => worlds } },
        { provide: DialogRef, useValue: dialogRef },
      ],
    });
    TestBed.inject(ActiveWorld).set(activeWorldId);
    setup?.();
    const fixture = TestBed.createComponent(CreateEntityDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  function q(fixture: ReturnType<typeof render>, testid: string) {
    return fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);
  }

  it('opens seeded, prefilled to the active World', () => {
    const fixture = render([world('w1', 'Aldermoor'), world('w2', 'Whisperwood')], 'w2');

    expect(fixture.nativeElement.querySelector('dialog')?.open).toBe(true);
    const select: HTMLSelectElement = q(fixture, 'create-entity-world');
    expect(select.value).toBe('w2');
  });

  it("falls back to the first loaded World when there's no active World", () => {
    const fixture = render([world('w1', 'Aldermoor'), world('w2', 'Whisperwood')], null, 'core.type.hex-map');

    const select: HTMLSelectElement = q(fixture, 'create-entity-world');
    expect(select.value).toBe('w1');
  });

  it('locks the World select to a caller-pinned World, over the active one (ADR-0073)', () => {
    // A caller creating from inside an Entity pins that Entity's World: minting elsewhere would
    // author a cross-World link as a side effect.
    const fixture = render([world('w1', 'Aldermoor'), world('w2', 'Whisperwood')], 'w2', undefined, undefined, 'w1');

    const select: HTMLSelectElement = q(fixture, 'create-entity-world');
    expect(select.value).toBe('w1');
    expect(select.disabled).toBe(true);
  });

  it('creates the Entity in the selected World and closes with it as the result', () => {
    const fixture = render([world('w1', 'Aldermoor')], 'w1');
    const created: EntityDetail = {
      id: 'e1',
      name: 'The Reach',
      worldId: 'w1',
      types: ['core.type.note'],
      tags: [],
      visibility: 'private',
      version: 1,
      seq: 1,
      createdAt: 1,
      updatedAt: 1,
      document: { content: emptyRichContent() },
    };
    entitiesClient.create.mockReturnValue(of(created));

    const nameInput: HTMLInputElement = q(fixture, 'create-entity-name');
    nameInput.value = 'The Reach';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (q(fixture, 'create-entity-submit') as HTMLButtonElement).click();
    fixture.detectChanges();

    // The seeded type rides as a one-element ordered set; no EntityDocument (core types declare no Fields).
    expect(entitiesClient.create).toHaveBeenCalledWith('The Reach', ['core.type.note'], 'w1', undefined);
    // The created Entity is the result; where to go next is the caller's call (ADR-0073).
    expect(dialogRef.close).toHaveBeenCalledWith(created);
    expect(closedWith).toEqual([created]);
  });

  it('lets the author add a second type before creating, sending the ordered set (#189)', () => {
    const fixture = render([world('w1', 'Aldermoor')], 'w1');
    entitiesClient.create.mockReturnValue(
      of({
        id: 'e1',
        name: 'Untitled note',
        worldId: 'w1',
        types: ['core.type.note', 'core.type.hex-map'],
        tags: [],
        visibility: 'private',
        version: 1,
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        document: { content: emptyRichContent() },
      } as EntityDetail),
    );

    // Add the hexmap type through the embedded editor's picker.
    const add: HTMLSelectElement = q(fixture, 'type-add');
    add.value = 'core.type.hex-map';
    add.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    (q(fixture, 'create-entity-submit') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(entitiesClient.create).toHaveBeenCalledWith(
      'Untitled note',
      ['core.type.note', 'core.type.hex-map'],
      'w1',
      undefined,
    );
  });

  it('collects a seeded required-Field type’s Fields without ever gating Create (ADR-0074)', () => {
    // Seeded with the required-Field type (as a "Create Monster" command would), registered before build.
    const fixture = render([world('w1', 'Aldermoor')], 'w1', 'test.type.monster', () => {
      const registry = TestBed.inject(TypeRegistry);
      registry.setWorldFields([lairField]);
      registry.register(monster);
    });
    entitiesClient.create.mockReturnValue(
      of({
        id: 'e1',
        name: 'Balthazar',
        worldId: 'w1',
        types: ['test.type.monster'],
        tags: [],
        visibility: 'private',
        version: 1,
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        document: { 'core.field.content': emptyRichContent(), 'test.field.lair': 'Sunken keep' },
      } as EntityDetail),
    );

    const nameInput: HTMLInputElement = q(fixture, 'create-entity-name');
    nameInput.value = 'Balthazar';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // The seeded type's required Field is prompted for, not demanded: Create stays live while it is empty.
    const submit = q(fixture, 'create-entity-submit') as HTMLButtonElement;
    expect(submit.getAttribute('aria-disabled')).toBeNull();

    // Fill the required Field, rendered inline in the dialog.
    const lair = (q(fixture, 'create-field-test.field.lair') as HTMLElement).querySelector('input') as HTMLInputElement;
    lair.value = 'Sunken keep';
    lair.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    submit.click();
    fixture.detectChanges();
    // The collected value rides the create as initial EntityDocument.
    expect(entitiesClient.create).toHaveBeenCalledWith('Balthazar', ['test.type.monster'], 'w1', {
      'test.field.lair': 'Sunken keep',
    });
  });

  it('creates with a required Field left empty — the Entity is Incomplete, not refused (ADR-0074)', () => {
    const fixture = render([world('w1', 'Aldermoor')], 'w1', 'test.type.monster', () => {
      const registry = TestBed.inject(TypeRegistry);
      registry.setWorldFields([lairField]);
      registry.register(monster);
    });
    entitiesClient.create.mockReturnValue(
      of({
        id: 'e1',
        name: 'Balthazar',
        worldId: 'w1',
        types: ['test.type.monster'],
        tags: [],
        visibility: 'private',
        version: 1,
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        document: { 'core.field.content': emptyRichContent() },
      } as EntityDetail),
    );

    const nameInput: HTMLInputElement = q(fixture, 'create-entity-name');
    nameInput.value = 'Balthazar';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // The Field is still prompted for — the author knows what a monster is expected to carry…
    expect(q(fixture, 'create-field-test.field.lair')).not.toBeNull();
    // …and the control is not flagged invalid: absence is a hint, only a present ill-typed value is an error.
    expect((q(fixture, 'create-field-test.field.lair') as HTMLElement).querySelector('[aria-invalid]')).toBeNull();

    (q(fixture, 'create-entity-submit') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(entitiesClient.create).toHaveBeenCalledWith('Balthazar', ['test.type.monster'], 'w1', undefined);
  });

  it('closes with no result and creates nothing on cancel', () => {
    const fixture = render([world('w1', 'Aldermoor')], 'w1');

    (q(fixture, 'create-entity-cancel') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(entitiesClient.create).not.toHaveBeenCalled();
    expect(dialogRef.close).toHaveBeenCalledWith();
    expect(closedWith).toEqual([undefined]);
  });
});
