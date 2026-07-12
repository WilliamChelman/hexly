import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { CORE_HEXMAP, EntitySummary, EntityType } from '@hexly/domain';
import { EntitiesClient, ActiveWorld } from '@hexly/web-core';
import { Button, Field, Icon, EntitySearchPicker } from '@hexly/web-ui';
import { HexMapStore } from '../services/hexmap-store';

/**
 * The Inspector's Entity Link control (issue #76, CONTEXT.md → Entity Link) for the
 * single selected linkable Map element (a Hex, Feature, or Region — never a Label):
 * pick an Entity to link, follow it, or remove it. The picker searches server-side
 * via `list({ q })` and resolves the linked name via `list({ ids: [id] })` (ADR-0025),
 * never holding the whole owner list. A link to a deleted/inaccessible target renders
 * non-navigable rather than a dead link (issue #78); the id stays in the document.
 */
@Component({
  selector: 'app-entity-link',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Field, Icon, EntitySearchPicker, RouterLink, TranslocoPipe],
  template: `
    <div appField [label]="'map.inspector.linkedEntity' | transloco">
      @let id = store.selectedEntityLink();
      @if (id) {
        <div class="flex items-center gap-2">
          @if (linked(); as e) {
            <a
              class="block flex-1 min-w-0 truncate cursor-pointer font-display text-base text-gold no-underline hover:underline"
              data-testid="entity-link-name"
              [routerLink]="['/entities', id]"
            >
              <span aria-hidden="true">→ </span>{{ e.name }}
              <span class="font-mono text-2xs text-ink-muted">({{ e.types[0] }})</span>
            </a>
          } @else if (resolved()) {
            <!-- Target deleted/inaccessible: visible but non-navigable (issue #78). -->
            <span
              class="block flex-1 min-w-0 truncate font-display text-base italic text-ink-muted"
              data-testid="entity-link-dangling"
              [attr.title]="'map.inspector.linkUnavailable' | transloco"
            >
              <span aria-hidden="true">→ </span>{{ 'map.inspector.linkUnavailable' | transloco }}
            </span>
          } @else {
            <!-- List still loading: neutral placeholder, never a clickable dead link. -->
            <span class="block flex-1 min-w-0 truncate font-display text-base text-ink-muted">
              <span aria-hidden="true">→ </span>…
            </span>
          }
          <button
            type="button"
            appButton
            variant="ghost"
            size="sm"
            icon
            danger
            data-testid="entity-link-remove"
            [attr.aria-label]="'map.inspector.removeLink' | transloco"
            [attr.title]="'map.inspector.removeLink' | transloco"
            (click)="remove()"
          >
            <app-icon name="close" [size]="16" />
          </button>
        </div>
      } @else {
        <button type="button" appButton variant="ghost" size="sm" data-testid="entity-link-pick" (click)="toggle()">
          {{ 'map.inspector.pickLink' | transloco }}
        </button>
      }

      @if (open()) {
        <app-entity-search-picker
          class="mt-2 block"
          testid="entity-link"
          placeholderKey="map.inspector.searchLink"
          emptyKey="map.inspector.linkEmpty"
          [query]="query()"
          (queryChange)="query.set($event)"
          (pick)="pick($event.id)"
        >
          <!-- Create-and-link in the same flow (issue #77): query names it, empty → default.
               Projected below the picker's option list; it stays pinned as the list scrolls. -->
          <div class="mt-1 flex gap-1 border-t border-line pt-1">
            <button
              type="button"
              appButton
              variant="ghost"
              size="sm"
              class="flex-1"
              data-testid="entity-link-create-note"
              (click)="create('core.note')"
            >
              + {{ 'map.inspector.newNote' | transloco }}
            </button>
            <button
              type="button"
              appButton
              variant="ghost"
              size="sm"
              class="flex-1"
              data-testid="entity-link-create-map"
              (click)="create('core.hexmap')"
            >
              + {{ 'map.inspector.newMap' | transloco }}
            </button>
          </div>
        </app-entity-search-picker>
      }
    </div>
  `,
})
export class EntityLink {
  protected readonly store = inject(HexMapStore);
  protected readonly activeWorld = inject(ActiveWorld);
  private readonly entitiesClient = inject(EntitiesClient);
  private readonly transloco = inject(TranslocoService);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Entities created via create-and-link (issue #77), resolved locally so their
   * name shows at once without a server round trip. The display-resolve still
   * goes to the server for everything else.
   */
  private readonly created = signal<EntitySummary[]>([]);

  /** The linked Entity's summary, or null when unset or unresolvable (dangling). */
  protected readonly linked = signal<EntitySummary | null>(null);
  /** True once resolving the current link has settled, so the template tells "loading" from "dangling". */
  protected readonly resolved = signal(false);

  protected readonly open = signal(false);
  protected readonly query = signal('');

  constructor() {
    // Resolve the linked name on demand (ADR-0025): created entities are known locally,
    // others fetched by id. onCleanup cancels stale responses on link change.
    effect((onCleanup) => {
      const id = this.store.selectedEntityLink();
      this.linked.set(null);
      this.resolved.set(false);
      if (!id) {
        this.resolved.set(true);
        return;
      }
      const local = untracked(() => this.created().find((e) => e.id === id));
      if (local) {
        this.linked.set(local);
        this.resolved.set(true);
        return;
      }
      const sub = this.entitiesClient.list({ ids: [id] }).subscribe({
        next: (page) => {
          this.linked.set(page.items[0] ?? null);
          this.resolved.set(true);
        },
        error: () => this.resolved.set(true),
      });
      onCleanup(() => sub.unsubscribe());
    });

    // Close the picker and reset the query whenever the selected element changes so
    // a pick() always targets the element the picker was opened for.
    effect(() => {
      this.store.selection();
      this.open.set(false);
      this.query.set('');
    });
  }

  protected toggle(): void {
    if (!this.open()) this.query.set('');
    this.open.update((v) => !v);
  }

  protected pick(id: string): void {
    this.store.linkEntity(id);
    this.open.set(false);
  }

  // Create new owner-scoped Entity and link in one flow (issue #77).
  // Created Entity appended locally so its name resolves immediately.
  protected create(type: EntityType): void {
    const name =
      this.query().trim() ||
      // The fallback name is this lib's own copy (ADR-0049). The app carries the same two
      // strings for the Entities it mints; they are deliberately duplicated so neither
      // project reads the other's catalog.
      this.transloco.translate(type === CORE_HEXMAP ? 'map.untitledMap' : 'map.untitledNote');
    this.entitiesClient
      // Scope the create-and-link Entity to the World in the URL (ADR-0028) so it
      // lands in the same World as the map being edited, not the owner's oldest.
      .create(name, [type], this.activeWorld.worldId() ?? undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((entity) => {
        // Remember it locally so its name resolves without a server round trip,
        // then link — the resolve effect picks it up from `created`.
        this.created.update((list) => [...list, entity]);
        this.store.linkEntity(entity.id);
        this.open.set(false);
      });
  }

  protected remove(): void {
    this.store.unlinkEntity();
  }
}
