import { TestBed } from '@angular/core/testing';
import { Command } from './command';
import { CommandDirectory } from './command-directory';

describe('CommandDirectory', () => {
  let directory: CommandDirectory;
  let ran: string[];

  beforeEach(() => {
    directory = TestBed.inject(CommandDirectory);
    ran = [];
  });

  function command(id: string): Command {
    return { id, label: id, run: () => void ran.push(id) };
  }

  it('runs the Command registered under an id', () => {
    directory.register(command('go-worlds'));

    expect(directory.invoke('go-worlds')).toBe(true);
    expect(ran).toEqual(['go-worlds']);
  });

  it('answers false for an id nothing holds, and runs nothing', () => {
    // A native menu outlives any one surface's Commands (ADR-0071), so a miss is a legitimate outcome.
    expect(directory.invoke('go-nowhere')).toBe(false);
    expect(ran).toEqual([]);
  });

  it('lets a re-registration take the id over', () => {
    directory.register(command('go-worlds'));
    directory.register({ id: 'go-worlds', label: 'again', run: () => void ran.push('second') });

    directory.invoke('go-worlds');

    expect(ran).toEqual(['second']);
  });
});
