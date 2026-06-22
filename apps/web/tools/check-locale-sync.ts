/**
 * CI key-sync gate (issue #50): fail when the locale catalogs drift.
 *
 * English is the source of truth and fallback (ADR-0014); a missing translation
 * degrades gracefully at runtime, but here in CI we are strict — any key present
 * in one catalog and absent from another (missing *or* orphaned) fails the
 * build, so translations can never silently rot. Every `*.json` catalog in the
 * i18n dir is compared against `en.json`, so adding a third locale is guarded
 * automatically. This is a guardrail, not a "no hardcoded string" lint rule: it
 * only compares each catalog's key set against the reference.
 *
 * Run via the `web:i18n-sync` Nx target (which type-checks then jiti-executes
 * this TS).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { findKeyDrift } from '../src/app/core/i18n/locale-key-sync';

/** English is the source of truth and fallback (ADR-0014). */
const REFERENCE_LOCALE = 'en';

const I18N_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'assets',
  'i18n',
);

function load(locale: string): Record<string, unknown> {
  const file = join(I18N_DIR, `${locale}.json`);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(
      `✘ Could not read ${locale}.json: ${(error as Error).message}`,
    );
    process.exit(1);
  }
}

/** Locale codes for every `<code>.json` catalog in the i18n dir. */
function discoverLocales(): string[] {
  return readdirSync(I18N_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length));
}

const targets = discoverLocales().filter(
  (locale) => locale !== REFERENCE_LOCALE,
);

if (targets.length === 0) {
  console.warn(
    `⚠ No catalogs besides ${REFERENCE_LOCALE}.json found in ${I18N_DIR}; nothing to compare.`,
  );
  process.exit(0);
}

const reference = load(REFERENCE_LOCALE);
let drifted = false;

for (const locale of targets) {
  const drift = findKeyDrift(reference, load(locale));

  if (drift.inSync) {
    console.log(
      `✔ i18n key sync: ${locale}.json matches ${REFERENCE_LOCALE}.json.`,
    );
    continue;
  }

  drifted = true;
  console.error(
    `✘ i18n key drift between ${REFERENCE_LOCALE}.json and ${locale}.json:\n`,
  );
  if (drift.missing.length) {
    console.error(
      `  Missing in ${locale}.json (present in ${REFERENCE_LOCALE}.json):`,
    );
    for (const key of drift.missing) console.error(`    - ${key}`);
  }
  if (drift.orphaned.length) {
    console.error(
      `  Orphaned in ${locale}.json (absent from ${REFERENCE_LOCALE}.json):`,
    );
    for (const key of drift.orphaned) console.error(`    - ${key}`);
  }
  console.error('');
}

if (drifted) {
  console.error(
    `Add or remove the keys above so every catalog matches ${REFERENCE_LOCALE}.json.`,
  );
  process.exit(1);
}

process.exit(0);
