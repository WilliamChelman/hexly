import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, INSTALLER_SUFFIX, packageOutput, packagedApp, test } from './packaged-app';

/**
 * The post-package smoke check (#327): the artifact electron-builder just produced, opened and actually used.
 *
 * The native modules are the packaging risk (ADR-0070), the image library worst of all — a wrong prebuild
 * surfaces during thumbnailing rather than at build time, so a package can report success and be broken. One
 * test, since these facts share the one boot.
 */

/** A real 20×8 PNG: small, but something libvips genuinely parses. */
const PNG_20x8 =
  'iVBORw0KGgoAAAANSUhEUgAAABQAAAAICAIAAAB2/0i6AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVQYlWOwyTtBNmIY1XxiiAQYACBM50E1XKcYAAAAAElFTkSuQmCC';

/** Only what this check reads: e2e projects hold no import of `@hexly/domain`. */
interface UploadedAsset {
  readonly document: Record<
    string,
    {
      readonly hash: string;
      readonly stats: { width: number; height: number; orientation: string; dominantColor: string } | null;
    }
  >;
}

test('the packaged app opens on its Worlds, creates one, thumbnails an image and hashes a password', async ({
  launch,
  userDataDir,
}) => {
  // Nothing cleans `dist/desktop`, so a previous build's installer would otherwise answer for this one. The rest
  // drives the unpacked bundle instead: a build must not mount a dmg or run an installer on a machine.
  const installers = readdirSync(packageOutput).filter((name) => name.endsWith(INSTALLER_SUFFIX));
  const packagedAt = statSync(packagedApp).mtimeMs;
  expect(installers.filter((name) => statSync(join(packageOutput, name)).mtimeMs >= packagedAt)).not.toEqual([]);

  const { app, window } = await launch();

  // A package and not the bundle the rest of the suite launches — otherwise every assertion below is vacuous.
  expect(await app.evaluate(({ app: electron }) => electron.isPackaged)).toBe(true);

  // Main mints the Sole User's session into the renderer's jar before `loadURL`, so no login form.
  await window.waitForURL(/\/worlds$/);
  await expect(window.getByTestId('worlds-empty')).toBeVisible();
  await expect(window.getByLabel('Password')).toHaveCount(0);

  // A write through the app's own affordance, rather than a schema read, is what proves the SQLite binding
  // rebuilt for Electron's ABI opened a database and ran migrations (ADR-0027).
  const created = window.waitForResponse((r) => r.url().endsWith('/api/worlds') && r.request().method() === 'POST');
  await window.getByTestId('create-world').click();
  const response = await created;
  expect(response.ok(), `${response.status()} ${await response.text()}`).toBe(true);
  const world = (await response.json()) as { id: string };
  // Under the run's own `--user-data-dir`, since a smoke check must not write into a real Instance.
  expect(existsSync(join(userDataDir, 'hexly', 'hexly.db'))).toBe(true);

  // `stats` comes from libvips: a wrong `@img` prebuild, or a dylib that did not come along, fails right here.
  const asset = await window.evaluate(
    async ([worldId, base64]) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const body = new FormData();
      body.append('file', new File([bytes], 'sigil.png', { type: 'image/png' }));
      const res = await fetch(`/api/worlds/${worldId}/assets`, { method: 'POST', body });
      if (!res.ok) throw new Error(`the upload failed: ${res.status} ${await res.text()}`);
      return (await res.json()) as UploadedAsset;
    },
    [world.id, PNG_20x8],
  );

  const ref = asset.document['core.field.asset'];
  expect(ref.stats).toMatchObject({ width: 20, height: 8, orientation: 'landscape' });
  expect(ref.stats?.dominantColor).toMatch(/^#[0-9a-f]{6}$/);

  const thumbnail = await window.evaluate(async (url) => {
    const res = await fetch(url);
    return { status: res.status, type: res.headers.get('content-type'), bytes: (await res.blob()).size };
  }, `/assets/${world.id}/${ref.hash}.thumb.webp`);
  // Serving falls back to the original bytes when no thumbnail was stored (#325), so a 200 alone would pass with
  // thumbnailing completely broken.
  expect(thumbnail.status).toBe(200);
  expect(thumbnail.type).toBe('image/webp');
  expect(thumbnail.bytes).toBeGreaterThan(0);

  // `require` is not in scope inside an evaluated function, but `process.mainModule` is main.js itself — so this
  // is the resolution the API's own imports go through.
  const argon2 = await app.evaluate(async (_electron, password) => {
    const { hash, verify } = process.mainModule?.require('@node-rs/argon2') as typeof import('@node-rs/argon2');
    const digest = await hash(password);
    return { digest, matches: await verify(digest, password), rejects: await verify(digest, 'a different password') };
  }, 'a password nothing in this app has');
  expect(argon2.digest).toMatch(/^\$argon2id\$/);
  expect(argon2.matches).toBe(true);
  expect(argon2.rejects).toBe(false);

  // `yaml` is required at runtime (#326) rather than bundled, so only electron-builder's dependency pruning keeps
  // it in the archive.
  const yaml = await app.evaluate(() => typeof (process.mainModule?.require('yaml') as typeof import('yaml')).parse);
  expect(yaml).toBe('function');
});
