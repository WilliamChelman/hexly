import { BUILT_IN_KINDS } from './field-data-type';
import { pluginSourceLabel } from './source-label';

/** One selectable data type: its `kind`, a display `label`, a `glyph` badge, and its `source` (built-in or plugin). */
export interface DataTypeChoice {
  kind: string;
  label: string;
  glyph: string;
  source: string;
}

/** A built-in Data Type's badge glyph — our Lucide set has no number/date glyph, so a mono char reads it. */
const BUILT_IN_GLYPHS: Record<string, string> = {
  string: 'Aa',
  number: '#',
  boolean: '✓',
  date: '◷',
  enum: '☰',
};

/**
 * The Data-Type cards the code-less forms offer (#191, #230): the built-ins first, then each enabled
 * plugin's Structured Data Type, and — when editing — any `unoffered` kind the form can't author
 * (a `list`/`entityLink`, or a dropped plugin's kind) so the card isn't lost on a round trip. `label`
 * resolves a built-in under `builtInPrefix` and a structured one via its `labelKey`; `translate` and
 * `sourceLabels` are supplied by the host so this stays free of a transloco dependency.
 */
export function dataTypeChoices(args: {
  structured: readonly { kind: string; labelKey: string }[];
  unoffered?: string | null;
  translate: (key: string) => string;
  builtInPrefix: string;
  sourceBuiltIn: string;
}): DataTypeChoice[] {
  const { structured, unoffered, translate, builtInPrefix, sourceBuiltIn } = args;
  const choices: DataTypeChoice[] = BUILT_IN_KINDS.map((kind) => ({
    kind,
    label: translate(`${builtInPrefix}.${kind}`),
    glyph: BUILT_IN_GLYPHS[kind] ?? '◆',
    source: sourceBuiltIn,
  }));
  for (const s of structured) {
    choices.push({ kind: s.kind, label: translate(s.labelKey), glyph: '◆', source: pluginSourceLabel(s.kind) });
  }
  if (unoffered) {
    choices.push({ kind: unoffered, label: unoffered, glyph: '◆', source: pluginSourceLabel(unoffered) });
  }
  return choices;
}
