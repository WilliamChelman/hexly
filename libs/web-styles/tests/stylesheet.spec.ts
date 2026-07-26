import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/postcss';
import postcss from 'postcss';

/*
 * The scan set the stylesheet declares is the whole scan set (#359), so these assertions are the
 * only thing standing between a plugin's templates and a build that never generates their classes.
 *
 * This file sits outside `src/` deliberately: the globs it asserts cover every browser library's
 * `src`, and a spec that named a class from inside the scanned tree would make Tailwind generate
 * that class and pass itself.
 */

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const stylesheet = join(workspaceRoot, 'apps/web/src/styles.css');

/** The two extensions every `@source` glob names. */
const TEMPLATE = /\.(ts|html)$/;

function templatesUnder(dir: string, found: string[] = []): string[] {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) templatesUnder(path, found);
    else if (TEMPLATE.test(entry.name)) found.push(path);
  }
  return found;
}

/**
 * The sources that hold markup the browser renders, read off the Nx `scope:web` tag rather than off
 * the `@source` globs — asserting the globs against a restatement of the globs would prove nothing,
 * and the tag is what a newly generated library carries.
 */
function browserSources(): string[] {
  const libs = join(workspaceRoot, 'libs');
  const scoped = readdirSync(libs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(libs, entry.name, 'project.json')))
    .filter((entry) => {
      const project = JSON.parse(readFileSync(join(libs, entry.name, 'project.json'), 'utf8'));
      return (project.tags ?? []).includes('scope:web');
    })
    .map((entry) => join(libs, entry.name, 'src'));
  return [join(workspaceRoot, 'apps/web/src'), ...scoped];
}

describe('the stylesheet the app builds', () => {
  let css: string;
  let scanned: Set<string>;

  beforeAll(async () => {
    // The real pipeline: `apps/web/.postcssrc.json` runs this same plugin over this same entry, and
    // the Desktop App renders that build's output rather than a stylesheet of its own (ADR-0070).
    // `base` is what `nx build web` leaves as the cwd; it is what automatic source detection would
    // walk, so pinning it is what makes this test see the build's scan set rather than vitest's.
    const built = await postcss([tailwindcss({ base: workspaceRoot })]).process(readFileSync(stylesheet, 'utf8'), {
      from: stylesheet,
    });
    css = built.css;
    scanned = new Set(
      built.messages
        .filter((message) => message.type === 'dependency')
        .map((message) => String(message['file']))
        .filter((file) => TEMPLATE.test(file)),
    );
  }, 60_000);

  it('generates a utility class only a plugin template uses', () => {
    // `object-contain` fits an image preview in plugin-asset-web and plugin-board-web and appears
    // nowhere else; the first assertion is what tells a later reader the second still means
    // something — if it fails, this test wants a different plugin-only class, not a waiver.
    const pluginOnly = 'object-contain';
    const users = browserSources()
      .flatMap((source) => templatesUnder(source))
      .filter((file) => new RegExp(`\\b${pluginOnly}\\b`).test(readFileSync(file, 'utf8')))
      .map((file) => relative(workspaceRoot, file));

    expect(users.filter((file) => !file.startsWith('libs/plugin-'))).toEqual([]);
    expect(css).toContain(`.${pluginOnly}`);
  });

  it('scans every browser library for the classes its templates use', () => {
    const expected = browserSources().flatMap((source) => templatesUnder(source));

    const unscanned = expected.filter((file) => !scanned.has(file)).map((file) => relative(workspaceRoot, file));

    expect(unscanned).toEqual([]);
  });

  it('scans nothing but those libraries', () => {
    // Automatic source detection walks the workspace from the build's cwd, which covered the plugin
    // libraries no `@source` named — coverage by accident, and it would hide the miss above.
    const expected = new Set(browserSources().flatMap((source) => templatesUnder(source)));

    const strays = [...scanned].filter((file) => !expected.has(file)).map((file) => relative(workspaceRoot, file));

    expect(strays).toEqual([]);
  });
});
