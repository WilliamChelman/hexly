import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, INSTALLER_SUFFIX, packageOutput, packagedApp, test } from './packaged-app';

/**
 * The post-package smoke check (#327): the artifact electron-builder just produced, opened and actually used.
 *
 * Everything here is a fact a *build* cannot tell you. The native modules are the packaging risk (ADR-0070),
 * and the image library is the worst of them — its prebuilds and its libvips live in sibling packages, and
 * getting them wrong surfaces during thumbnailing rather than at build time, so a package can report complete
 * success and be broken. Hence one launch that opens the database, writes to it, thumbnails an image and
 * hashes a password, rather than a check that the window appears.
 *
 * Deliberately one test: a launch boots Nest and runs migrations, and these facts share the one boot rather
 * than paying for it four times.
 */

/** A real 20×8 PNG, as the browser suite uses — small, and something libvips genuinely parses. */
const PNG_20x8 =
  'iVBORw0KGgoAAAANSUhEUgAAABQAAAAICAIAAAB2/0i6AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVQYlWOwyTtBNmIY1XxiiAQYACBM50E1XKcYAAAAAElFTkSuQmCC';

/** Only the parts of the upload response this check reads: e2e projects hold no import of `@hexly/domain`. */
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
  // The installable artifact itself, and no older than the bundle it carries: nothing cleans `dist/desktop`, so
  // a previous build's installer would otherwise answer for this one. What the rest of this test drives is that
  // bundle, since mounting a dmg or running an NSIS installer is not something a build should do to a machine.
  const installers = readdirSync(packageOutput).filter((name) => name.endsWith(INSTALLER_SUFFIX));
  const packagedAt = statSync(packagedApp).mtimeMs;
  expect(installers.filter((name) => statSync(join(packageOutput, name)).mtimeMs >= packagedAt)).not.toEqual([]);

  const { app, window } = await launch();

  // A package and not the bundle the rest of the suite launches — otherwise every assertion below is vacuous.
  expect(await app.evaluate(({ app: electron }) => electron.isPackaged)).toBe(true);

  // Logs in nobody: main mints the Sole User's session into the renderer's jar before `loadURL`, so the first
  // rendered surface is the World Index and not a login form.
  await window.waitForURL(/\/worlds$/);
  await expect(window.getByTestId('worlds-empty')).toBeVisible();
  await expect(window.getByLabel('Password')).toHaveCount(0);

  // The SQLite binding, rebuilt for Electron's ABI, opened a database and ran migrations (ADR-0027) — asserted
  // by writing through the app's own Create affordance rather than by reading the schema.
  const created = window.waitForResponse((r) => r.url().endsWith('/api/worlds') && r.request().method() === 'POST');
  await window.getByTestId('create-world').click();
  const response = await created;
  expect(response.ok(), `${response.status()} ${await response.text()}`).toBe(true);
  const world = (await response.json()) as { id: string };
  // Written to `<userData>/hexly`, which for an unflagged launch is the platform's application-support folder.
  // This run passes `--user-data-dir` instead, since a smoke check must not write into a real Instance.
  expect(existsSync(join(userDataDir, 'hexly', 'hexly.db'))).toBe(true);

  // The image library, in the packaged app, on a real image. `stats` comes from libvips: an `@img` prebuild
  // left inside the archive, or a libvips dylib that did not come along, fails right here.
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
  // `image/webp` rather than merely a 200: serving falls back to the original bytes when no thumbnail was
  // stored (#325), so a status alone would pass with thumbnailing completely broken.
  expect(thumbnail.status).toBe(200);
  expect(thumbnail.type).toBe('image/webp');
  expect(thumbnail.bytes).toBeGreaterThan(0);

  // Password hashing, asserted rather than assumed: the argon2 binding is napi-rs and ABI-stable, so it
  // *generally* rides along (ADR-0070). `require` is not in scope inside an evaluated function, but
  // `process.mainModule` is main.js itself — so this is the resolution the API's own imports go through.
  const argon2 = await app.evaluate(async (_electron, password) => {
    const { hash, verify } = process.mainModule?.require('@node-rs/argon2') as typeof import('@node-rs/argon2');
    const digest = await hash(password);
    return { digest, matches: await verify(digest, password), rejects: await verify(digest, 'a different password') };
  }, 'a password nothing in this app has');
  expect(argon2.digest).toMatch(/^\$argon2id\$/);
  expect(argon2.matches).toBe(true);
  expect(argon2.rejects).toBe(false);

  // `yaml` is imported by main at runtime (#326) rather than bundled, so electron-builder's dependency pruning
  // is the only thing keeping it in the archive — and a missing one only shows up when Assets are moved.
  const yaml = await app.evaluate(() => typeof (process.mainModule?.require('yaml') as typeof import('yaml')).parse);
  expect(yaml).toBe('function');
});
