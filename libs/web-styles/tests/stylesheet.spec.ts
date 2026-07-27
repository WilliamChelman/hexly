import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/postcss';
import postcss from 'postcss';
import { DESIGN_TOKENS, designToken } from '../src/tokens/manifest';

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

/*
 * The tier fence over stylesheets (ADR-0075). `hexly-design/*` is an ESLint plugin scoped to
 * `**\/*.ts`, so the sheets where tier 1 and tier 3 actually live were never read by it — the fence
 * held on the TypeScript side of a boundary whose CSS side is the one that declares it.
 */

/** The sheets that may name a `--palette-*` anchor: tier 1's own, and the derivation that reads it. */
const TIER_ONE_SHEETS = ['libs/web-styles/src/tokens.css', 'libs/web-styles/src/index.css'];

/** Tailwind's own custom properties, which the manifest does not declare and does not own (ADR-0030). */
const FOREIGN_PREFIXES = ['--tw-', '--spacing'];

function stylesheets(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') walk(path);
      else if (entry.name.endsWith('.css')) found.push(path);
    }
  };
  walk(join(workspaceRoot, 'apps'));
  walk(join(workspaceRoot, 'libs'));
  // Generated from the manifest, so it restates every name by construction (`property-block.spec.ts`).
  return found.filter((file) => !file.endsWith('design-token-properties.css'));
}

/** The plugin whose tier-3 vocabulary a sheet may use, mirroring the ESLint rule's own path match. */
function owningPlugin(file: string): string | null {
  return /(?:^|\/)libs\/plugin-([a-z0-9-]+?)(?:-server|-web)?\//.exec(file.replaceAll('\\', '/'))?.[1] ?? null;
}

describe('the tier fence over stylesheets', () => {
  const sheets = stylesheets().map((file) => ({
    rel: relative(workspaceRoot, file).replaceAll('\\', '/'),
    // Comments carry example `var(--…)` spellings and prose about anchors; neither is a reference.
    css: readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' '),
  }));

  const references = sheets.flatMap(({ rel, css }) =>
    [...css.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g)].map((match) => ({ rel, name: match[1] })),
  );

  it('reads at least one reference out of every sheet that has them', () => {
    expect(sheets.length).toBeGreaterThan(3);
    expect(references.length).toBeGreaterThan(20);
  });

  it('references no token the manifest does not declare', () => {
    const unknown = references.filter(
      ({ name }) =>
        !designToken(name) && !name.startsWith('--_') && !FOREIGN_PREFIXES.some((pre) => name.startsWith(pre)),
    );
    expect(unknown).toEqual([]);
  });

  it('keeps the Palette anchors to tier 1 and the derivation that reads them', () => {
    const leaked = references.filter(
      ({ rel, name }) => name.startsWith('--palette-') && !TIER_ONE_SHEETS.includes(rel),
    );
    expect(leaked).toEqual([]);
  });

  it("leaves each plugin's own vocabulary to the plugin that owns it", () => {
    const foreign = references.filter(({ rel, name }) => {
      const decl = designToken(name);
      return decl?.tier === 'plugin' && decl.owner !== owningPlugin(rel);
    });
    expect(foreign).toEqual([]);
  });

  it('takes only corner and elevation steps the manifest declares', () => {
    const steps = (prefix: string) =>
      new Set(
        DESIGN_TOKENS.map((decl) => decl.name)
          .filter((name) => name.startsWith(prefix))
          .map((name) => name.slice(prefix.length)),
      );
    const radii = steps('--radius-');
    const shadows = steps('--shadow-');

    const offScale = sheets.flatMap(({ rel, css }) =>
      [...css.matchAll(/@apply\s+([^;}]+)/g)]
        .flatMap((match) => match[1].split(/\s+/))
        .map((cls) => cls.replace(/^[a-z-]+:/, '').replace(/!$/, ''))
        .filter((cls) => {
          if (cls.includes('[')) return false; // a bracket is a stated choice, as in `no-builtin-radius`
          const radius = /^rounded(?:-(?:s|e|t|r|b|l|ss|se|ee|es|tl|tr|br|bl))?(?:-(.+))?$/.exec(cls);
          if (radius) return radius[1] !== 'none' && !radii.has(radius[1] ?? '');
          if (!/^shadow(-|$)/.test(cls)) return false;
          const step = cls.slice('shadow-'.length);
          return cls !== 'shadow-none' && !shadows.has(step);
        })
        .map((cls) => `${rel}: ${cls}`),
    );
    expect(offScale).toEqual([]);
  });
});

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
