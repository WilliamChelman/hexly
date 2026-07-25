import type { MenuItemConstructorOptions } from 'electron';
import {
  AppMenuActions,
  buildAppMenuTemplate,
  GO_TO_WORLDS,
  NEW_WINDOW,
  OPEN_COMMAND_PALETTE,
  REVEAL_DATA_FOLDER,
} from './menu';

/** What the menu asked the shell to do, in order. */
function recorder(): AppMenuActions & {
  readonly invoked: string[];
  readonly revealed: number;
  readonly opened: number;
} {
  const invoked: string[] = [];
  let revealed = 0;
  let opened = 0;
  return {
    invoked,
    get revealed() {
      return revealed;
    },
    get opened() {
      return opened;
    },
    invokeCommand: (id) => void invoked.push(id),
    openNewWindow: () => void opened++,
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

    /** Where every platform's user looks for it, and the only surface a second window is offered from. */
    it('offers New Window from File on every platform', () => {
      for (const platform of ['darwin', 'win32', 'linux'] as const) {
        expect(submenu(menu(platform), 'File').map((item) => item.id)).toContain(NEW_WINDOW);
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
     * The invariant the design rests on (ADR-0070), stated from the side that scales: whatever the menu grows, a
     * bound chord belongs to a native role or to an action main performs itself — never to an item the
     * renderer's dispatcher acts on. Nothing new can bind one without failing here.
     */
    it('binds a chord only for a role or for one of main’s own actions', () => {
      for (const platform of ['darwin', 'win32', 'linux'] as const) {
        const bound = everyItem(menu(platform)).filter(
          (item) => item.click && item.accelerator && item.registerAccelerator !== false,
        );
        expect(bound.map((item) => item.id)).toEqual([NEW_WINDOW]);
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

    /** Opening a window is main's own business — it owns the window list — so no renderer round trip either. */
    it('asks the shell for a second window on this Instance', () => {
      const actions = recorder();
      const template = menu('darwin', actions);

      choose(itemById(template, NEW_WINDOW));

      expect(actions.opened).toBe(1);
      expect(actions.invoked).toEqual([]);
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
