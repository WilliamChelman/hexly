import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { FacetCount } from '@hexly/domain';
import { ButtonComponent } from '@hexly/web-ui';

/**
 * The **Container** facet as chips (ADR-0080): "All" plus one counted chip per Container a widened read
 * reached — this World, and the packs and Shelves it **Mounts** — for the pickers that have no Facet rail
 * to put the category in. Renders nothing below two Containers, the server's own by-presence rule, so a
 * World that Mounts nothing shows no chip and every picker looks exactly as it did. The consumer owns
 * both the counts and the options, so these cannot annotate a list they disagree with.
 *
 * The one thing they do add is the narrowing itself: counts are grouped over the *filtered* result set,
 * so refining a search until only one Container still matches drops the chosen one out of the facet —
 * and the strip must not vanish with it, or the read stays narrowed to a Container with no chip to see
 * it by and no "All" to leave it by. A chosen Container therefore always keeps a chip, at the count the
 * list actually shows.
 */
@Component({
  selector: 'app-container-chips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, TranslocoPipe],
  template: `
    @if (chips().length > 1 || selected() !== undefined) {
      <div class="flex flex-wrap gap-1" [attr.data-testid]="testid() + '-containers'">
        <button
          type="button"
          appButton
          [variant]="selected() ? 'ghost' : 'default'"
          size="sm"
          [attr.data-testid]="testid() + '-container-all'"
          (click)="selected.set(undefined)"
        >
          {{ 'collab.containerChips.all' | transloco }}
        </button>
        @for (c of chips(); track c.value) {
          <button
            type="button"
            appButton
            [variant]="selected() === c.value ? 'default' : 'ghost'"
            size="sm"
            [attr.data-testid]="testid() + '-container-' + c.value"
            (click)="selected.set(c.value)"
          >
            {{ c.label ?? c.value }}
            <span class="font-mono text-2xs text-ink-muted">({{ c.count }})</span>
          </button>
        }
      </div>
    }
  `,
})
export class ContainerChipsComponent {
  /** Prefix for the chip `data-testid`s, per embedding surface — the picker's own. */
  readonly testid = input.required<string>();
  /** The Container facet's live values, off the same read the options come from. */
  readonly containers = input<readonly FacetCount[]>([]);
  /** The Container narrowed to, if any — one pack, or one Shelf; `undefined` is "All". */
  readonly selected = model<string | undefined>(undefined);

  /** Names seen for a Container, so a narrowing the facet has stopped counting still names itself. */
  private readonly names = new Map<string, string>();

  /** The facet's own values, plus the narrowing in force when the facet no longer counts it. */
  protected readonly chips = computed<readonly FacetCount[]>(() => {
    const counted = this.containers();
    for (const c of counted) if (c.label) this.names.set(c.value, c.label);
    const picked = this.selected();
    if (picked === undefined || counted.some((c) => c.value === picked)) return counted;
    return [...counted, { value: picked, label: this.names.get(picked), count: 0 }];
  });
}
