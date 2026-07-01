import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { Command, CommandProvider } from './command';
import { COMMAND_PROVIDERS } from './command-palette';
import { CommandPalette } from './command-palette';

function command(id: string, run = vi.fn()): Command {
  return { id, title: id, run };
}

/** A Provider whose results are pushed by the test, to script streaming order. */
function scripted(
  prefix: string,
  labelKey: string,
  search: (q: string) => ReturnType<CommandProvider['search']>,
): CommandProvider {
  return { prefix, labelKey, search };
}

describe('CommandPalette', () => {
  function render(providers: CommandProvider[]) {
    TestBed.configureTestingModule({
      imports: [CommandPalette, provideTranslocoTesting()],
      providers: [
        provideRouter([]),
        { provide: COMMAND_PROVIDERS, useValue: providers },
      ],
    });
    const fixture = TestBed.createComponent(CommandPalette);
    fixture.detectChanges();
    return fixture;
  }

  const dialog = (f: ReturnType<typeof render>) =>
    f.nativeElement.querySelector('dialog') as HTMLDialogElement;
  const input = (f: ReturnType<typeof render>) =>
    f.nativeElement.querySelector('[data-testid=command-input]') as HTMLInputElement;
  const rows = (f: ReturnType<typeof render>) =>
    Array.from(
      f.nativeElement.querySelectorAll('[data-testid=command-option]'),
    ) as HTMLElement[];

  function pressCmdK() {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true }),
    );
  }

  function type(f: ReturnType<typeof render>, text: string) {
    const el = input(f);
    el.value = text;
    el.dispatchEvent(new Event('input'));
    f.detectChanges();
  }

  it('opens on Cmd/Ctrl+K and closes on a second press', () => {
    const fixture = render([]);
    expect(dialog(fixture).open).toBe(false);

    pressCmdK();
    fixture.detectChanges();
    expect(dialog(fixture).open).toBe(true);

    pressCmdK();
    fixture.detectChanges();
    expect(dialog(fixture).open).toBe(false);
  });

  it('merges Providers in registration order, tagging each row with its label', () => {
    const fixture = render([
      scripted('', 'commandPalette.world', () => of([command('Aldermoor')])),
      scripted('', 'commandPalette.entity', () => of([command('Bramblewick')])),
    ]);

    pressCmdK();
    fixture.detectChanges();
    type(fixture, 'a');

    const texts = rows(fixture).map((r) => r.textContent?.replace(/\s+/g, ' ').trim());
    expect(texts).toEqual(['Aldermoor World', 'Bramblewick Entity']);
  });

  it('keeps a fast Provider’s section stable when a slower one fills in late', () => {
    const slow = new Subject<Command[]>();
    const fixture = render([
      scripted('', 'commandPalette.world', () => of([command('Aldermoor')])),
      scripted('', 'commandPalette.entity', () => slow),
    ]);

    pressCmdK();
    fixture.detectChanges();
    type(fixture, 'a');
    expect(rows(fixture).map((r) => r.textContent?.includes('Aldermoor'))).toEqual([true]);

    slow.next([command('Bramblewick')]);
    fixture.detectChanges();

    const titles = rows(fixture).map((r) => r.textContent?.trim().split(/\s+/)[0]);
    expect(titles).toEqual(['Aldermoor', 'Bramblewick']);
  });

  it('runs the keyboard-selected Command on Enter and closes', () => {
    const runFirst = vi.fn();
    const runSecond = vi.fn();
    const fixture = render([
      scripted('', 'commandPalette.world', () =>
        of([command('First', runFirst), command('Second', runSecond)]),
      ),
    ]);

    pressCmdK();
    fixture.detectChanges();
    type(fixture, 'x');

    // CDK's ListKeyManager reads event.keyCode (40 = ArrowDown), which jsdom does
    // not derive from `key`, so send it explicitly the way a real browser would.
    input(fixture).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40 } as KeyboardEventInit),
    );
    fixture.detectChanges();
    input(fixture).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();

    expect(runSecond).toHaveBeenCalledOnce();
    expect(runFirst).not.toHaveBeenCalled();
    expect(dialog(fixture).open).toBe(false);
  });
});
