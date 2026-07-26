import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/postcss';
import postcss from 'postcss';

/*
 * The `@source` list in apps/web/src/styles.css is the build's whole scan set (#359).
 *
 * This file sits outside `src/` so the globs it asserts do not reach it: a spec naming a class from
 * inside the scanned tree would make Tailwind generate that class and pass itself. It reads far
 * outside its own project, which is why the `test` target restates its inputs (project.json).
 */

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const stylesheet = join(workspaceRoot, 'apps/web/src/styles.css');

/** Mirrors the extensions the `@source` globs name. */
const SCANNED_EXTENSION = /\.(ts|html)$/;

function templatesUnder(dir: string, found: string[] = []): string[] {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) templatesUnder(path, found);
    else if (SCANNED_EXTENSION.test(entry.name)) found.push(path);
  }
  return found;
}

/**
 * Every file that can hold markup the browser renders, found through the Nx `scope:web` tag rather
 * than through the `@source` globs — asserting the globs against a restatement of the globs would
 * prove nothing, and the tag is what a newly generated library carries.
 */
function browserTemplates(): string[] {
  const libs = join(workspaceRoot, 'libs');
  const scoped = readdirSync(libs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(libs, entry.name, 'project.json')))
    .filter((entry) => {
      const project = JSON.parse(readFileSync(join(libs, entry.name, 'project.json'), 'utf8'));
      return (project.tags ?? []).includes('scope:web');
    })
    .map((entry) => join(libs, entry.name, 'src'));
  return [join(workspaceRoot, 'apps/web/src'), ...scoped].flatMap((source) => templatesUnder(source));
}

describe('the stylesheet the app builds', () => {
  let css: string;
  let scanned: Set<string>;

  beforeAll(async () => {
    // The one stylesheet there is: `apps/web/.postcssrc.json` runs this plugin over this entry, and
    // the Desktop App renders that build's output rather than a sheet of its own (ADR-0070).
    // `base` is the cwd `nx build web` leaves, and what automatic detection would walk from.
    const built = await postcss([tailwindcss({ base: workspaceRoot })]).process(readFileSync(stylesheet, 'utf8'), {
      from: stylesheet,
    });
    css = built.css;
    scanned = new Set(
      built.messages
        .filter((message) => message.type === 'dependency')
        .map((message) => String(message['file']))
        .filter((file) => SCANNED_EXTENSION.test(file)),
    );
  }, 60_000);

  it('generates a utility class only a plugin template uses', () => {
    // `object-contain` fits plugin-asset-web's image preview and appears in no library outside the
    // plugins; the first assertion is what keeps the second one meaningful.
    const pluginOnly = 'object-contain';
    const users = browserTemplates()
      .filter((file) => new RegExp(`(?<![\\w-])${pluginOnly}(?![\\w-])`).test(readFileSync(file, 'utf8')))
      .map((file) => relative(workspaceRoot, file));

    expect(users.filter((file) => !file.startsWith('libs/plugin-'))).toEqual([]);
    expect(css).toContain(`.${pluginOnly}`);
  });

  it('scans every browser library for the classes its templates use', () => {
    const unscanned = browserTemplates()
      .filter((file) => !scanned.has(file))
      .map((file) => relative(workspaceRoot, file));

    expect(unscanned).toEqual([]);
  });

  it('scans nothing but those libraries', () => {
    // Automatic detection used to cover the plugin libraries no `@source` named, which would hide
    // the miss the test above looks for.
    const browser = new Set(browserTemplates());

    const strays = [...scanned].filter((file) => !browser.has(file)).map((file) => relative(workspaceRoot, file));

    expect(strays).toEqual([]);
  });
});
