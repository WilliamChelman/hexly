import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { signal, WritableSignal } from '@angular/core';
import { of } from 'rxjs';
import { defineField, EntityDetail } from '@hexly/domain';
import { ActiveWorld, ClientConfigStore, EntitiesClient } from '@hexly/web-core';
import { MockEntitiesClient } from '@hexly/web-core/testing';
import { providePluginDnd } from '@hexly/plugin-dnd/web';
import { providePluginContent } from '@hexly/plugin-content/web';
import { providePluginHexmap } from '@hexly/plugin-hexmap/web';
import { PLUGIN_ID as CONTENT_PLUGIN_ID } from '@hexly/plugin-content';
import { PLUGIN_ID as HEXMAP_PLUGIN_ID } from '@hexly/plugin-hexmap';
import { TypeDefinition } from '@hexly/web-entity';
import { DialogService } from '@hexly/web-ui';
import { NewEntityButtonComponent } from './new-entity-button.component';
import { TypeRegistry } from './type-registry';
import { CreateEntityDialogComponent } from './create-entity-dialog.component';

/**
 * A {@link ClientConfigStore} whose default Type and enabled set the test drives (ADR-0052, Seam 4):
 * a `null` enabled set is "config not yet loaded" — every Plugin reads enabled, today's behaviour.
 */
function fakeClientConfig(
  defaultType: WritableSignal<string | undefined>,
  enabled: WritableSignal<ReadonlySet<string> | null>,
): ClientConfigStore {
  return {
    defaultType,
    enabledPlugins: enabled,
    isPluginEnabled: (id: string) => enabled() === null || enabled()!.has(id),
    init: async () => undefined,
  } as unknown as ClientConfigStore;
}

const created = (id: string, name: string, types: string[]) =>
  ({
    id,
    worldId: 'w1',
    name,
    types,
    tags: [],
    visibility: 'private',
    version: 1,
    seq: 1,
    createdAt: 1,
    updatedAt: 1,
    document: { content: { format: 'tiptap-v1', snapshot: {} } },
  }) as unknown as EntityDetail;

