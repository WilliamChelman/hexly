import type { MenuItemConstructorOptions } from 'electron';

export interface AppMenuActions {
  /** The dispatcher and the Palette's Commands live in the renderer (ADR-0070). */
  invokeCommand(commandId: string): void;
  /** So a Note can be read beside the Hex Map that links to it. */
  openNewWindow(): void;
  revealDataFolder(): void;
}

/** Restated rather than imported: main and the SPA are two bundles and no build joins them. */
export const OPEN_COMMAND_PALETTE = 'open-command-palette';
export const GO_TO_WORLDS = 'go-worlds';
export const MOVE_ASSET_STORAGE = 'move-asset-storage';

/** The ids of the items main acts on itself, so a spec can find them without matching a label. */
export const NEW_WINDOW = 'new-window';
export const REVEAL_DATA_FOLDER = 'reveal-data-folder';

/**
 * Native **roles** keep their accelerators, since ⌘C stops working inside web content on macOS without them,
 * while an item duplicating an in-app action only displays its chord (ADR-0070; see {@link commandItem}).
 * Labels are English only: main has no transloco catalog.
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
 * The chord is shown without being bound: registering it would make the menu a second dispatcher, blind to
 * modal scope (ADR-0063). `electron.d.ts` annotates `registerAccelerator` `@platform linux,win32`, but the
 * annotation is stale — AppKit declines the key equivalent and still draws it.
 */
function commandItem(
  id: string,
  label: string,
  actions: AppMenuActions,
  accelerator?: string,
): MenuItemConstructorOptions {
  return { id, label, accelerator, registerAccelerator: false, click: () => actions.invokeCommand(id) };
}

/** macOS expects the app's own menu first, holding Quit and the hide items. */
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
 * Revealing the Instance Directory makes backing up worldbuilding one folder copy (ADR-0070). These bind their
 * chords for real, unlike {@link commandItem}, since the action is main's; `Shift` leaves ⌘N to a future
 * in-app "new Entity".
 */
function fileMenu(platform: NodeJS.Platform, actions: AppMenuActions): MenuItemConstructorOptions {
  const mac = platform === 'darwin';
  return {
    label: 'File',
    submenu: [
      { id: NEW_WINDOW, label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => actions.openNewWindow() },
      { type: 'separator' },
      { id: REVEAL_DATA_FOLDER, label: revealLabel(platform), click: () => actions.revealDataFolder() },
      // A Command, not one of main's own actions: the copy takes minutes and needs the renderer's progress and
      // cancel surface (#326).
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

/** Registered roles: on macOS cut/copy/paste in web content are driven by the menu's accelerators (ADR-0070). */
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
      // macOS-only role.
      ...(mac ? [{ role: 'pasteAndMatchStyle' } as MenuItemConstructorOptions] : []),
      { role: 'delete' },
      { type: 'separator' },
      { role: 'selectAll' },
    ],
  };
}

/** Chords the renderer never claimed, and the shell's only debugging surface. */
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

/** One Command per item, the Palette lists the same ones — one implementation, two surfaces. */
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
