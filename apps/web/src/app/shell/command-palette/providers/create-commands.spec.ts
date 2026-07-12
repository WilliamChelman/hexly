import { provideTranslocoTesting } from '../../../../testing/transloco-testing';
import { TestBed } from '@angular/core/testing';
import { providePluginDnd } from '@hexly/plugin-dnd/web';
import { providePluginHexmap } from '@hexly/plugin-hexmap/web';
import { firstValueFrom } from 'rxjs';
import { CreateEntityDialogState } from '../create-entity-dialog.state';
import { CreateCommands } from './create-commands';

describe('CreateCommands', () => {
  let provider: CreateCommands;
  let state: CreateEntityDialogState;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [provideTranslocoTesting()],
      providers: [providePluginHexmap(), providePluginDnd()],
    });
    provider = TestBed.inject(CreateCommands);
    state = TestBed.inject(CreateEntityDialogState);
  });

  it('answers the > (Show Commands) prefix', () => {
    expect(provider.prefix).toBe('>');
  });

  it('offers a create Command per registered type — core first, then the bundled plugins', async () => {
    const commands = await firstValueFrom(provider.search(''));
    // Not one of these is enumerated in the app: each `providePluginX()` registers its type, and the
    // Command — id and label alike — falls out of `types.all()` (#192, #199).
    expect(commands.map((c) => c.id)).toEqual(['create-core.note', 'create-core.hexmap', 'create-dnd.monster']);
  });

  it('opens the create dialog seeded with the Note type when Create Note runs', async () => {
    const [createNote] = await firstValueFrom(provider.search(''));
    createNote.run();
    // The Command seeds a one-element ordered set; the dialog lets the author add more (#189).
    expect(state.types()).toEqual(['core.note']);
  });

  it('opens the create dialog seeded with the Map type when Create Map runs', async () => {
    const [, createMap] = await firstValueFrom(provider.search(''));
    createMap.run();
    expect(state.types()).toEqual(['core.hexmap']);
  });

  it('narrows to commands whose label matches the typed query, case-insensitively', async () => {
    // Matched on the *label* ("Create Map"), which is the plugin's copy now — so the palette finds a
    // plugin's Command by the words the plugin itself ships.
    const commands = await firstValueFrom(provider.search('MAP'));
    expect(commands.map((c) => c.id)).toEqual(['create-core.hexmap']);
  });
});