/** A minimal registered TypeDefinition referencing its Fields by id (ADR-0054) — the fixture for the dialog gate. */
function worldType(id: string, fieldRefs: string[]): TypeDefinition {
  return {
    id: id as TypeDefinition['id'],
    icon: 'label',
    views: [],
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

describe('NewEntityButton', () => {
  let entities: MockEntitiesClient;
  let navigate: ReturnType<typeof vi.spyOn>;
  let defaultType: WritableSignal<string | undefined>;
  let enabled: WritableSignal<ReadonlySet<string> | null>;
  let openDialog: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    entities = new MockEntitiesClient();
    openDialog = vi.fn();
    // Unset default + unloaded enabled set: the pre-config-fetch state, where the button resolves
    // to the first enabled Type (core.type.note) — today's "New Note" behaviour, unchanged (ADR-0052).
    defaultType = signal<string | undefined>(undefined);
    enabled = signal<ReadonlySet<string> | null>(null);
    await TestBed.configureTestingModule({
      imports: [NewEntityButtonComponent, provideTranslocoTesting()],
      // The D&D plugin is composed exactly as `app.config.ts` does, so `dnd.type.monster` reaches the
      // registry — and this component — without the app naming it (#192).
      providers: [
        provideRouter([]),
        { provide: EntitiesClient, useValue: entities },
        { provide: ClientConfigStore, useValue: fakeClientConfig(defaultType, enabled) },
        { provide: DialogService, useValue: { open: openDialog } },
        providePluginContent(),
        providePluginHexmap(),
        providePluginDnd(),
      ],
    }).compileComponents();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    TestBed.inject(ActiveWorld).set('w1');
  });

  // The type menu lives in a CDK overlay attached to the document body; tear it down so a
  // lingering menu never leaks into the next spec.
  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  function render(): ComponentFixture<NewEntityButtonComponent> {
    const fixture = TestBed.createComponent(NewEntityButtonComponent);
    fixture.detectChanges();
    return fixture;
  }

  /** Open the arrowhead's type menu; its items render into the document, not the fixture. */
  function openMenu(fixture: ComponentFixture<NewEntityButtonComponent>): void {
    (fixture.nativeElement.querySelector('[data-testid=new-entity-menu]') as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  const menuItem = (typeId: string) =>
    document.querySelector<HTMLButtonElement>(`[data-testid="new-entity-${typeId}"]`);

  const primaryButton = (fixture: ComponentFixture<NewEntityButtonComponent>) =>
    fixture.nativeElement.querySelector('[data-testid=new-default-entity]') as HTMLButtonElement | null;

  it('creates the first enabled Type by default — today’s Note — and opens it', () => {
    const fixture = render();
    entities.create.mockReturnValueOnce(of(created('new1', 'Untitled note', ['core.type.note'])));

    expect(primaryButton(fixture)?.textContent).toContain('Create Note');
    primaryButton(fixture)!.click();

    expect(entities.create).toHaveBeenCalledWith('Untitled note', ['core.type.note'], 'w1');
    expect(navigate).toHaveBeenCalledWith(['/w', 'w1', 'entities', 'new1']);
  });

  it('creates the configured default Type and labels the button after it', () => {
    // `entities.defaultType` names an enabled Type: the primary button mints *that* Type, and its
    // copy follows the Type's own create chrome — no hardcoded Note anywhere (ADR-0052, story 24/26).
    defaultType.set('core.type.hex-map');
    const fixture = render();
    entities.create.mockReturnValueOnce(of(created('m1', 'Untitled map', ['core.type.hex-map'])));

    expect(primaryButton(fixture)?.textContent).toContain('Create Map');
    primaryButton(fixture)!.click();

    expect(entities.create).toHaveBeenCalledWith('Untitled map', ['core.type.hex-map'], 'w1');
    expect(navigate).toHaveBeenCalledWith(['/w', 'w1', 'entities', 'm1']);
  });

  it('falls back to the first enabled Type when the configured default is unregistered', () => {
    // A typo or a Type from a Plugin this build never bundled reads as absent: the button degrades
    // to the first enabled Type rather than showing nothing (ADR-0052, story 27).
    defaultType.set('pathfinder.type.dragon');
    const fixture = render();
    entities.create.mockReturnValueOnce(of(created('new1', 'Untitled note', ['core.type.note'])));

    expect(primaryButton(fixture)?.textContent).toContain('Create Note');
    primaryButton(fixture)!.click();

    expect(entities.create).toHaveBeenCalledWith('Untitled note', ['core.type.note'], 'w1');
  });

  it('falls back to the first enabled Type when the configured default names a disabled Plugin', () => {
    // The default resolves against the *enabled* registry: a disabled Plugin's Type reads as absent,
    // so the button falls to the first still-enabled Type — the knob stays independent of enablement.
    defaultType.set('dnd.type.monster');
    enabled.set(new Set([CONTENT_PLUGIN_ID, HEXMAP_PLUGIN_ID])); // dnd off
    const fixture = render();
    entities.create.mockReturnValueOnce(of(created('new1', 'Untitled note', ['core.type.note'])));

    expect(primaryButton(fixture)?.textContent).toContain('Create Note');
    primaryButton(fixture)!.click();

    expect(entities.create).toHaveBeenCalledWith('Untitled note', ['core.type.note'], 'w1');
  });

  it('renders no primary create button when every Plugin is disabled — an empty registry', () => {
    // An all-Plugins-off Instance has no Type to mint: the primary button disappears rather than
    // creating a phantom Type or throwing (ADR-0052, story 5/27).
    enabled.set(new Set());
    const fixture = render();

    expect(primaryButton(fixture)).toBeNull();
  });

  it('lists every registered Type in the menu — core, plugin, and user-defined alike', () => {
    // A World's user-defined type joins the same registry at runtime (#191); it must reach the
    // menu on the same footing as a core or plugin one, with no `featured` list to be added to.
    TestBed.inject(TypeRegistry).register({
      id: 'world.type.deity',
      icon: 'label',
      labelText: 'Deity',
      views: [],
      graphColorToken: '--color-ink-muted',
    });
    const fixture = render();

    openMenu(fixture);

    // Scoped to the overlay: the menu's items, not the trigger that opened it.
    const items = Array.from(document.querySelectorAll('.cdk-overlay-container [data-testid^="new-entity-"]'), (el) =>
      el.getAttribute('data-testid'),
    );
    expect(items).toEqual([
      'new-entity-core.type.note',
      'new-entity-core.type.hex-map',
      'new-entity-dnd.type.monster',
      'new-entity-world.type.deity',
    ]);
    // Each item is labelled by the type's own name: translated copy for a code type, the
    // authored name verbatim for a user-defined one.
    expect(menuItem('core.type.hex-map')?.textContent).toContain('Map');
    expect(menuItem('world.type.deity')?.textContent).toContain('Deity');
  });

  it('never offers a System-managed Type — not in the menu, not as the primary default (ADR-0068)', () => {
    // The system alone mints an Asset (ADR-0068): offering it here only produces a doomed create (403).
    TestBed.inject(TypeRegistry).register({
      id: 'core.type.asset',
      icon: 'asset',
      views: [],
      graphColorToken: '--color-ink-muted',
      systemManaged: true,
    });
    // Even configured as the Instance default, it must not resolve as the primary action.
    defaultType.set('core.type.asset');
    const fixture = render();

    expect(primaryButton(fixture)?.textContent).toContain('Create Note');
    openMenu(fixture);
    expect(menuItem('core.type.asset')).toBeNull();
  });

  it('creates the Type a menu item names and opens it, with no per-type branch', () => {
    const fixture = render();
    entities.create.mockReturnValueOnce(of(created('m1', 'Untitled map', ['core.type.hex-map'])));

    openMenu(fixture);
    menuItem('core.type.hex-map')!.click();

    expect(entities.create).toHaveBeenCalledWith('Untitled map', ['core.type.hex-map'], 'w1');
    expect(navigate).toHaveBeenCalledWith(['/w', 'w1', 'entities', 'm1']);
  });

  it('opens the create dialog for a Type with a required Field, rather than minting an unsavable Entity', () => {
    // A World type referencing a required scalar Field: a blind create would land the author on an
    // Entity the write gate refuses to save (#187), so the dialog collects it first (#189). (`dnd.type.monster`
    // no longer has a required *scalar* Field — its stat block is structured, ADR-0055 — so it creates blind.)
    const registry = TestBed.inject(TypeRegistry);
    registry.setWorldFields([
      defineField({ id: 'world.field.rank', label: 'Rank', dataType: { kind: 'number' }, required: true }),
    ]);
    registry.register(worldType('world.type.knight', ['world.field.rank']));
    const fixture = render();

    openMenu(fixture);
    menuItem('world.type.knight')!.click();

    expect(entities.create).not.toHaveBeenCalled();
    expect(openDialog).toHaveBeenCalledWith(CreateEntityDialogComponent, { type: 'world.type.knight' });
  });

  it('creates a dnd.type.monster blind — its stat block is structured, so it has no required scalar Field (ADR-0055)', () => {
    const fixture = render();
    entities.create.mockReturnValueOnce(of(created('m1', 'Untitled monster', ['dnd.type.monster'])));

    openMenu(fixture);
    menuItem('dnd.type.monster')!.click();

    expect(entities.create).toHaveBeenCalledWith('Untitled monster', ['dnd.type.monster'], 'w1');
    expect(openDialog).not.toHaveBeenCalled();
  });

  it('names the type in French when French is the active language', () => {
    const fixture = render();
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    // The primary button's copy is the resolved Type's create chrome, so it re-resolves on a switch.
    expect(primaryButton(fixture)?.textContent).toContain('Créer une note');
    openMenu(fixture);
    expect(menuItem('core.type.hex-map')?.textContent).toContain('Carte');
  });
});
