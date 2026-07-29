import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { FacetCount } from '@hexly/domain';
import { ButtonComponent } from '@hexly/web-ui';

/**
 * The **Container** facet as chips (ADR-0080): "All" plus one counted chip per Container a widened read
 * reached — this World, and the packs and Shelves it **Mounts**. Narrowing to one is the drill-down every
 * other Facet category affords, brought to a picker that has no rail to put it in.
 *
 * Renders nothing below two Containers: a read that spans one has nothing to narrow, which is the same
 * by-presence rule the server counts it under — so a World that Mounts nothing shows no chip at all and
 * every picker looks exactly as it did.
 *
 * Presentational and read-only about scope: the counts must come from the same read the options come
 * from, so the consumer owns both and this cannot annotate a list it disagrees with.
 */
@Component({
  selector: 'app-container-chips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, TranslocoPipe],
  template: `
    @if (containers().length > 1) {
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
        @for (c of containers(); track c.value) {
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
  readonly testid = input('entity-picker');
  /** The Container facet's live values, off the same read the options come from. */
  readonly containers = input<readonly FacetCount[]>([]);
  /** The Container narrowed to, if any — one pack, or one Shelf; `undefined` is "All". */
  readonly selected = model<string | undefined>(undefined);
}
