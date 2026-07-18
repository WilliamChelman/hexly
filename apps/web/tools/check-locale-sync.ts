/**
 * CI key-sync gate: fail when the locale catalogs drift, or when two projects claim the same slice
 * of the key space. Every project owns its own catalogs (ADR-0049) — the app's root one, and one or
 * more scoped catalogs per lib. Compares key sets and owners only. Run via the `web:i18n-sync` Nx target.
 *
 * **Parity.** Each locale is compared against its catalog's `en.json` (ADR-0014); a key missing
 * *or* orphaned relative to the reference fails the build.
 *
 * **Ownership.** A loaded scope is flattened into the active language under its scope name, so
 * scopes and the root namespaces share one key space: a `map` scope and a root `map.*` namespace
 * would answer the same key, and load order would decide the winner. No two projects may claim one
 * prefix.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// Direct file import (not the @hexly/web-core barrel) keeps this jiti-run CI tool
// off the Angular services layer the barrel re-exports — findKeyDrift is a pure util.
// The nx module-boundary rule is waived for these two pure utils via eslint.config.mjs `allow`.
import { findKeyDrift } from '../../../libs/web-core/src/i18n/locale-key-sync';

/** English is the source of truth and fallback (ADR-0014). */
const REFERENCE_LOCALE = 'en';

const WORKSPACE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LIBS_DIR = join(WORKSPACE_ROOT, 'libs');
const APP_CATALOGS = join(WORKSPACE_ROOT, 'apps', 'web', 'src', 'i18n', 'catalogs');

/** A catalog dir plus the scope it answers under — `undefined` for the app's root catalog. */
interface Catalog {
  readonly project: string;
  readonly dir: string;
  readonly scope?: string;
}

/**
 * A lib declares each scope in a `TranslationScope` beside its catalogs, one per `*-translations.ts`
 * file, pairing the scope name with the catalog dir its loader imports from. A declaration missing
 * either — no scope, or a loader pointing nowhere — is a bug: its copy could never be loaded. A lib
 * may own more than one scope (web-entity owns `fields` and `collab`), each in its own file and dir.
 */
function readCatalogs(i18nDir: string, project: string): Catalog[] {
  const declarations = readdirSync(i18nDir).filter((name) => name.endsWith('-translations.ts'));
  return declarations.map((name) => {
    const source = readFileSync(join(i18nDir, name), 'utf8');
    const scopes = [...source.matchAll(/scope:\s*'([^']+)'/g)].map((match) => match[1]);
    // The catalog dir is whatever the loader's dynamic `import('./<dir>/<locale>.json')` points at.
    const dirs = [...new Set([...source.matchAll(/import\(\s*'\.\/([^'/]+)\/[^']*\.json'/g)].map((match) => match[1]))];

    if (scopes.length !== 1 || dirs.length !== 1) {
      console.error(
        `✘ ${project}: expected exactly one scope and one catalog dir in ${join(i18nDir, name)}, ` +
          `found scope(s) [${scopes.join(', ')}] and dir(s) [${dirs.join(', ')}]`,
      );
      process.exit(1);
    }
    return { project, dir: join(i18nDir, dirs[0]), scope: scopes[0] };
  });
}

function discoverCatalogs(): Catalog[] {
  const libs = readdirSync(LIBS_DIR)
    .map((project) => ({ project, i18n: join(LIBS_DIR, project, 'src', 'i18n') }))
    .filter(({ i18n }) => existsSync(i18n) && readdirSync(i18n).some((name) => name.endsWith('-translations.ts')))
    .flatMap(({ project, i18n }) => readCatalogs(i18n, project));

  return [{ project: 'web', dir: APP_CATALOGS }, ...libs];
}

function load(catalog: Catalog, locale: string): Record<string, unknown> {
  const file = join(catalog.dir, `${locale}.json`);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`✘ ${catalog.project}: could not read ${locale}.json: ${(error as Error).message}`);
    process.exit(1);
  }
}

/** Locale codes for every `<code>.json` catalog in a catalog dir. */
function discoverLocales(catalog: Catalog): string[] {
  return readdirSync(catalog.dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length));
}

const catalogs = discoverCatalogs();
let failed = false;

// --- Parity: every locale of a catalog must carry exactly the reference's keys. -----------------
for (const catalog of catalogs) {
  const label = catalog.scope ? `${catalog.project} (scope '${catalog.scope}')` : `${catalog.project} (root)`;
  const targets = discoverLocales(catalog).filter((locale) => locale !== REFERENCE_LOCALE);

  if (targets.length === 0) {
    console.warn(`⚠ ${label}: no catalogs besides ${REFERENCE_LOCALE}.json; nothing to compare.`);
    continue;
  }

  const reference = load(catalog, REFERENCE_LOCALE);

  for (const locale of targets) {
    const drift = findKeyDrift(reference, load(catalog, locale));

    if (drift.inSync) {
      console.log(`✔ ${label}: ${locale}.json matches ${REFERENCE_LOCALE}.json.`);
      continue;
    }

    failed = true;
    console.error(`✘ ${label}: key drift between ${REFERENCE_LOCALE}.json and ${locale}.json:\n`);
    if (drift.missing.length) {
      console.error(`  Missing in ${locale}.json (present in ${REFERENCE_LOCALE}.json):`);
      for (const key of drift.missing) console.error(`    - ${key}`);
    }
    if (drift.orphaned.length) {
      console.error(`  Orphaned in ${locale}.json (absent from ${REFERENCE_LOCALE}.json):`);
      for (const key of drift.orphaned) console.error(`    - ${key}`);
    }
    console.error('');
  }
}

// --- Ownership: one owner per prefix, across every scope and the root catalog. -------------------
const owners = new Map<string, string>();

for (const namespace of Object.keys(load({ project: 'web', dir: APP_CATALOGS }, REFERENCE_LOCALE))) {
  owners.set(namespace, 'web (root)');
}

for (const catalog of catalogs) {
  if (!catalog.scope) continue;
  const existing = owners.get(catalog.scope);
  if (existing) {
    failed = true;
    console.error(
      `✘ ${catalog.project}: scope '${catalog.scope}' collides with keys already owned by ${existing}. ` +
        `Scopes are flattened into the same key space as the root catalog, so a prefix can have only one owner.`,
    );
    continue;
  }
  owners.set(catalog.scope, catalog.project);
}

if (!failed) {
  console.log(`✔ i18n ownership: ${owners.size} namespaces, each claimed by exactly one project.`);
}

process.exit(failed ? 1 : 0);
