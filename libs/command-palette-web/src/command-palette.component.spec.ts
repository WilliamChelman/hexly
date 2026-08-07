import { ShortcutService } from '@hexly/web-core';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { UI_TEST_CATALOGS } from '@hexly/web-ui/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { COMMAND_PALETTE_TEST_CATALOGS } from './i18n/test-catalogs';
import { Command, CommandProvider } from './command';
import { CommandDirectory } from './command-directory';
import { CommandRegistry } from './command-registry';
import { COMMAND_PROVIDERS, CommandPaletteComponent, OPEN_COMMAND_PALETTE } from './command-palette.component';

function dispatchCmdK(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
}

function typeQuery(fixture: ReturnType<typeof render>, value: string): void {
  const input: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="command-palette-input"]');
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function render() {
  const fixture = TestBed.createComponent(CommandPaletteComponent);
  fixture.detectChanges();
  return fixture;
}

function inputEl(fixture: ReturnType<typeof render>): HTMLInputElement {
  return fixture.nativeElement.querySelector('[data-testid="command-palette-input"]');
}

/** Type into the box as a caller would: the DOM value, the caret, then the event. */
function typeAt(fixture: ReturnType<typeof render>, text: string): void {
  const input = inputEl(fixture);
  input.value = text;
  input.setSelectionRange(text.length, text.length);
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

/** The Facet suggestion rows alone — the result rows are options too, and are read separately. */
function suggestions(fixture: ReturnType<typeof render>): string[] {
  return Array.from(
    fixture.nativeElement.querySelectorAll('[data-testid="command-palette-input-suggestions"] [role=option]'),
  ).map((row) => ((row as HTMLElement).textContent ?? '').replace(/\s+/g, ' ').trim());
}

function press(fixture: ReturnType<typeof render>, key: string, keyCode?: number): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true } as KeyboardEventInit);
  inputEl(fixture).dispatchEvent(event);
  fixture.detectChanges();
  return event;
}

function dialogEl(fixture: ReturnType<typeof render>): HTMLDialogElement {
  return fixture.nativeElement.querySelector('dialog');
}

