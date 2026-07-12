import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ContentEditor } from '@hexly/content-editor';
import { Icon, IconButton } from '@hexly/web-ui';
import { TranslocoService, translateSignal } from '@jsverse/transloco';
import { TypeRegistry } from '../../../entity-types/type-registry';
import { EntityMetadata } from '../components/entity-metadata';
import { OutlinePanel } from '../components/outline-panel';
import { OutlineSource } from '../components/outline-source';
import { ReferencesPanel } from '../components/references-panel';
import { EntitySession } from '../services/entity-session';
import { RightDock } from '../services/right-dock';

/**
 * The `core.view.content` renderer (ADR-0048, *Views* amendment): the Content body
 * in a centred reading column with its Outline / References dock. The registered
 * View the {@link EntityPage} host outlets for the base every Entity affords — a
 * note, or a hexmap on its content view. Its dock stores (`RightDock` and friends)
 * are provided by the host, so a hexmap flipping between map and content keeps one
 * dock instance.
 *
 * `display:contents` (host `class: contents`) so the scroll column and the floating
 * dock position against the page's `<main>` exactly as the old inline branch did.
 */
@Component({
  selector: 'app-content-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [ContentEditor, EntityMetadata, OutlinePanel, OutlineSource, ReferencesPanel, IconButton, Icon],
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
export class ContentView {
  private readonly session = inject(EntitySession);
  private readonly types = inject(TypeRegistry);
  private readonly transloco = inject(TranslocoService);
  /** Which panel the Content body's right dock is showing — one slot, so one discriminant. */
  protected readonly dock = inject(RightDock);

  /** Accessible names / tooltips for the dock's toggles (ADR-0014). */
  protected readonly outlineToggleLabel = translateSignal('noteView.outline.toggle');
  protected readonly linksToggleLabel = translateSignal('noteView.links.toggle');

  /**
   * The Content editor's accessible name, from the primary type (ADR-0014, #75) — already resolved,
   * so a user-defined type contributes its authored name rather than a translated key (#191).
   */
  protected readonly editorLabel = computed(() => {
    this.transloco.activeLang(); // reactive dependency: re-resolve on a language switch
    return this.types.chromeLabel(this.session.current()?.types?.[0], 'editorLabel');
  });
}
