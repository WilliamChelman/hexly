import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ENTITY_SESSION, ENTITY_TYPES } from '@hexly/web-entity';
import { TranslocoService } from '@jsverse/transloco';
import { ContentEditorComponent } from './content-editor.component';
import { EntityMetadataComponent } from './entity-metadata.component';
import { OutlineSourceDirective } from '../directives/outline-source.directive';
import { OutlineStore } from '../services/outline-store';

/**
 * The `core.view.rich-content` renderer (ADR-0048, *Views* amendment; ADR-0051): the Content body in a
 * centred reading column. It renders whichever prose Field placed it, reading that Field's key from
 * `VIEW_FIELD_KEY` (the {@link ContentEditorComponent} it hosts does the read).
 *
 * The View's Outline is a page-Dock Panel now (ADR-0067) — declared on the View's `ViewDefinition.panels`
 * and hosted by the page's Dock with this View's injector — so the private floating dock the View once
 * owned is gone. The View keeps {@link OutlineStore} in `providers` (the same View-scoped ownership the
 * Map View gives its `HexMapStore`, ADR-0050): the store lives and dies with this View's chunk, and the
 * Dock-hosted Outline Panel reaches it through the View injector.
 *
 * `display:contents` (host `class: contents`) so the scroll column positions against the page's `<main>`.
 */
@Component({
  selector: 'app-content-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  providers: [OutlineStore],
  imports: [ContentEditorComponent, EntityMetadataComponent, OutlineSourceDirective],
  template: `
    <!-- Content body in a centred reading column; the page's grid reserves the Dock's column beside it. -->
    <div data-content-scroll class="absolute inset-0 overflow-y-auto bg-surface-sunken">
      <div class="max-w-[60rem] mx-auto py-6 px-6">
        <app-entity-metadata />
        <app-content-editor appOutlineSource [ariaLabel]="editorLabel()" />
      </div>
    </div>
  `,
})
export class ContentViewComponent {
  private readonly session = inject(ENTITY_SESSION);
  private readonly types = inject(ENTITY_TYPES);
  private readonly transloco = inject(TranslocoService);

  /**
   * The Content editor's accessible name, from the primary type (ADR-0014) — resolved, so a
   * user-defined type contributes its authored name rather than a translated key.
   */
  protected readonly editorLabel = computed(() => {
    this.transloco.activeLang(); // reactive dependency: re-resolve on a language switch
    return this.types.chromeLabel(this.session.current()?.types?.[0], 'editorLabel');
  });
}