describe('CommandPalette', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CommandPaletteComponent, provideTranslocoTesting(COMMAND_PALETTE_TEST_CATALOGS, UI_TEST_CATALOGS)],
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

  it('opens as a Command reachable by id, which is how the native menu opens it', () => {
    // The Desktop App's menu item displays ⌘K without binding it and clicks through to this Command
    // instead, so the chord above stays the dispatcher's (ADR-0070).
    const fixture = render();

    expect(TestBed.inject(CommandDirectory).invoke(OPEN_COMMAND_PALETTE)).toBe(true);
    fixture.detectChanges();

    expect(dialogEl(fixture).open).toBe(true);
  });

  it('opens while focus is in a text field — the chord is registered inEditable', () => {
    const fixture = render();
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();

    outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
    fixture.detectChanges();

    const opened = dialogEl(fixture).open;
    outside.remove();
    expect(opened).toBe(true);
  });

  it('stays closed while a modal shortcut scope is held', () => {
    const fixture = render();

    const pop = TestBed.inject(ShortcutService).pushModalScope();
    dispatchCmdK();
    fixture.detectChanges();
    const openedBehindModal = dialogEl(fixture).open;
    pop();

    expect(openedBehindModal).toBe(false);
  });

  it('holds the modal scope while open, suppressing surface shortcuts under the overlay', () => {
    // The palette's dialog claims the keyboard like any declarative dialog (ADR-0063, amendment);
    // its Cmd/Ctrl+K toggle survives via the modal-layer twin registration.
    const handler = vi.fn();
    const unregister = TestBed.inject(ShortcutService).register({ layer: 'surface', keys: 'escape', handler });
    const fixture = render();
    dispatchCmdK();
    fixture.detectChanges();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(handler).not.toHaveBeenCalled();

    dispatchCmdK(); // the modal-layer toggle still closes it
    fixture.detectChanges();
    expect(dialogEl(fixture).open).toBe(false);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(handler).toHaveBeenCalledOnce();
    unregister();
  });

  it('leaves Escape from its own input un-defaulted, so the native cancel closes the dialog', () => {
    // Nothing may preventDefault the keydown: doing so cancels the native <dialog> "cancel" and the
    // palette would be stuck open (a surface's Escape used to do exactly that).
    const fixture = render();
    dispatchCmdK();
    fixture.detectChanges();

    const input: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="command-palette-input"]');
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);

    // jsdom's <dialog> has no native cancel path, so simulate what the browser does next: close().
    dialogEl(fixture).close();
    fixture.detectChanges();
    expect(dialogEl(fixture).open).toBe(false);

    // The close event synced the palette's own state, so the next chord re-opens rather than fighting it.
    dispatchCmdK();
    fixture.detectChanges();
    expect(dialogEl(fixture).open).toBe(true);
  });

  it("renders a registered provider's matching commands as the query changes", () => {
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

    const input: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="command-palette-input"]');
    input.value = 'ald';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const option = fixture.nativeElement.querySelector('[data-testid="command-palette-option-c1"]');
    expect(option?.textContent).toContain('Aldermoor');
  });

  it('renders a small thumbnail beside a command that carries one', () => {
    const command: Command = {
      id: 'e1',
      label: 'Aldermoor',
      thumbnailUrl: '/api/assets/a1/thumb',
      run: vi.fn(),
    };
    const provider: CommandProvider = {
      prefix: '',
      label: 'commandPalette.entities',
      search: () => of([command]),
    };
    TestBed.inject(CommandRegistry).register(provider);

    const fixture = render();
    dispatchCmdK();
    fixture.detectChanges();
    typeQuery(fixture, 'ald');

    const thumb: HTMLImageElement = fixture.nativeElement.querySelector('[data-testid="command-palette-thumbnail-e1"]');
    expect(thumb).not.toBeNull();
    expect(thumb.getAttribute('src')).toBe('/api/assets/a1/thumb');
    // Decorative — the label names the row.
    expect(thumb.getAttribute('alt')).toBe('');
  });

  it('renders no thumbnail slot for a command without one', () => {
    const command: Command = { id: 'e1', label: 'Aldermoor', run: vi.fn() };
    const provider: CommandProvider = {
      prefix: '',
      label: 'commandPalette.entities',
      search: () => of([command]),
    };
    TestBed.inject(CommandRegistry).register(provider);

    const fixture = render();
    dispatchCmdK();
    fixture.detectChanges();
    typeQuery(fixture, 'ald');

    expect(fixture.nativeElement.querySelector('[data-testid="command-palette-thumbnail-e1"]')).toBeNull();
    // The row still renders, unchanged.
    expect(fixture.nativeElement.querySelector('[data-testid="command-palette-option-e1"]')).not.toBeNull();
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

    const option: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="command-palette-option-c1"]');
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

    const input: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="command-palette-input"]');
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
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
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

    const input: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="command-palette-input"]');
    input.value = 'ald';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // Rendered without touching CommandRegistry directly — the token is the seam.
    const option = fixture.nativeElement.querySelector('[data-testid="command-palette-option-c1"]');
    expect(option).not.toBeNull();
    // The result list is a proper listbox for AT, following the ListboxController
    // idiom: role=option rows + the input's aria-activedescendant naming the
    // highlighted one (so arrowing is announced with focus still in the input).
    expect(option.getAttribute('role')).toBe('option');
    expect(fixture.nativeElement.querySelector('[role="listbox"]')).not.toBeNull();
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
      providers: [provideRouter([]), { provide: COMMAND_PROVIDERS, useValue: [provider] }],
    });

    const fixture = render();
    dispatchCmdK();
    fixture.detectChanges();
    typeQuery(fixture, 'ald');

    const option = fixture.nativeElement.querySelector('[data-testid="command-palette-option-e1"]');
    // A real anchor with an href — so middle-click / Ctrl+click open a new tab.
    expect(option.tagName).toBe('A');
    expect(option.getAttribute('href')).toBe('/w/w1/entities/e1');
  });

  /**
   * The Palette adopts the shared search box (ADR-0082), so a **Facet Token** narrows Quick Open the way
   * it narrows every other Entity search. **Key typeahead only**: the Palette runs no Facet read of its
   * own, so no value suggestion and no count appears here — what a token *means* is the Provider's, and
   * is read on the wire in its own spec.
   */
  describe('Facet Tokens', () => {
    /** A World-scoped Entity Provider as the Palette meets one: results, and a vocabulary it can apply. */
    function entityProvider(commands: readonly Command[] = []): CommandProvider {
      return {
        prefix: '',
        label: 'commandPalette.entities',
        search: () => of(commands),
        facetKeys: () => ({ reserved: ['type', 'tag'], fields: ['world.field.region'] }),
      };
    }

    function open(provider: CommandProvider) {
      TestBed.inject(CommandRegistry).register(provider);
      const fixture = render();
      dispatchCmdK();
      fixture.detectChanges();
      return fixture;
    }

    it('reveals the whole vocabulary on `$`, World-defined Fields included', () => {
      const fixture = open(entityProvider());

      typeAt(fixture, '$');

      // The Provider's own key set, resolved synchronously — Fields among them, the Palette having a
      // World to be scoped to (ADR-0083).
      expect(suggestions(fixture)).toEqual(['type', 'tag', 'world.field.region']);
    });

    it('offers no value suggestions and no counts — there is no Facet read here', () => {
      const fixture = open(entityProvider());

      typeAt(fixture, '$type:');

      expect(suggestions(fixture)).toEqual([]);
    });

    it('offers nothing where no Provider names a vocabulary — the Palette outside a World', () => {
      const fixture = open({ prefix: '', label: 'commandPalette.worlds', search: () => of([]) });

      typeAt(fixture, '$');

      expect(suggestions(fixture)).toEqual([]);
    });

    it('gives ↑↓ and Enter to the suggestion list while it is open, and to the results while it is shut', () => {
      const runA = vi.fn();
      const runB = vi.fn();
      const fixture = open(
        entityProvider([
          { id: 'a', label: 'A', run: runA },
          { id: 'b', label: 'B', run: runB },
        ]),
      );

      typeAt(fixture, '$t');
      press(fixture, 'ArrowDown', 40);
      press(fixture, 'Enter');

      // The list took both keys: the second key was completed, and no result was run under it.
      expect(inputEl(fixture).value).toBe('$tag:');
      expect(runA).not.toHaveBeenCalled();
      expect(runB).not.toHaveBeenCalled();

      // Shut, the same keys are the Palette's own, as they were before the box grew a list.
      typeAt(fixture, 'ald');
      press(fixture, 'ArrowDown', 40);
      press(fixture, 'Enter');

      expect(runB).toHaveBeenCalled();
      expect(runA).not.toHaveBeenCalled();
    });

    it('dismisses the suggestions on Escape and leaves the Palette open', () => {
      const fixture = open(entityProvider());
      typeAt(fixture, '$');

      const escape = press(fixture, 'Escape');

      expect(suggestions(fixture)).toEqual([]);
      // Defaulted away from the native <dialog> cancel, so dismissing a list never closes the overlay.
      expect(escape.defaultPrevented).toBe(true);
      expect(dialogEl(fixture).open).toBe(true);
      // The box keeps what was typed; dismissing a list is not clearing a query.
      expect(inputEl(fixture).value).toBe('$');
    });

    it('says a `$` name nothing here answers to, rather than searching for it as text', () => {
      const fixture = open(entityProvider());

      typeAt(fixture, 'orc $domain:material');

      const notice = fixture.nativeElement.querySelector('[data-testid="command-palette-unknown-facet"]');
      expect(notice?.textContent).toContain('domain');
      expect(notice?.getAttribute('role')).toBe('status');
    });

    it('says nothing about a key the Providers do answer to', () => {
      const fixture = open(entityProvider());

      typeAt(fixture, '$tag:draft');

      expect(fixture.nativeElement.querySelector('[data-testid="command-palette-unknown-facet"]')).toBeNull();
    });

    it('keeps the box a plain text field, so Escape stays the overlay’s', () => {
      const fixture = open(entityProvider());

      // A search field clears itself on Escape in Blink and WebKit, eating the key the dialog cancels
      // on. jsdom implements no such default, so the type is pinned here rather than left to a browser.
      expect(inputEl(fixture).getAttribute('type')).toBe('text');
    });
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
      providers: [provideRouter([]), { provide: COMMAND_PROVIDERS, useValue: [provider] }],
    });

    const fixture = render();
    dispatchCmdK();
    fixture.detectChanges();
    typeQuery(fixture, 'ald');

    const input: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="command-palette-input"]');
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        bubbles: true,
      }),
    );
    fixture.detectChanges();

    expect(openSpy).toHaveBeenCalledWith('/w/w1/entities/e1', '_blank', 'noopener');
    expect(run).not.toHaveBeenCalled();
    expect(dialogEl(fixture).open).toBe(false);
  });
});
