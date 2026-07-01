import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { WorldSummary } from '@hexly/domain';
import { WorldStore } from '../../../core/services/world.store';
import { WorldQuickOpen } from './world-quick-open';

function world(id: string, name: string): WorldSummary {
  return { id, name, ownerId: 'u1', createdAt: 1, updatedAt: 1 };
}

describe('WorldQuickOpen', () => {
  let navigate: ReturnType<typeof vi.spyOn>;

  function setup(worlds: WorldSummary[]): WorldQuickOpen {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: WorldStore, useValue: { worlds: () => worlds } },
      ],
    });
    navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    return TestBed.inject(WorldQuickOpen);
  }

  it('answers the empty (Quick Open) prefix', () => {
    expect(setup([]).prefix).toBe('');
  });

  it('filters the already-loaded World list client-side, case-insensitively', async () => {
    const provider = setup([
      world('w1', 'Aldermoor'),
      world('w2', 'Whisperwood'),
    ]);

    const commands = await firstValueFrom(provider.search('ALDER'));

    expect(commands).toEqual([
      expect.objectContaining({ id: 'w1', label: 'Aldermoor' }),
    ]);
  });

  it('lists every loaded World for a blank query', async () => {
    const provider = setup([world('w1', 'Aldermoor'), world('w2', 'Whisperwood')]);

    const commands = await firstValueFrom(provider.search(''));

    expect(commands.map((c) => c.id)).toEqual(['w1', 'w2']);
  });

  it('navigates to the picked World, like the World Switcher', async () => {
    const provider = setup([world('w1', 'Aldermoor')]);

    const [command] = await firstValueFrom(provider.search(''));
    command.run();

    expect(navigate).toHaveBeenCalledWith(['/w', 'w1', 'entities']);
  });
});
