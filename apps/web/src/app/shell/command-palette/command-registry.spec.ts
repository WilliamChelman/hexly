import { TestBed } from '@angular/core/testing';
import { Subject, firstValueFrom, lastValueFrom, of } from 'rxjs';
import { Command, CommandProvider } from './command';
import { CommandRegistry, CommandSection } from './command-registry';

function provider(prefix: string, commands: Command[] = []): CommandProvider {
  return { prefix, label: prefix || 'default', search: () => of(commands) };
}

// Cached per id so re-calling command('a') in an assertion compares the same
// object `search()` returned, rather than two structurally-equal-but-distinct
// `run` closures (toEqual treats those as different).
const commands = new Map<string, Command>();
function command(id: string): Command {
  let c = commands.get(id);
  if (!c) {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    c = { id, label: id, run: () => {} };
    commands.set(id, c);
  }
  return c;
}

describe('CommandRegistry', () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(CommandRegistry);
  });

  it('reports no sections for a prefix with no registered providers', async () => {
    const sections = await firstValueFrom(registry.search('', 'q'));
    expect(sections).toEqual([]);
  });

  it('includes a registered provider\'s commands in its prefix\'s search', async () => {
    const p = provider('', [command('a')]);
    registry.register(p);

    const sections = await lastValueFrom(registry.search('', 'q'));
    expect(sections).toEqual([{ provider: p, commands: [command('a')] }]);
  });

  it('excludes a provider registered for a different prefix', async () => {
    registry.register(provider('>', [command('a')]));

    const sections = await firstValueFrom(registry.search('', 'q'));
    expect(sections).toEqual([]);
  });

  it('drops a provider once its unregister function is called', async () => {
    const unregister = registry.register(provider('', [command('a')]));
    unregister();

    const sections = await firstValueFrom(registry.search('', 'q'));
    expect(sections).toEqual([]);
  });

  it('merges multiple providers sharing a prefix, in registration order', async () => {
    const first = provider('', [command('a')]);
    const second = provider('', [command('b')]);
    registry.register(first);
    registry.register(second);

    const sections = await lastValueFrom(registry.search('', 'q'));
    expect(sections).toEqual([
      { provider: first, commands: [command('a')] },
      { provider: second, commands: [command('b')] },
    ]);
  });

  it('keeps sections in registration order as a slower provider resolves later', () => {
    const fastResults = new Subject<Command[]>();
    const slowResults = new Subject<Command[]>();
    const fast: CommandProvider = { prefix: '', label: 'fast', search: () => fastResults };
    const slow: CommandProvider = { prefix: '', label: 'slow', search: () => slowResults };
    // Registered slow-then-fast: the slower provider must stay first even though
    // its own results resolve after the faster one's (ADR-0032).
    registry.register(slow);
    registry.register(fast);

    const seen: (readonly CommandSection[])[] = [];
    registry.search('', 'q').subscribe((sections) => seen.push(sections));

    fastResults.next([command('a')]);
    expect(seen.at(-1)).toEqual([
      { provider: slow, commands: [] },
      { provider: fast, commands: [command('a')] },
    ]);

    slowResults.next([command('b')]);
    expect(seen.at(-1)).toEqual([
      { provider: slow, commands: [command('b')] },
      { provider: fast, commands: [command('a')] },
    ]);
  });
});
