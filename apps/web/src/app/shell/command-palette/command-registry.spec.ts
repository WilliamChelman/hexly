import { of } from 'rxjs';
import { Command, CommandProvider } from './command';
import { CommandRegistry } from './command-registry';

function provider(prefix: string, labelKey = prefix || 'default'): CommandProvider {
  return { prefix, labelKey, search: () => of<Command[]>([]) };
}

describe('CommandRegistry', () => {
  it('returns providers registered for a prefix', () => {
    const registry = new CommandRegistry();
    const entities = provider('');

    registry.register(entities);

    expect(registry.providersFor('')).toEqual([entities]);
  });

  it('excludes providers bound to a different prefix', () => {
    const registry = new CommandRegistry();
    registry.register(provider(''));
    const commands = provider('>');
    registry.register(commands);

    expect(registry.providersFor('>')).toEqual([commands]);
  });

  it('keeps several providers on one prefix in registration order (many-to-one)', () => {
    const registry = new CommandRegistry();
    const worlds = provider('', 'world');
    const entities = provider('', 'entity');
    registry.register(worlds);
    registry.register(entities);

    expect(registry.providersFor('')).toEqual([worlds, entities]);
  });

  it('drops a provider when its unregister fn is called (contextual lifetime)', () => {
    const registry = new CommandRegistry();
    const contextual = provider('');
    const unregister = registry.register(contextual);

    unregister();

    expect(registry.providersFor('')).toEqual([]);
  });
});
