import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DetailsPanelComponent } from '@hexly/web-entity';

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
  imports: [DetailsPanelComponent],
  template: `
    <div class="absolute inset-0 overflow-y-auto bg-surface-sunken" data-testid="details-view">
      <!-- Full-width stat-block: the shared Details Panel rendering, centred in a readable column
           rather than the Dock's narrow rail (ADR-0067). -->
      <div class="mx-auto my-6 max-w-[60rem] rounded-md border border-line shadow-1 overflow-hidden">
        <app-details-panel />
      </div>
    </div>
  `,
})
export class DetailsViewComponent {}
