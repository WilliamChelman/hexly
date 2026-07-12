import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { CreateEntityDialogState } from '../create-entity-dialog.state';
import { CreateCommands } from './create-commands';

describe('CreateCommands', () => {
  let provider: CreateCommands;
  let state: CreateEntityDialogState;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [provideTranslocoTesting()] });
    provider = TestBed.inject(CreateCommands);
    state = TestBed.inject(CreateEntityDialogState);
  });

  it('answers the > (Show Commands) prefix', () => {
    expect(provider.prefix).toBe('>');
  });

  it('offers a create Command per registered type — core first, then the bundled plugins', async () => {
    const commands = await firstValueFrom(provider.search(''));
    // `create-dnd.monster` is enumerated nowhere: the bundled plugin registers its type and the
    // Command falls out of `types.all()` (#192).
    expect(commands.map((c) => c.id)).toEqual(['create-note', 'create-map', 'create-dnd.monster']);
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
    const commands = await firstValueFrom(provider.search('MAP'));
    expect(commands.map((c) => c.id)).toEqual(['create-map']);
  });
});
