import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ENTITY_SESSION, ENTITY_TYPES } from '@hexly/web-entity';
import { IconComponent, IconButtonComponent } from '@hexly/web-ui';
import { TranslocoService, translateSignal } from '@jsverse/transloco';
import { ContentEditorComponent } from './content-editor.component';
import { EntityMetadataComponent } from './entity-metadata.component';
import { OutlinePanelComponent } from './outline-panel.component';
import { OutlineSourceDirective } from '../directives/outline-source.directive';
import { OutlineStore } from '../services/outline-store';
import { ReferencesPanelComponent } from './references-panel.component';
import { ReferencesStore } from '../services/references-store';
import { RightDock } from '../services/right-dock';

/**
 * The `core.view.content` renderer (ADR-0048, *Views* amendment; ADR-0051): the Content body in a
 * centred reading column with its Outline / References dock. It renders whichever prose Field placed
 * it, reading that Field's key from `VIEW_FIELD_KEY` (the {@link ContentEditorComponent} it hosts does the read).
 *
 * The View owns its dock stores in `providers` — as the Map View owns its `HexMapStore` (ADR-0050) —
 * so the whole dock lives and dies with the content View's chunk and never reaches the initial bundle.
 * `RIGHT_DOCK_PANELS` is left to an ancestor (a Public Link page narrows it to the Outline alone).
 *
 * `display:contents` (host `class: contents`) so the scroll column and the floating dock position
 * against the page's `<main>`.
 */
@Component({
  selector: 'app-content-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  providers: [RightDock, OutlineStore, ReferencesStore],
  imports: [
    ContentEditorComponent,
    EntityMetadataComponent,
    OutlinePanelComponent,
    OutlineSourceDirective,
    ReferencesPanelComponent,
    IconButtonComponent,
    IconComponent,
  ],
  template: `
    <!-- Content body in a centred reading column. Opening either dock panel reflows
         this column left (extra right padding) so the panel never overlaps prose —
         they share one slot and one width; closed still reserves room for the toggles. -->
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
    <!-- Right dock floating top-right (mirrors the map dock, ADR-0013): one panel slot
         left of a rail of toggles; pointer-events re-enabled per child. The Outline and
         References share the slot, so dock.panel() is a single discriminant and "both
         open at once" is unrepresentable. Ungated by writable(): both are read affordances. -->
    <div class="absolute top-3 right-3 bottom-3 flex items-start gap-2 z-[1] pointer-events-none">
      @if (dock.panel() === 'outline') {
        <app-outline-panel class="w-[16rem] max-h-full border border-line rounded-lg shadow-2 pointer-events-auto" />
      } @else if (dock.panel() === 'references') {
        <app-references-panel class="w-[16rem] max-h-full border border-line rounded-lg shadow-2 pointer-events-auto" />
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
        @if (dock.offers('references')) {
          <button
            appIconButton
            toggle
            class="pointer-events-auto"
            [active]="dock.panel() === 'references'"
            [title]="linksToggleLabel()"
            [attr.aria-label]="linksToggleLabel()"
            data-testid="references-toggle"
            (click)="dock.toggle('references')"
          >
            <app-icon name="link" [size]="20" />
          </button>
        }
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

  /** Accessible names / tooltips for the dock's toggles (ADR-0014). */
  protected readonly outlineToggleLabel = translateSignal('editor.outline.toggle');
  protected readonly linksToggleLabel = translateSignal('editor.links.toggle');

  /**
   * The Content editor's accessible name, from the primary type (ADR-0014) — resolved, so a
   * user-defined type contributes its authored name rather than a translated key.
   */
  protected readonly editorLabel = computed(() => {
    this.transloco.activeLang(); // reactive dependency: re-resolve on a language switch
    return this.types.chromeLabel(this.session.current()?.types?.[0], 'editorLabel');
  });
}
