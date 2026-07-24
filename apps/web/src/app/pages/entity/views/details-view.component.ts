import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DetailsPanelComponent, ReadingSurfaceComponent } from '@hexly/web-entity';

/**
 * The **Details View** (`core.view.details`, ADR-0067 — renamed from the generic Field view): the
 * Entity's Types, its declared Fields edited in place, and its untyped keys. It is the **fallback main
 * content alone** — an Entity affording no other View opens full-width on it (a field-only import like a
 * monster gets a full-width stat-block, not a narrow panel), and it leaves the View toggle the moment
 * any other View exists.
 *
 * It **shares one rendering** with the universal Details Panel (ADR-0067): both mount
 * {@link DetailsPanelComponent}, so the inline Type/Field management — add/remove types, attach/detach
 * and edit Fields in place, read-only untyped keys, all write-gated (ADR-0037) — is defined once. The
 * View only frames that panel full-width and centred, over the shared `ENTITY_SESSION`/`ENTITY_TYPES`
 * seams the panel reads.
 */
@Component({
  selector: 'app-details-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [ReadingSurfaceComponent, DetailsPanelComponent],
  template: `
    <!-- The shared Details Panel rendering, framed as a bordered card in the shared reading column (ADR-0067). -->
    <app-reading-surface>
      <div class="rounded-md border border-line shadow-1 overflow-hidden" data-testid="details-view">
        <app-details-panel />
      </div>
    </app-reading-surface>
  `,
})
export class DetailsViewComponent {}
