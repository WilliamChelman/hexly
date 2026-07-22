import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ENTITY_SESSION, ENTITY_TYPES } from '@hexly/web-entity';
import { IconComponent, IconButtonComponent } from '@hexly/web-ui';
import { TranslocoService, translateSignal } from '@jsverse/transloco';
import { ContentEditorComponent } from './content-editor.component';
import { EntityMetadataComponent } from './entity-metadata.component';
import { OutlinePanelComponent } from './outline-panel.component';
import { OutlineSourceDirective } from '../directives/outline-source.directive';
import { OutlineStore } from '../services/outline-store';
import { RightDock } from '../services/right-dock';

/**
 * The `core.view.rich-content` renderer (ADR-0048, *Views* amendment; ADR-0051): the Content body in a
 * centred reading column with its Outline / References dock. It renders whichever prose Field placed
 * it, reading that Field's key from `VIEW_FIELD_KEY` (the {@link ContentEditorComponent} it hosts does the read).
 *
 * The View owns its dock stores in `providers` — as the Map View owns its `HexMapStore` (ADR-0050) —
 * so the whole dock lives and dies with the content View's chunk and never reaches the initial bundle.
 * References left the View for the page-owned Dock (ADR-0067); the Outline is what remains here.
 *
 * `display:contents` (host `class: contents`) so the scroll column and the floating dock position
 * against the page's `<main>`.
 */
@Component({
  selector: 'app-content-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  providers: [RightDock, OutlineStore],
  imports: [
    ContentEditorComponent,
    EntityMetadataComponent,
    OutlinePanelComponent,
    OutlineSourceDirective,
    IconButtonComponent,
    IconComponent,
  ],
  template: `
    <!-- Content body in a centred reading column. Opening the Outline reflows this column left (extra
         right padding) so the panel never overlaps prose; closed still reserves room for the toggle. -->
    <div
      data-content-scroll
      class="absolute inset-0 overflow-y-auto bg-surface-sunken transition-[padding] duration-200"
      [style.paddingRight]="dock.isOpen() ? '20rem' : '3.5rem'"
    >
      <div class="max-w-[60rem] mx-auto py-6 px-6">
        <app-entity-metadata />
        <app-content-editor appOutlineSource [ariaLabel]="editorLabel()" />
      </div>
    </div>
    <!-- Right dock floating top-right (mirrors the map dock, ADR-0013): the Outline panel slot left of
         its toggle; pointer-events re-enabled per child. Ungated by writable(): a read affordance. -->
    <div class="absolute top-3 right-3 bottom-3 flex items-start gap-2 z-[1] pointer-events-none">
      @if (dock.panel() === 'outline') {
        <app-outline-panel class="w-[16rem] max-h-full border border-line rounded-lg shadow-2 pointer-events-auto" />
      }
      <div class="flex flex-col gap-2">
        <button
          appIconButton
          toggle
          class="pointer-events-auto"
          [active]="dock.panel() === 'outline'"
          [title]="outlineToggleLabel()"
          [attr.aria-label]="outlineToggleLabel()"
          data-testid="outline-toggle"
          (click)="dock.toggle('outline')"
        >
          <app-icon name="outline" [size]="20" />
        </button>
      </div>
    </div>
  `,
})
export class ContentViewComponent {
  private readonly session = inject(ENTITY_SESSION);
  private readonly types = inject(ENTITY_TYPES);
  private readonly transloco = inject(TranslocoService);
  /** Which panel the Content body's right dock is showing — one slot, so one discriminant. */
  protected readonly dock = inject(RightDock);

  /** Accessible name / tooltip for the Outline toggle (ADR-0014). */
  protected readonly outlineToggleLabel = translateSignal('editor.outline.toggle');

  /**
   * The Content editor's accessible name, from the primary type (ADR-0014) — resolved, so a
   * user-defined type contributes its authored name rather than a translated key.
   */
  protected readonly editorLabel = computed(() => {
    this.transloco.activeLang(); // reactive dependency: re-resolve on a language switch
    return this.types.chromeLabel(this.session.current()?.types?.[0], 'editorLabel');
  });
}
