import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { providePluginDnd } from '@hexly/plugin-dnd/web';
import { providePluginDrawSteel } from '@hexly/plugin-draw-steel/web';
import { providePluginContent } from '@hexly/plugin-content/web';
import { providePluginHexmap } from '@hexly/plugin-hexmap/web';
import { firstValueFrom } from 'rxjs';
import { EntityDetail } from '@hexly/domain';
import { DialogRef, DialogService } from '@hexly/web-ui';
import { CreateCommands } from './create-commands';
import {
  CreateEntityDialogComponent,
  CreateEntityDialogData,
  CreateEntityDialogResult,
} from './create-entity-dialog.component';
import { TypeRegistry } from './type-registry';

/** All this Command reads off the dialog's result is where to route (ADR-0073). */
const created = { id: 'e1', worldId: 'w1', name: 'The Reach' } as EntityDetail;

describe('CreateCommands', () => {
  let provider: CreateCommands;
  let open: ReturnType<typeof vi.fn>;
  let dialogRef: DialogRef<CreateEntityDialogData, CreateEntityDialogResult>;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dialogRef = new DialogRef<CreateEntityDialogData, CreateEntityDialogResult>({ type: 'core.type.note' });
    open = vi.fn().mockReturnValue(dialogRef);
    TestBed.configureTestingModule({
      imports: [provideTranslocoTesting()],
      providers: [
        providePluginContent(),
        providePluginHexmap(),
        providePluginDnd(),
        providePluginDrawSteel(),
        provideRouter([]),
        { provide: DialogService, useValue: { open } },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    provider = TestBed.inject(CreateCommands);
  });

  it('answers the > (Show Commands) prefix', () => {
    expect(provider.prefix).toBe('>');
  });

  it('offers a create Command per registered type — core first, then the bundled plugins', async () => {
    const commands = await firstValueFrom(provider.search(''));
    // Not one of these is enumerated in the app: each `providePluginX()` registers its type, and the
    // Command — id and label alike — falls out of `types.all()` (#192, #199). Enabling the Draw Steel
    // plugin surfaces its own Monster create affordance beside dnd's (#243).
    expect(commands.map((c) => c.id)).toEqual([
      'create-core.type.note',
      'create-core.type.hex-map',
      'create-dnd.type.monster',
      'create-draw-steel.type.monster',
    ]);
  });

  it('offers no create Command for a System-managed type (ADR-0068)', async () => {
    TestBed.inject(TypeRegistry).register({
      id: 'core.type.asset',
      icon: 'asset',
      views: [],
      graphColorToken: '--color-ink-muted',
      systemManaged: true,
    });

    const commands = await firstValueFrom(provider.search(''));
    expect(commands.map((c) => c.id)).not.toContain('create-core.type.asset');
  });

  it('opens the create dialog seeded with the Draw Steel Monster type when its Command runs', async () => {
    const commands = await firstValueFrom(provider.search(''));
    commands.find((c) => c.id === 'create-draw-steel.type.monster')?.run();
    expect(open).toHaveBeenCalledWith(CreateEntityDialogComponent, { type: 'draw-steel.type.monster' });
  });

  it('opens the create dialog seeded with the Note type when Create Note runs', async () => {
    const [createNote] = await firstValueFrom(provider.search(''));
    createNote.run();
    // The Command seeds the dialog with its type; the dialog lets the author add more (#189).
    expect(open).toHaveBeenCalledWith(CreateEntityDialogComponent, { type: 'core.type.note' });
  });

  it('opens the create dialog seeded with the Map type when Create Map runs', async () => {
    const [, createMap] = await firstValueFrom(provider.search(''));
    createMap.run();
    expect(open).toHaveBeenCalledWith(CreateEntityDialogComponent, { type: 'core.type.hex-map' });
  });

  it('navigates to the Entity the dialog closes with — the dialog only returns it (ADR-0073)', async () => {
    const [createNote] = await firstValueFrom(provider.search(''));
    createNote.run();

    dialogRef.close(created);

    expect(navigate).toHaveBeenCalledWith(['/w', 'w1', 'entities', 'e1']);
  });

  it('navigates nowhere when the dialog is cancelled', async () => {
    const [createNote] = await firstValueFrom(provider.search(''));
    createNote.run();

    dialogRef.close();

    expect(navigate).not.toHaveBeenCalled();
  });

  it('narrows to commands whose label matches the typed query, case-insensitively', async () => {
    // Matched on the *label* ("Create Map"), which is the plugin's copy now — so the palette finds a
    // plugin's Command by the words the plugin itself ships.
    const commands = await firstValueFrom(provider.search('MAP'));
    expect(commands.map((c) => c.id)).toEqual(['create-core.type.hex-map']);
  });
});
