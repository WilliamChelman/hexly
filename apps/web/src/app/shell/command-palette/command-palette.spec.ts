import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { Command, CommandProvider } from './command';
import { CommandRegistry } from './command-registry';
import { CommandPalette } from './command-palette';

function dispatchCmdK(): void {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'k', metaKey: true }),
  );
}

function render() {
  const fixture = TestBed.createComponent(CommandPalette);
  fixture.detectChanges();
  return fixture;
}

function dialogEl(fixture: ReturnType<typeof render>): HTMLDialogElement {
  return fixture.nativeElement.querySelector('dialog');
}

describe('CommandPalette', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CommandPalette, provideTranslocoTesting()],
    });
  });

  it('is closed until Cmd/Ctrl+K is pressed, then toggles on repeated presses', () => {
    const fixture = render();
    expect(dialogEl(fixture).open).toBe(false);

    dispatchCmdK();
    fixture.detectChanges();
    expect(dialogEl(fixture).open).toBe(true);

    dispatchCmdK();
    fixture.detectChanges();
    expect(dialogEl(fixture).open).toBe(false);
  });

  it('renders a registered provider\'s matching commands as the query changes', () => {
    const command: Command = { id: 'c1', label: 'Aldermoor', run: vi.fn() };
    const provider: CommandProvider = {
      prefix: '',
      label: 'commandPalette.entities',
      search: () => of([command]),
    };
    TestBed.inject(CommandRegistry).register(provider);

    const fixture = render();
    dispatchCmdK();
    fixture.detectChanges();

    const input: HTMLInputElement = fixture.nativeElement.querySelector(
      '[data-testid="command-palette-input"]',
    );
    input.value = 'ald';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const option = fixture.nativeElement.querySelector(
      '[data-testid="command-palette-option-c1"]',
    );
    expect(option?.textContent).toContain('Aldermoor');
  });

  it('runs the picked command and closes the palette', () => {
    const run = vi.fn();
    const command: Command = { id: 'c1', label: 'Aldermoor', run };
    const provider: CommandProvider = {
      prefix: '',
      label: 'commandPalette.entities',
      search: () => of([command]),
    };
    TestBed.inject(CommandRegistry).register(provider);

    const fixture = render();
    dispatchCmdK();
    fixture.detectChanges();

    const option: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="command-palette-option-c1"]',
    );
    option.click();
    fixture.detectChanges();

    expect(run).toHaveBeenCalled();
    expect(dialogEl(fixture).open).toBe(false);
  });

  it('navigates the result list with Up/Down and runs the active command on Enter', () => {
    const runA = vi.fn();
    const runB = vi.fn();
    const provider: CommandProvider = {
      prefix: '',
      label: 'commandPalette.entities',
      search: () =>
        of([
          { id: 'a', label: 'A', run: runA },
          { id: 'b', label: 'B', run: runB },
        ]),
    };
    TestBed.inject(CommandRegistry).register(provider);

    const fixture = render();
    dispatchCmdK();
    fixture.detectChanges();

    const input: HTMLInputElement = fixture.nativeElement.querySelector(
      '[data-testid="command-palette-input"]',
    );
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    fixture.detectChanges();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    fixture.detectChanges();

    expect(runA).not.toHaveBeenCalled();
    expect(runB).toHaveBeenCalled();
  });
});
