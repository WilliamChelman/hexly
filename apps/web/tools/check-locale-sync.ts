/**
 * CI key-sync gate (issue #50): fail when `en.json` and `fr.json` drift.
 *
 * English is the source of truth and fallback (ADR-0014); a missing French key
 * degrades gracefully at runtime, but here in CI we are strict — any key present
 * in one catalog and absent from the other (missing *or* orphaned) fails the
 * build, so translations can never silently rot. This is a guardrail, not a
 * "no hardcoded string" lint rule: it only compares the two catalogs' key sets.
 *
 * Run via the `web:i18n-sync` Nx target (which invokes jiti to execute this TS).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { findKeyDrift } from '../src/app/core/i18n/locale-key-sync';

const I18N_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'assets',
  'i18n',
);

function load(lang: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(I18N_DIR, `${lang}.json`), 'utf8'));
}

const drift = findKeyDrift(load('en'), load('fr'));

if (drift.inSync) {
  console.log('✔ i18n key sync: en.json and fr.json are in sync.');
  process.exit(0);
}

console.error('✘ i18n key drift detected between en.json and fr.json:\n');
if (drift.missingInFr.length) {
  console.error('  Missing in fr.json (present in en.json):');
  for (const key of drift.missingInFr) console.error(`    - ${key}`);
}
if (drift.missingInEn.length) {
  console.error('  Orphaned in fr.json (absent from en.json):');
  for (const key of drift.missingInEn) console.error(`    - ${key}`);
}
console.error('\nAdd or remove the keys above so both catalogs match.');
process.exit(1);
