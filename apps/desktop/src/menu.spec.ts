import type { MenuItemConstructorOptions } from 'electron';
import { AppMenuActions, buildAppMenuTemplate, GO_TO_WORLDS, OPEN_COMMAND_PALETTE, REVEAL_DATA_FOLDER } from './menu';

/** What the menu asked the shell to do, in order. */
function recorder(): AppMenuActions & { readonly invoked: string[]; readonly revealed: number } {
  const invoked: string[] = [];
  let revealed = 0;
  return {
    invoked,
    get revealed() {
      return revealed;
    },
    invokeCommand: (id) => void invoked.push(id),
    revealDataFolder: () => void revealed++,
  };
}

function menu(platform: NodeJS.Platform, actions: AppMenuActions = recorder()): MenuItemConstructorOptions[] {
  return buildAppMenuTemplate(platform, actions);
}

function labels(template: MenuItemConstructorOptions[]): (string | undefined)[] {
  return template.map((item) => item.label);
}

function submenu(template: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] {
  const found = template.find((item) => item.label === label);
  if (!Array.isArray(found?.submenu)) throw new Error(`No "${label}" menu in ${labels(template).join(', ')}`);
  return found.submenu;
}

/** Every item in the tree, so an invariant can be asserted over all of them at once. */
function everyItem(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return template.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? everyItem(item.submenu) : [])]);
}

function itemById(template: MenuItemConstructorOptions[], id: string): MenuItemConstructorOptions {
  const found = everyItem(template).find((item) => item.id === id);
  if (!found) throw new Error(`No item with id "${id}"`);
  return found;
}

/** Choose the item as a user does. Electron hands `click` a MenuItem and a window; ours read neither. */
function choose(item: MenuItemConstructorOptions): void {
  const click = item.click as unknown as (() => void) | undefined;
  if (!click) throw new Error(`Item "${item.id ?? item.label}" does nothing when chosen`);
  click();
}

describe('buildAppMenuTemplate', () => {
  describe('the structure each platform expects', () => {
    it('puts the app menu first on macOS, with Quit in it', () => {
      const template = menu('darwin');
      expect(labels(template)).toEqual(['Hexly', 'File', 'Edit', 'View', 'Go', 'Window']);
      expect(submenu(template, 'Hexly').map((i) => i.role)).toContain('quit');
      // The window closes from File there; the app quits from the app menu.
      expect(submenu(template, 'File').map((i) => i.role)).toContain('close');
    });

    it('has no app menu elsewhere, and quits from File', () => {
      for (const platform of ['win32', 'linux'] as const) {
        const template = menu(platform);
        expect(labels(template)).toEqual(['File', 'Edit', 'View', 'Go', 'Window']);
        expect(submenu(template, 'File').map((i) => i.role)).toContain('quit');
      }
    });

    it('names the reveal gesture the way the platform does', () => {
      expect(itemById(menu('darwin'), REVEAL_DATA_FOLDER).label).toBe('Reveal Data Folder in Finder');
      expect(itemById(menu('win32'), REVEAL_DATA_FOLDER).label).toBe('Show Data Folder in File Explorer');
      expect(itemById(menu('linux'), REVEAL_DATA_FOLDER).label).toBe('Open Data Folder');
    });

    it('offers pasteAndMatchStyle only where the role exists', () => {
      expect(submenu(menu('darwin'), 'Edit').map((i) => i.role)).toContain('pasteAndMatchStyle');
      expect(submenu(menu('linux'), 'Edit').map((i) => i.role)).not.toContain('pasteAndMatchStyle');
    });
  });

  describe('the accelerators it registers', () => {
    it('leaves clipboard, zoom, reload, devtools, window and quit to native roles', () => {
      const template = menu('darwin');
      const roles = everyItem(template).map((item) => item.role);
      // Clipboard first: on macOS these are what make cut/copy/paste work inside web content at all.
      expect(roles).toEqual(expect.arrayContaining(['cut', 'copy', 'paste', 'selectAll']));
      expect(roles).toEqual(expect.arrayContaining(['resetZoom', 'zoomIn', 'zoomOut']));
      expect(roles).toEqual(expect.arrayContaining(['reload', 'forceReload', 'toggleDevTools']));
      expect(roles).toEqual(expect.arrayContaining(['minimize', 'close', 'quit']));
    });

    it("never turns a role's accelerator off — an unregistered role chord does nothing", () => {
      const roleItems = everyItem(menu('darwin')).filter((item) => item.role);
      expect(roleItems.every((item) => item.registerAccelerator !== false)).toBe(true);
    });

    /**
     * The invariant the design rests on (ADR-0070), asserted over the whole tree rather than the one item we
     * happen to ship, so a later item cannot quietly bind a chord.
     */
    it('displays without registering every accelerator on an item it dispatches itself', () => {
      for (const platform of ['darwin', 'win32', 'linux'] as const) {
        const dispatched = everyItem(menu(platform)).filter((item) => item.click && item.accelerator);
        for (const item of dispatched) expect(item.registerAccelerator).toBe(false);
      }
    });

    it('shows the Palette its Cmd/Ctrl+K without binding it', () => {
      const palette = itemById(menu('darwin'), OPEN_COMMAND_PALETTE);
      expect(palette.accelerator).toBe('CmdOrCtrl+K');
      expect(palette.registerAccelerator).toBe(false);
    });
  });

  describe('what a click does', () => {
    it('sends the Command id the renderer knows, and nothing else', () => {
      const actions = recorder();
      const template = menu('darwin', actions);

      choose(itemById(template, OPEN_COMMAND_PALETTE));
      choose(itemById(template, GO_TO_WORLDS));

      expect(actions.invoked).toEqual([OPEN_COMMAND_PALETTE, GO_TO_WORLDS]);
    });

    it('asks the shell to reveal the Instance Directory', () => {
      const actions = recorder();
      const template = menu('darwin', actions);

      choose(itemById(template, REVEAL_DATA_FOLDER));

      expect(actions.revealed).toBe(1);
      // Revealing a folder is main's business, not a Command: no renderer round trip.
      expect(actions.invoked).toEqual([]);
    });
  });
});
