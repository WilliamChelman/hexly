import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { Command, CommandProvider } from './command';
import { CommandRegistry } from './command-registry';
import { COMMAND_PROVIDERS, CommandPalette } from './command-palette';

function dispatchCmdK(): void {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'k', metaKey: true }),
  );
}

function typeQuery(fixture: ReturnType<typeof render>, value: string): void {
  const input: HTMLInputElement = fixture.nativeElement.querySelector(
    '[data-testid="command-palette-input"]',
  );
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
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
    // CDK's ListKeyManager reads event.keyCode (40 = ArrowDown), which jsdom does
    // not derive from `key`, so send it explicitly the way a real browser would.
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        keyCode: 40,
        bubbles: true,
      } as KeyboardEventInit),
    );
    fixture.detectChanges();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    fixture.detectChanges();

    expect(runA).not.toHaveBeenCalled();
    expect(runB).toHaveBeenCalled();
  });

  it('self-registers the built-in Providers supplied via COMMAND_PROVIDERS', () => {
    const command: Command = { id: 'c1', label: 'Aldermoor', run: vi.fn() };
    const provider: CommandProvider = {
      prefix: '',
      label: 'commandPalette.entities',
      search: () => of([command]),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: COMMAND_PROVIDERS, useValue: [provider] }],
    });

    const fixture = render();
    dispatchCmdK();
    fixture.detectChanges();

    const input: HTMLInputElement = fixture.nativeElement.querySelector(
      '[data-testid="command-palette-input"]',
    );
    input.value = 'ald';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // Rendered without touching CommandRegistry directly — the token is the seam.
    const option = fixture.nativeElement.querySelector(
      '[data-testid="command-palette-option-c1"]',
    );
    expect(option).not.toBeNull();
    // The result list is a proper listbox for AT, following the SuggestionMenu
    // idiom: role=option rows + the input's aria-activedescendant naming the
    // highlighted one (so arrowing is announced with focus still in the input).
    expect(option.getAttribute('role')).toBe('option');
    expect(
      fixture.nativeElement.querySelector('[role="listbox"]'),
    ).not.toBeNull();
    expect(input.getAttribute('aria-activedescendant')).toBe(option.id);
    expect(option.id).toBeTruthy();
  });

  it('renders a routable command as a routerLink anchor (new-tab capable)', () => {
    const command: Command = {
      id: 'e1',
      label: 'Aldermoor',
      route: ['/w', 'w1', 'entities', 'e1'],
      run: vi.fn(),
    };
    const provider: CommandProvider = {
      prefix: '',
      label: 'commandPalette.entities',
      search: () => of([command]),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: COMMAND_PROVIDERS, useValue: [provider] },
      ],
    });

    const fixture = render();
    dispatchCmdK();
    fixture.detectChanges();
    typeQuery(fixture, 'ald');

    const option = fixture.nativeElement.querySelector(
      '[data-testid="command-palette-option-e1"]',
    );
    // A real anchor with an href — so middle-click / Ctrl+click open a new tab.
    expect(option.tagName).toBe('A');
    expect(option.getAttribute('href')).toBe('/w/w1/entities/e1');
  });

  it('opens a routable command in a new tab on Ctrl+Enter, without running it in place', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const run = vi.fn();
    const command: Command = {
      id: 'e1',
      label: 'Aldermoor',
      route: ['/w', 'w1', 'entities', 'e1'],
      run,
    };
    const provider: CommandProvider = {
      prefix: '',
      label: 'commandPalette.entities',
      search: () => of([command]),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: COMMAND_PROVIDERS, useValue: [provider] },
      ],
    });

    const fixture = render();
    dispatchCmdK();
    fixture.detectChanges();
    typeQuery(fixture, 'ald');

    const input: HTMLInputElement = fixture.nativeElement.querySelector(
      '[data-testid="command-palette-input"]',
    );
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
    );
    fixture.detectChanges();

    expect(openSpy).toHaveBeenCalledWith('/w/w1/entities/e1', '_blank', 'noopener');
    expect(run).not.toHaveBeenCalled();
    expect(dialogEl(fixture).open).toBe(false);
  });
});
