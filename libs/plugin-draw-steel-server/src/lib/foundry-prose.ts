/**
 * The Monsters importer's one **plain-text converter** (#258): the pure step that turns a Foundry HTML
 * field studded with Draw Steel enricher tokens into the prose a trait or biography reads. Every token the
 * Foundry client would render at display time is resolved *at import*, so an Entity Document never carries a
 * raw `[[…]]` / `{{…}}` / `@chr` token — the transform stays fixture-testable offline (ADR-0060/0061) rather
 * than deferring to a live Foundry enrich pass.
 *
 * The enricher rules mirror the Draw Steel system's own enrichers (`ds.apply`, `ds.potency`): a token with
 * an explicit `{label}` resolves to that label; a label-less `[[/apply …]]` humanizes to its condition plus
 * duration, or is dropped when it only names an effect by an id we cannot resolve here; `[[potency X N]]`
 * prints as `X < N`; and the `{{potency}}`/`{{forced}}`/`@chr` placeholders are substituted from the caller's
 * context (an ability supplies them; a trait or biography supplies none, so they drop rather than leak).
 */

import { Content, tiptapContent } from '@hexly/plugin-content';
import { DS_CONDITION_OPTIONS, DsCondition } from '@hexly/plugin-draw-steel';

/**
 * The ability-scoped values the `{{…}}`/`@chr` placeholders resolve against, matching the Draw Steel
 * enrichers' roll-data substitution. Traits and biographies pass none — the placeholders then drop, since a
 * potency/forced/characteristic only has meaning inside an ability's power roll (a later pass supplies them).
 */
export interface EnricherContext {
  readonly potency?: string;
  readonly forced?: string;
  readonly chr?: string;
}

/**
 * The effect-end tokens a `[[/apply cond dur]]` may carry, humanized exactly as the Draw Steel system's
 * `DRAW_STEEL.EDITOR.Enrichers.ApplyEffect.EffectEnds` localization prints them — so an imported trait reads
 * the same suffix a GM sees in Foundry.
 */
const EFFECT_ENDS: Readonly<Record<string, string>> = {
  save: '(save ends)',
  turn: '(EoT)',
  encounter: '(Encounter)',
  respite: '(Respite)',
};

const CONDITIONS = new Set<string>(DS_CONDITION_OPTIONS);

/**
 * Resolve one raw Foundry field to plain text: first the enricher tokens (so a `{label}` survives the HTML
 * strip as text), then the HTML structure down to paragraph (`\n\n`) and line (`\n`) breaks. Returns `''`
 * for blank or tagless-empty input, which is what lets a caller treat "no prose" as "omit the field".
 */
export function foundryProseToText(html: string, ctx: EnricherContext = {}): string {
  return htmlToText(resolveEnrichers(html, ctx));
}

/**
 * Fold a Foundry HTML field into a Content value's hand-built prose paragraphs (#258) — one paragraph node
 * per source paragraph, hard line breaks preserved. Returns `undefined` when the prose is empty, so an empty
 * biography contributes no `core.content` at all rather than an empty document.
 */
export function foundryProseToContent(html: string, ctx: EnricherContext = {}): Content | undefined {
  const text = foundryProseToText(html, ctx);
  if (!text) return undefined;
  const paragraphs = text.split('\n\n').map((block) => ({
    type: 'paragraph',
    content: lineNodes(block),
  }));
  return tiptapContent({ type: 'doc', content: paragraphs });
}

/** Split a paragraph's text on its hard breaks, so a `<br>` survives as a `hardBreak` node, not a lost newline. */
function lineNodes(block: string): { type: string; text?: string }[] {
  const nodes: { type: string; text?: string }[] = [];
  block.split('\n').forEach((line, index) => {
    if (index > 0) nodes.push({ type: 'hardBreak' });
    if (line) nodes.push({ type: 'text', text: line });
  });
  return nodes;
}

/**
 * Resolve the Draw Steel enricher tokens in order of specificity: labelled tokens first (the label is
 * authoritative), then the label-less `potency`/`apply` forms, then the substitution placeholders. Anything
 * still bracketed after that was an enricher we do not model — dropped, so no raw token survives.
 */
function resolveEnrichers(input: string, ctx: EnricherContext): string {
  let text = input;
  // The explicit `{label}` is authoritative — it wins over the token's inner path, which we never read.
  text = text.replace(/\[\[[^\]]*\]\]\{([^}]*)\}/g, '$1');
  // `[[potency M 3]]` → `M < 3`; the characteristic is the source roll key, printed uppercase.
  text = text.replace(/\[\[potency\s+([a-z]+)\s+(\d+)\s*\]\]/gi, (_m, chr: string, value: string) => {
    return `${chr.toUpperCase()} < ${value}`;
  });
  // A label-less apply: humanize when it names a known condition, else drop (an id we cannot resolve here).
  text = text.replace(/\[\[\/apply\s+([^\]]*)\]\]/gi, (_m, args: string) => humanizeApply(args));
  // Ability-scoped placeholders — substituted from the caller's context, or dropped so nothing leaks.
  text = text.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => contextValue(ctx, key));
  text = text.replace(/@chr\b/g, () => ctx.chr ?? '');
  // Any enricher shape we do not model is stripped rather than left as a visible token.
  text = text.replace(/\[\[[^\]]*\]\]/g, '');
  return text;
}

/** Map a `{{key}}` placeholder to its context value (`potency`/`forced`), or `''` when unsupplied. */
function contextValue(ctx: EnricherContext, key: string): string {
  if (key === 'potency') return ctx.potency ?? '';
  if (key === 'forced') return ctx.forced ?? '';
  return '';
}

/**
 * Humanize a label-less `[[/apply …]]`: from its space-separated arguments, take the first known condition
 * as the name and any effect-end token as the duration suffix. With no condition — only an unresolvable
 * effect id — the whole token drops, mirroring the system enricher returning nothing when it cannot link.
 */
function humanizeApply(args: string): string {
  const values = args.trim().split(/\s+/).filter(Boolean);
  const condition = values.find((value): value is DsCondition => CONDITIONS.has(value.toLowerCase()));
  if (!condition) return '';
  const end = values.map((value) => EFFECT_ENDS[value.toLowerCase()]).find(Boolean);
  return end ? `${condition} ${end}` : condition;
}

/**
 * Collapse Foundry HTML to plain text, keeping only paragraph and line structure. Block boundaries become a
 * blank line, `<br>` a single newline, every other tag is unwrapped, and named/numeric entities are decoded;
 * runs of whitespace and blank lines are then normalized so the output is clean prose.
 */
function htmlToText(html: string): string {
  const BLOCK = /<\/(?:p|div|h[1-6]|li|dd|dt|dl|ul|ol|tr|table|blockquote|section|header|footer)>/gi;
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(BLOCK, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;|&rsquo;/gi, "'")
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)));
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
