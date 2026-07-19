import { TestBed } from '@angular/core/testing';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { ToasterService } from '@hexly/web-core';
import { firstValueFrom } from 'rxjs';
import { DICE_RNG, Rng } from './dice';
import { DiceCommands, DICE_TOAST_DURATION_MS } from './dice-commands';
import { DICE_TEST_CATALOGS } from './i18n/test-catalogs';

/** The options the Provider raises every roll toast with — anchored up, lingering. */
const ROLL_TOAST_OPTS = { placement: 'top', durationMs: DICE_TOAST_DURATION_MS };

/** A float that maps to `n` on a `d(sides)` — lets a scripted RNG name the faces it wants. */
const face = (n: number, sides: number): number => (n - 0.5) / sides;

/** An RNG that replays `values` in order, then keeps yielding the last one. */
const scripted = (values: readonly number[]): Rng => {
  let cursor = 0;
  return () => values[Math.min(cursor++, values.length - 1)];
};

describe('DiceCommands', () => {
  let provider: DiceCommands;
  let show: ReturnType<typeof vi.fn>;
  let rng: Rng;

  function configure(faces: readonly number[]): void {
    show = vi.fn();
    rng = scripted(faces);
    TestBed.configureTestingModule({
      imports: [provideTranslocoTesting(DICE_TEST_CATALOGS)],
      providers: [
        { provide: ToasterService, useValue: { show } },
        { provide: DICE_RNG, useValue: rng },
      ],
    });
    provider = TestBed.inject(DiceCommands);
  }

  it('answers the "/r " prefix', () => {
    configure([]);
    expect(provider.prefix).toBe('/r ');
  });

  it('offers one runnable Command labelled with the expression for a valid query', async () => {
    configure([face(7, 10), face(4, 10)]);
    const commands = await firstValueFrom(provider.search('2d10 + 3'));
    expect(commands).toHaveLength(1);
    expect(commands[0].label).toBe('Roll 2d10 + 3');
  });

  it('flashes the formatted Roll Result through the toaster when the Command runs', async () => {
    configure([face(7, 10), face(4, 10)]);
    const [command] = await firstValueFrom(provider.search('2d10 + 3'));
    command.run();
    expect(show).toHaveBeenCalledWith('2d10 + 3 → 2d10: 7, 4 = 14', 'info', ROLL_TOAST_OPTS);
  });

  it('offers one non-runnable hint Command for an invalid query', async () => {
    configure([]);
    const commands = await firstValueFrom(provider.search('2d'));
    expect(commands).toHaveLength(1);
    expect(commands[0].label).toBe('Not a valid dice expression');
    // The hint is inert: running it raises no toast.
    commands[0].run();
    expect(show).not.toHaveBeenCalled();
  });

  it('offers nothing before the user types an expression', async () => {
    configure([]);
    const commands = await firstValueFrom(provider.search('   '));
    expect(commands).toEqual([]);
  });

  it('produces a fresh Roll each time the Command runs', async () => {
    configure([face(7, 10), face(4, 10), face(2, 10), face(9, 10)]);
    const [command] = await firstValueFrom(provider.search('2d10 + 3'));
    command.run();
    command.run();
    expect(show).toHaveBeenNthCalledWith(1, '2d10 + 3 → 2d10: 7, 4 = 14', 'info', ROLL_TOAST_OPTS);
    expect(show).toHaveBeenNthCalledWith(2, '2d10 + 3 → 2d10: 2, 9 = 14', 'info', ROLL_TOAST_OPTS);
  });
});
