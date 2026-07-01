import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
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

  it('offers Create Note and Create Map regardless of query', async () => {
    const commands = await firstValueFrom(provider.search(''));
    expect(commands.map((c) => c.id)).toEqual(['create-note', 'create-map']);
  });

  it('opens the create dialog for a Note when Create Note runs', async () => {
    const [createNote] = await firstValueFrom(provider.search(''));
    createNote.run();
    expect(state.type()).toBe('note');
  });

  it('opens the create dialog for a Map when Create Map runs', async () => {
    const [, createMap] = await firstValueFrom(provider.search(''));
    createMap.run();
    expect(state.type()).toBe('hexmap');
  });

  it('narrows to commands whose label matches the typed query, case-insensitively', async () => {
    const commands = await firstValueFrom(provider.search('MAP'));
    expect(commands.map((c) => c.id)).toEqual(['create-map']);
  });
});
