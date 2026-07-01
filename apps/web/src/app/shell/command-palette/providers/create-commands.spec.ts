import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { CreateEntityLauncher } from '../create-entity-launcher';
import { CreateCommands } from './create-commands';

describe('CreateCommands', () => {
  let launcher: CreateEntityLauncher;

  function setup() {
    TestBed.configureTestingModule({
      imports: [provideTranslocoTesting()],
    });
    launcher = TestBed.inject(CreateEntityLauncher);
    return TestBed.inject(CreateCommands);
  }

  it('answers the Show Commands (>) prefix', () => {
    expect(setup().prefix).toBe('>');
  });

  it('lists Create note and Create map for an empty query', async () => {
    const commands = await firstValueFrom(setup().search(''));

    expect(commands.map((c) => c.title)).toEqual(['Create note', 'Create map']);
  });

  it('filters its static Commands by the typed query', async () => {
    const commands = await firstValueFrom(setup().search('map'));

    expect(commands.map((c) => c.title)).toEqual(['Create map']);
  });

  it('opens the create dialog for the chosen type when a Command runs', async () => {
    const provider = setup();

    const [note, map] = await firstValueFrom(provider.search(''));
    note.run();
    expect(launcher.type()).toBe('note');

    map.run();
    expect(launcher.type()).toBe('hexmap');
  });
});
