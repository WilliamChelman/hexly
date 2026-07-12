import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { EntityDetail } from '@hexly/domain';
import { ActiveWorld, EntitiesClient } from '@hexly/web-core';
import { MockEntitiesClient } from '@hexly/web-core/testing';
import { providePluginDnd } from '@hexly/plugin-dnd/web';
import { providePluginHexmap } from '@hexly/plugin-hexmap/web';
import { CORE_VIEW_FIELDS } from '@hexly/web-entity';
import { NewEntityButton } from './new-entity-button';
import { TypeRegistry } from './type-registry';
import { CreateEntityDialogState } from '../shell/command-palette/create-entity-dialog.state';

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

describe('NewEntityButton', () => {
  let entities: MockEntitiesClient;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    entities = new MockEntitiesClient();
    await TestBed.configureTestingModule({
      imports: [NewEntityButton, provideTranslocoTesting()],
      // The D&D plugin is composed exactly as `app.config.ts` does, so `dnd.monster` reaches the
      // registry — and this component — without the app naming it (#192).
      providers: [
        provideRouter([]),
        { provide: EntitiesClient, useValue: entities },
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

  function render(): ComponentFixture<NewEntityButton> {
    const fixture = TestBed.createComponent(NewEntityButton);
    fixture.detectChanges();
    return fixture;
  }

  /** Open the arrowhead's type menu; its items render into the document, not the fixture. */
  function openMenu(fixture: ComponentFixture<NewEntityButton>): void {
    (fixture.nativeElement.querySelector('[data-testid=new-entity-menu]') as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  const menuItem = (typeId: string) =>
    document.querySelector<HTMLButtonElement>(`[data-testid="new-entity-${typeId}"]`);

  it('creates a Note from the primary action and opens it', () => {
    const fixture = render();
    entities.create.mockReturnValueOnce(of(created('new1', 'Untitled note', ['core.note'])));

    (fixture.nativeElement.querySelector('[data-testid=new-note]') as HTMLButtonElement).click();

    expect(entities.create).toHaveBeenCalledWith('Untitled note', ['core.note'], 'w1');
    expect(navigate).toHaveBeenCalledWith(['/w', 'w1', 'entities', 'new1']);
  });

  it('lists every registered Type in the menu — core, plugin, and user-defined alike', () => {
    // A World's user-defined type joins the same registry at runtime (#191); it must reach the
    // menu on the same footing as a core or plugin one, with no `featured` list to be added to.
    TestBed.inject(TypeRegistry).register({
      id: 'world.deity',
      icon: 'label',
      labelText: 'Deity',
      views: [CORE_VIEW_FIELDS],
      graphColorToken: '--color-ink-muted',
    });
    const fixture = render();

    openMenu(fixture);

    // Scoped to the overlay: the menu's items, not the trigger that opened it.
    const items = Array.from(document.querySelectorAll('.cdk-overlay-container [data-testid^="new-entity-"]'), (el) =>
      el.getAttribute('data-testid'),
    );
    expect(items).toEqual([
      'new-entity-core.note',
      'new-entity-core.hexmap',
      'new-entity-dnd.monster',
      'new-entity-world.deity',
    ]);
    // Each item is labelled by the type's own name: translated copy for a code type, the
    // authored name verbatim for a user-defined one.
    expect(menuItem('core.hexmap')?.textContent).toContain('Map');
    expect(menuItem('world.deity')?.textContent).toContain('Deity');
  });

  it('creates the Type a menu item names and opens it, with no per-type branch', () => {
    const fixture = render();
    entities.create.mockReturnValueOnce(of(created('m1', 'Untitled map', ['core.hexmap'])));

    openMenu(fixture);
    menuItem('core.hexmap')!.click();

    expect(entities.create).toHaveBeenCalledWith('Untitled map', ['core.hexmap'], 'w1');
    expect(navigate).toHaveBeenCalledWith(['/w', 'w1', 'entities', 'm1']);
  });

  it('opens the create dialog for a Type with a required Field, rather than minting an unsavable Entity', () => {
    // `dnd.monster` requires `challenge_rating` (#192); a blind create would land the author on an
    // Entity the write gate refuses to save (#187), so the dialog collects it first (#189).
    const fixture = render();

    openMenu(fixture);
    menuItem('dnd.monster')!.click();

    expect(entities.create).not.toHaveBeenCalled();
    expect(TestBed.inject(CreateEntityDialogState).types()).toEqual(['dnd.monster']);
  });

  it('names the type in French when French is the active language', () => {
    const fixture = render();
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    expect((fixture.nativeElement.querySelector('[data-testid=new-note]') as HTMLElement).textContent).toContain(
      'Nouvelle note',
    );
    openMenu(fixture);
    expect(menuItem('core.hexmap')?.textContent).toContain('Carte');
  });
});
