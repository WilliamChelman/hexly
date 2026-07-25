import { TestBed } from '@angular/core/testing';
import { CommandDirectory } from '@hexly/command-palette-web';
import { DESKTOP_BRIDGE, DesktopBridge, Logger } from '@hexly/web-core';
import { DesktopMenuCommands } from './desktop-menu-commands';

/** The shell's side of the bridge: something that can push menu clicks at the renderer. */
class FakeBridge implements DesktopBridge {
  private listener?: (commandId: string) => void;
  unsubscribed = false;

  renewSession(): Promise<void> {
    return Promise.resolve();
  }

  onMenuCommand(listener: (commandId: string) => void): () => void {
    this.listener = listener;
    return () => (this.unsubscribed = true);
  }

  /** Present because the bridge has them; a menu click is all this spec drives. */
  moveAssetStorage(): Promise<never> {
    return Promise.reject(new Error('Not this spec’s business'));
  }

  cancelAssetStorageMove(): void {
    // Nothing to cancel here.
  }

  /** A user choosing a menu item, as main reports it. */
  click(commandId: string): void {
    if (!this.listener) throw new Error('Nothing is listening for menu clicks');
    this.listener(commandId);
  }
}

describe('DesktopMenuCommands', () => {
  let ran: string[];

  function appWith(bridge: DesktopBridge | null): CommandDirectory {
    TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_BRIDGE, useValue: bridge }] });
    const directory = TestBed.inject(CommandDirectory);
    directory.register({ id: 'go-worlds', label: 'Go to Worlds', run: () => void ran.push('go-worlds') });
    TestBed.inject(DesktopMenuCommands);
    return directory;
  }

  beforeEach(() => {
    ran = [];
  });

  it('runs the Command a menu click names', () => {
    const bridge = new FakeBridge();
    appWith(bridge);

    bridge.click('go-worlds');

    // The same Command the Palette lists — the menu is a second surface, not a second implementation.
    expect(ran).toEqual(['go-worlds']);
  });

  it('says so when the menu names a Command nothing offers, and carries on', () => {
    const bridge = new FakeBridge();
    appWith(bridge);
    const warn = vi.spyOn(TestBed.inject(Logger), 'warn').mockImplementation(() => undefined);

    expect(() => bridge.click('go-nowhere')).not.toThrow();

    expect(ran).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('go-nowhere'));
  });

  it('does nothing in a browser, where there is no bridge and no menu', () => {
    // Inert by capability check, not by reading the Deployment Profile (ADR-0071).
    expect(() => appWith(null)).not.toThrow();
    expect(ran).toEqual([]);
  });

  it('stops listening when the app goes away', () => {
    const bridge = new FakeBridge();
    appWith(bridge);

    TestBed.resetTestingModule();

    expect(bridge.unsubscribed).toBe(true);
  });
});
