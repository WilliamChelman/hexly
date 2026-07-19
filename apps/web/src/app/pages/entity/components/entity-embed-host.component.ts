import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  DEFAULT_ENTITY_RENDER_CONTEXT,
  ENTITY_SESSION,
  EntityRenderContext,
  parseViewInstanceKey,
} from '@hexly/web-entity';
import { EntitySession } from '../services/entity-session';
import { EmbedEntitySession } from '../services/embed-entity-session';
import { EntityViewStore } from './../services/entity-view-store';
import { EntityViewOutletComponent } from './entity-view-outlet.component';

/**
 * The Entity View Outlet host a plugin transcludes another Entity through (Seam C, #264/#270): the
 * component the app binds to `ENTITY_VIEW_OUTLET`, so the Board's Embed can render a target's chosen View
 * in place without importing the app (ADR-0048).
 *
 * It self-provides the transclusion-scoped read-only session and view store, so its own fetch drives *its*
 * target and never disturbs the host page's open Entity, then mounts the reusable {@link EntityViewOutletComponent}
 * over them — the one implementation that resolves the View and owns the card/dangling fallbacks (ADR-0062).
 * The plugin passes primitives (`entityId`, a View-instance `viewKey`, the render context); this parses the
 * key into the outlet's {@link ViewInstance}.
 */
@Component({
  selector: 'app-entity-embed-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [EntityViewOutletComponent],
  providers: [
    EmbedEntitySession,
    // The outlet and the transcluded View resolve the Embed's own read-only session — through both the
    // concrete class (the outlet, the view store) and the port token (the plugin's View body).
    { provide: EntitySession, useExisting: EmbedEntitySession },
    { provide: ENTITY_SESSION, useExisting: EmbedEntitySession },
    EntityViewStore,
  ],
  template: `
    <app-entity-view-outlet [entityId]="entityId()" [viewInstance]="viewInstance()" [renderContext]="renderContext()" />
  `,
})
export class EntityEmbedHostComponent {
  /** The Embed's target Entity — the outlet drives its own fetch on it. */
  readonly entityId = input<string | null>(null);
  /** The chosen View's instance key (`core.view.map:core.grid`); `''` selects the target's default View. */
  readonly viewKey = input<string>('');
  /** The transclusion bounds this Embed sits at (ADR-0062). */
  readonly renderContext = input<EntityRenderContext>(DEFAULT_ENTITY_RENDER_CONTEXT);

  /** The parsed View to pin, or `null` (empty key) to fall to the target's default View. */
  protected readonly viewInstance = computed(() => parseViewInstanceKey(this.viewKey()));
}
