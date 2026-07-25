import type { ElectronApplication } from '@playwright/test';
import { clickMenuItem, expect, test } from './desktop-app';

/** One menu item, as much of it as survives the trip out of the main process. */
interface ItemSnapshot {
  readonly id: string;
  readonly label: string;
  readonly role: string | undefined;
  readonly accelerator: string | undefined;
  readonly registersAccelerator: boolean;
}

interface MenuSnapshot {
  readonly label: string;
  readonly items: readonly ItemSnapshot[];
}

/** The menu Electron actually built, not the template — `apps/desktop/src/menu.spec.ts` covers the template. */
function readMenu(app: ElectronApplication): Promise<readonly MenuSnapshot[]> {
  return app.evaluate(({ Menu }) =>
    (Menu.getApplicationMenu()?.items ?? []).map((item) => ({
      label: item.label,
      items: (item.submenu?.items ?? []).map((sub) => ({
        id: sub.id,
        label: sub.label,
        role: sub.role,
        accelerator: sub.accelerator,
        registersAccelerator: sub.registerAccelerator,
      })),
    })),
  );
}

/**
 * The items whose action lives in the renderer, so must never bind a chord; ids restated because a spec here
 * cannot import from another app's source.
 */
const DISPATCHED_ITEMS = ['open-command-palette', 'go-worlds'];

/** Roles that must reach the platform with a chord; lower-cased, as Electron lower-cases a role it builds. */
const NATIVE_CHORDS = [
  'cut',
  'copy',
  'paste',
  'selectall',
  'undo',
  'redo',
  'reload',
  'forcereload',
  'toggledevtools',
  'resetzoom',
  'zoomin',
  'zoomout',
  'minimize',
  'close',
  'quit',
];

function itemsOf(menu: readonly MenuSnapshot[], label: string): readonly ItemSnapshot[] {
  const found = menu.find((m) => m.label === label);
  if (!found) throw new Error(`No "${label}" menu in ${menu.map((m) => m.label).join(', ')}`);
  return found.items;
}

function everyItem(menu: readonly MenuSnapshot[]): readonly ItemSnapshot[] {
  return menu.flatMap((m) => m.items);
}

/**
 * The fact only a shell can show: the chord displayed for an in-app action is not bound to the OS, so the
 * dispatcher still owns it (ADR-0070; `apps/desktop/src/menu.ts` states why).
 */
test('the menu displays the Palette chord without registering it, and leaves the native roles registered', async ({
  launch,
}) => {
  const run = await launch();
  const menu = await readMenu(run.app);

  // The app menu is macOS's, and only macOS's.
  expect(menu.map((m) => m.label)).toEqual(
    process.platform === 'darwin'
      ? ['Hexly', 'File', 'Edit', 'View', 'Go', 'Window']
      : ['File', 'Edit', 'View', 'Go', 'Window'],
  );

  const palette = everyItem(menu).find((item) => item.id === 'open-command-palette');
  expect(palette?.accelerator).toBe('CmdOrCtrl+K');
  expect(palette?.registersAccelerator).toBe(false);

  const dispatched = everyItem(menu).filter((item) => DISPATCHED_ITEMS.includes(item.id));
  expect(dispatched.map((item) => `${item.id}: ${item.registersAccelerator}`)).toEqual([
    'open-command-palette: false',
    'go-worlds: false',
  ]);

  // On macOS this menu is what makes cut/copy/paste work inside web content at all. Every occurrence, since
  // `close` sits in two menus.
  const chordless = NATIVE_CHORDS.filter((role) => {
    const items = everyItem(menu).filter((item) => item.role === role);
    return !items.length || items.some((item) => !item.accelerator);
  });
  expect(chordless).toEqual([]);

  // Not clicked: that opens a file manager over the run.
  const reveal = itemsOf(menu, 'File').find((item) => item.id === 'reveal-data-folder');
  expect(reveal?.label).toMatch(/Data Folder/);

  // Main performs New Window itself, so its chord *is* bound: the renderer's dispatcher never claimed it.
  const newWindow = itemsOf(menu, 'File').find((item) => item.id === 'new-window');
  expect(newWindow?.accelerator).toBe('CmdOrCtrl+Shift+N');
  expect(newWindow?.registersAccelerator).toBe(true);
});

test('the displayed chord dispatches in the renderer, and the menu item runs the same Command', async ({ launch }) => {
  const run = await launch();
  await run.window.waitForURL(/\/worlds$/);
  // Rendered, not merely routed: a keydown sent before the SPA is listening is simply dropped.
  await expect(run.window.getByTestId('worlds-empty')).toBeVisible();

  // Playwright delivers this keydown straight to the page, so it proves only that the dispatcher answers the
  // chord; the modal/editable gating is `shortcut.service.spec.ts` (ADR-0063).
  await run.window.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await expect(run.window.getByTestId('command-palette-input')).toBeVisible();
  await run.window.keyboard.press('Escape');
  await expect(run.window.getByTestId('command-palette-input')).toBeHidden();

  await clickMenuItem(run.app, 'open-command-palette');
  await expect(run.window.getByTestId('command-palette-input')).toBeVisible();
  await run.window.keyboard.press('Escape');

  // From somewhere else first, so the navigation is a claim worth making.
  await run.window.goto(`${run.origin}/settings`);
  await expect(run.window.getByTestId('theme-light')).toBeVisible();

  await clickMenuItem(run.app, 'go-worlds');

  await expect(run.window).toHaveURL(/\/worlds$/);
});

test('the bridge hands the renderer the menu channel, unsubscribe included', async ({ launch }) => {
  const { window } = await launch();

  // A returned function survives the trip out of the preload world only because `contextBridge` proxies it, and
  // nothing else in the bridge does this.
  const unsubscribeType = await window.evaluate(() => {
    const bridge = (globalThis as unknown as { hexly: { onMenuCommand(l: (id: string) => void): () => void } }).hexly;
    const stop = bridge.onMenuCommand(() => undefined);
    const type = typeof stop;
    stop();
    return type;
  });

  expect(unsubscribeType).toBe('function');
});
