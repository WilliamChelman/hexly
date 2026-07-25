import type { MenuItemConstructorOptions } from 'electron';

/** What choosing a menu item asks of the shell. */
export interface AppMenuActions {
  /** Hand a Command id to the renderer, where the Palette's Command and the dispatcher live (ADR-0070). */
  invokeCommand(commandId: string): void;
  /** Open a second window on this Instance, so a Note can be read beside the Hex Map that links to it. */
  openNewWindow(): void;
  /** Open the Instance Directory in the platform's file manager. */
  revealDataFolder(): void;
}

/**
 * The Command ids this menu names. Restated rather than imported — main and the SPA are two bundles and no
 * build joins them, the same reason `preload.ts` restates the bridge's global name.
 */
export const OPEN_COMMAND_PALETTE = 'open-command-palette';
export const GO_TO_WORLDS = 'go-worlds';
export const MOVE_ASSET_STORAGE = 'move-asset-storage';

/** The ids of the items main acts on itself, so a spec can find them without matching a label. */
export const NEW_WINDOW = 'new-window';
export const REVEAL_DATA_FOLDER = 'reveal-data-folder';

/**
 * The application menu, per platform. Two kinds of item live here and the difference is the whole point
 * (ADR-0070): native **roles** keep their accelerators, since the dispatcher never claimed those and ⌘C stops
 * working inside web content on macOS without them, while an item duplicating an in-app action only displays
 * its chord — see {@link commandItem}.
 *
 * Labels are English only: main has no transloco catalog, and joining the two bundles' i18n for six strings
 * costs more than it buys.
 */
export function buildAppMenuTemplate(platform: NodeJS.Platform, actions: AppMenuActions): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin';
  return [
    ...(mac ? [macAppMenu()] : []),
    fileMenu(platform, actions),
    editMenu(mac),
    viewMenu(),
    goMenu(actions),
    windowMenu(mac),
  ];
}

/**
 * An item standing in for an in-app Command: the click IPCs the id into the renderer, and the chord is shown
 * without being bound. Registering it would consume the keydown before the renderer's single dispatcher saw
 * it, making the menu a second dispatcher blind to modal scope (ADR-0063) — while showing it is how the
 * keyboard surface stays discoverable.
 *
 * `electron.d.ts` annotates `registerAccelerator` `@platform linux,win32`, which reads as "impossible on
 * macOS"; the annotation is stale — AppKit declines the key equivalent and still draws it.
 */
function commandItem(
  id: string,
  label: string,
  actions: AppMenuActions,
  accelerator?: string,
): MenuItemConstructorOptions {
  return { id, label, accelerator, registerAccelerator: false, click: () => actions.invokeCommand(id) };
}

/** macOS keeps the app's own menu first, and it is where the platform expects Quit and the hide items. */
function macAppMenu(): MenuItemConstructorOptions {
  return {
    label: 'Hexly',
    submenu: [
      { role: 'about', label: 'About Hexly' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };
}

/**
 * Two of main's own gestures, neither of them a Command: a second window on this Instance, and revealing the
 * Instance Directory — backing up worldbuilding is then copying one folder, without having to know where the
 * platform keeps application support data (ADR-0070).
 *
 * These bind their chords for real, unlike {@link commandItem}: the action is main's, so there is no renderer
 * dispatcher to take it away from. `Shift` is in the chord because ⌘N is worth leaving to a future in-app
 * "new Entity", which is the more likely thing a worldbuilder reaches for.
 */
function fileMenu(platform: NodeJS.Platform, actions: AppMenuActions): MenuItemConstructorOptions {
  const mac = platform === 'darwin';
  return {
    label: 'File',
    submenu: [
      { id: NEW_WINDOW, label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => actions.openNewWindow() },
      { type: 'separator' },
      { id: REVEAL_DATA_FOLDER, label: revealLabel(platform), click: () => actions.revealDataFolder() },
      // Beside revealing the folder, because both answer "where is my data?" — but a Command, not one of main's
      // own actions: the copy takes minutes and needs a surface to report progress on and be cancelled from,
      // which is the renderer's (#326). Main still owns the picker and the bytes.
      commandItem(MOVE_ASSET_STORAGE, 'Move Asset Storage…', actions),
      { type: 'separator' },
      // Quit lives in the app menu on macOS, so this menu ends at closing the window there.
      mac ? { role: 'close' } : { role: 'quit' },
    ],
  };
}

/** The platform's own word for the gesture, so the item reads as native. */
function revealLabel(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'Reveal Data Folder in Finder';
  if (platform === 'win32') return 'Show Data Folder in File Explorer';
  return 'Open Data Folder';
}

/**
 * Roles throughout, and registered: on macOS cut/copy/paste in web content are driven by the menu's
 * accelerators, so an app without this menu cannot copy text (ADR-0070).
 */
function editMenu(mac: boolean): MenuItemConstructorOptions {
  return {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      // Pasting prose into an editor should not carry the source's styling; macOS-only role.
      ...(mac ? [{ role: 'pasteAndMatchStyle' } as MenuItemConstructorOptions] : []),
      { role: 'delete' },
      { type: 'separator' },
      { role: 'selectAll' },
    ],
  };
}

/** Zoom, reload and devtools: chords the renderer never claimed, and the shell's only debugging surface. */
function viewMenu(): MenuItemConstructorOptions {
  return {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  };
}

/**
 * The in-app surface, one Command per item. The Palette's chord is displayed here and owned by the
 * renderer; Worlds is a Command the Palette lists too — one implementation, two surfaces.
 */
function goMenu(actions: AppMenuActions): MenuItemConstructorOptions {
  return {
    label: 'Go',
    submenu: [
      commandItem(OPEN_COMMAND_PALETTE, 'Command Palette…', actions, 'CmdOrCtrl+K'),
      { type: 'separator' },
      commandItem(GO_TO_WORLDS, 'Worlds', actions),
    ],
  };
}

/** Spelled out rather than `role: 'windowMenu'`, so the template is the whole truth a spec can read. */
function windowMenu(mac: boolean): MenuItemConstructorOptions {
  return {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      // `zoom` — the green button's maximize — is a macOS-only role.
      ...(mac ? [{ role: 'zoom' } as MenuItemConstructorOptions] : []),
      { type: 'separator' },
      { role: 'close' },
    ],
  };
}
