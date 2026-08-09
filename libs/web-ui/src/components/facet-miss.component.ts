import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { FacetTokenMissReason, ParsedFacetQuery } from '@hexly/domain';

/** The copy key each miss reason states — one message per reason, never one shrug for all of them. */
const REASON_KEY: Readonly<Record<FacetTokenMissReason, string>> = {
  'empty-value': 'ui.facetToken.emptyValue',
  'unterminated-quote': 'ui.facetToken.unterminatedQuote',
  'negated-bound': 'ui.facetToken.negatedBound',
};

/** One line of the report: the copy it states, and the keys it states it about. */
interface FacetMissLine {
  readonly id: string;
  readonly key: string;
  readonly keys: string;
}

/**
 * What a box's **Facet Tokens** applied nothing for (ADR-0082) — an unknown `$` name, and a resolved key
 * that filtered nothing. Both are said: a token vanishes as it is lifted out, so an unreported one would
 * browse everything as if the box were empty. Its own component because the six hosts place the report in
 * six chromes (and the mention picker has no box at all); the copy is web-ui's (ADR-0049).
 */
@Component({
  selector: 'app-facet-miss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  // A host styles this element and those styles cascade into the lines; shown only when there is a miss
  // to state, and inline so no utility class ordering can outrank it.
  host: { '[style.display]': "lines().length ? 'block' : 'none'" },
  template: `
    @for (line of lines(); track line.id) {
      <p role="status" [attr.data-testid]="line.id">{{ line.key | transloco: { keys: line.keys } }}</p>
    }
  `,
})
export class FacetMissComponent {
  /** The parse of whatever this surface read — `null` before there is one. */
  readonly parsed = input<ParsedFacetQuery | null>(null);
  /** The unknown-key line's `data-testid`; a reason line appends its reason to it. */
  readonly testid = input('unknown-facet');

  protected readonly lines = computed<FacetMissLine[]>(() => {
    const parsed = this.parsed();
    if (!parsed) return [];
    const lines: FacetMissLine[] = [];
    if (parsed.unresolvedKeys.length)
      lines.push({ id: this.testid(), key: 'ui.facetToken.unknownFacet', keys: parsed.unresolvedKeys.join(', ') });
    // One message per reason listing every key that missed for it — not one line per token, which would
    // repeat the same explanation down the page.
    for (const reason of Object.keys(REASON_KEY) as FacetTokenMissReason[]) {
      const keys = parsed.inapplicableTokens.filter((token) => token.reason === reason).map((token) => token.key);
      if (keys.length) lines.push({ id: `${this.testid()}-${reason}`, key: REASON_KEY[reason], keys: keys.join(', ') });
    }
    return lines;
  });
}
