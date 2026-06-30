// @ts-check
/**
 * Generates the server-side JSON Schema backstop for the Entity `document` from the
 * single zod source of truth (`@hexly/domain`, ADR-0001/0032) and registers it in
 * `traildepot/config.textproto` as the named schema `entity_body`. The migration's
 * `CHECK(jsonschema('entity_body', document))` then makes a malformed body unwritable
 * at the DB layer — the backstop for the client-side zod validator, since TrailBase has
 * no write-path middleware (ADR-0032).
 *
 * Repeatable build step, never hand-maintained: the block lives between markers and is
 * rewritten wholesale on each run. Regenerate after any change to `entityBodySchema`:
 *
 *   pnpm gen:schema
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { entityBodySchema } from '../libs/domain/src/lib/entity';

const SCHEMA_NAME = 'entity_body';
const BEGIN = `# BEGIN GENERATED ${SCHEMA_NAME} schema — regenerate with \`pnpm gen:schema\` (do not edit by hand)`;
const END = `# END GENERATED ${SCHEMA_NAME} schema`;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(root, 'traildepot', 'config.textproto');

/** Escape a JSON string for a single-quoted textproto string literal (C-style escapes). */
function textprotoSingleQuoted(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

const json = JSON.stringify(z.toJSONSchema(entityBodySchema));
const literal = textprotoSingleQuoted(json);

// Self-check: the escaping must round-trip back to the exact schema JSON, or the CHECK
// silently enforces something other than the domain (a malformed body could slip through).
const unescaped = literal.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
if (unescaped !== json) throw new Error('[gen:schema] textproto escaping does not round-trip');

const block = `${BEGIN}\nschemas {\n  name: "${SCHEMA_NAME}"\n  schema: ${literal}\n}\n${END}`;

const config = readFileSync(configPath, 'utf8');
const region = new RegExp(`${escapeRe(BEGIN)}[\\s\\S]*?${escapeRe(END)}`);
const next = region.test(config)
  ? config.replace(region, block)
  : `${config.trimEnd()}\n\n${block}\n`;

writeFileSync(configPath, next);
console.error(`[gen:schema] Wrote ${SCHEMA_NAME} schema into ${configPath}`);

/** Escape a literal string for use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
