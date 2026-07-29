import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { EntityLinkValue, EntitySummary, FacetCount } from '@hexly/domain';
import { CORE_ASSET_TYPE_ID, IMAGE_KIND_FIELD_TOKEN } from '@hexly/plugin-asset';
import { AssetsClient, EntitiesClient } from '@hexly/web-core';
import { ContainerChipsComponent } from './container-chips.component';

/**
 * The **pick-or-upload** affordance the core entityLink control grows whenever a Field's `targetTypes`
 * targets `core.type.asset` (ADR-0066, #288). Setting a thumbnail is one interaction on the Entity itself:
 * pick an existing image Asset by *sight* or upload a new one on the spot — never a detour through the Asset
 * Browser. This is a generic control affordance, not a bespoke thumbnail widget, so any asset-link Field
 * (plugin or user-defined) gets it code-lessly.
 *
 * It stores the Asset Entity's **id** (an entity link, ADR-0066), not a capability URL: a pick emits the
 * chosen Entity's id, an upload emits the minted wrapper's id. Search reuses the one entity-search machinery
 * ({@link EntitiesClient.list}) pinned to the asset type + image kind — the same server contract the Board
 * image picker speaks — with `thumbnails=1` so the current value and every result render as a preview tile.
 * Mime is unenforced (forward-only): a non-image/dangling designation simply resolves to no tile.
 */
@Component({
  selector: 'app-asset-link-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ContainerChipsComponent, TranslocoPipe],
  template: `
    <div class="flex flex-col gap-2" data-testid="asset-link-control">
      <!-- Current value: a preview tile + its last-known name, so a deleted/hidden target stays legible. -->
      @if (value(); as current) {
        <div class="flex items-center gap-2">
          @if (currentThumb(); as thumb) {
            <img
              class="h-12 w-12 shrink-0 rounded-sm border border-line object-cover"
              data-testid="asset-link-preview"
              [src]="thumb"
              alt=""
            />
          } @else {
            <!-- No resolvable thumbnail (dangling, non-image, or not yet loaded): a neutral placeholder tile. -->
            <div
              class="h-12 w-12 shrink-0 rounded-sm border border-line bg-surface-sunken"
              data-testid="asset-link-placeholder"
            ></div>
          }
          <span class="text-sm text-ink" data-testid="asset-link-value">{{ current.label || current.entityId }}</span>
          @if (!disabled()) {
            <button
              type="button"
              class="text-xs text-ink-muted hover:text-danger"
              data-testid="asset-link-clear"
              (click)="clear()"
            >
              ✕
            </button>
          }
        </div>
      }

      @if (!disabled()) {
        @if (picking()) {
          <div class="flex flex-col gap-2 rounded-md border border-line bg-surface p-2">
            <!-- Upload: mint (or dedup to) a new image Asset in place; its wrapper's id becomes the link. -->
            <label class="text-xs text-ink-muted" for="asset-link-upload">{{
              'fields.assetLink.upload' | transloco
            }}</label>
            <input
              id="asset-link-upload"
              type="file"
              accept="image/*"
              class="text-sm"
              data-testid="asset-link-upload"
              [disabled]="uploading()"
              (change)="onFile($event)"
            />
            @if (uploading()) {
              <p class="text-xs text-ink-muted">{{ 'fields.assetLink.uploading' | transloco }}</p>
            }
            @if (error()) {
              <p class="text-xs text-danger" data-testid="asset-link-error">
                {{ 'fields.assetLink.uploadError' | transloco }}
              </p>
            }

            <!-- Pick: search over the World's image Assets, rendered as preview tiles (picked by sight). -->
            <input
              type="search"
              class="w-full rounded-md border border-line bg-surface-sunken px-2 py-1 text-sm"
              data-testid="asset-link-search"
              [attr.placeholder]="'fields.assetLink.search' | transloco"
              [value]="query()"
              (input)="query.set($any($event.target).value)"
            />
            <!-- The **Container** facet (ADR-0080): a World that Mounts a shelf is offered its art here
                 too, and these chips narrow to one shelf. Nothing Mounted, nothing to narrow, no chips. -->
            <app-container-chips testid="asset-link" [containers]="containers()" [(selected)]="container" />
            @if (results().length > 0) {
              <div class="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto" role="list">
                @for (asset of results(); track asset.id) {
                  <button
                    type="button"
                    role="listitem"
                    class="aspect-square overflow-hidden rounded-sm border border-line bg-surface-sunken hover:border-accent focus-visible:border-accent outline-none"
                    [title]="asset.name"
                    [attr.aria-label]="asset.name"
                    [attr.data-testid]="'asset-link-option-' + asset.id"
                    (click)="pick(asset)"
                  >
                    <img class="h-full w-full object-cover" draggable="false" [src]="asset.thumbnailUrl" alt="" />
                  </button>
                }
              </div>
            } @else {
              <p class="text-xs text-ink-muted" data-testid="asset-link-empty">
                {{ 'fields.assetLink.empty' | transloco }}
              </p>
            }
          </div>
        } @else {
          <button
            type="button"
            class="self-start rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink-muted hover:text-ink"
            data-testid="asset-link-open"
            [attr.aria-invalid]="invalid() || null"
            (click)="picking.set(true)"
          >
            {{ (value() ? 'fields.assetLink.change' : 'fields.assetLink.set') | transloco }}
          </button>
        }
      }
    </div>
  `,
})
export class AssetLinkPickerComponent {
  private readonly entities = inject(EntitiesClient);
  private readonly assets = inject(AssetsClient);

  /** The current entityLink value (id + name snapshot), or `null` when the slot carries no link. */
  readonly value = input<EntityLinkValue | null>(null);
  readonly disabled = input(false);
  readonly invalid = input(false);
  /** The open Entity's World — scopes the search and is the World an in-place upload mints into. */
  readonly worldId = input<string | undefined>(undefined);
  /** The next link value: the picked/uploaded Asset's id + name, or `undefined` on clear. */
  readonly valueChange = output<EntityLinkValue | undefined>();

  /** Whether the pick-or-upload panel is open; a set/change click opens it, a pick/upload closes it. */
  protected readonly picking = signal(false);
  /** The image-Asset search query (server-side FTS `q`); a change refetches the results. */
  protected readonly query = signal('');
  /** In-flight upload guard: disables the file input and shows the uploading hint. */
  protected readonly uploading = signal(false);
  /** Whether the last upload failed — surfaces a retry hint without closing the panel. */
  protected readonly error = signal(false);

  /** The matched image Assets (id + thumbnail), empty while the panel is closed. */
  protected readonly results = signal<EntitySummary[]>([]);
  /** The **Container** facet's live values — this World and the ones it Mounts that still hold a match. */
  protected readonly containers = signal<readonly FacetCount[]>([]);
  /** The Container the user narrowed to, if any — one Shelf, or one pack (ADR-0080). */
  protected readonly container = signal<string | undefined>(undefined);
  /** The current value's resolved thumbnail URL, or `undefined` for a dangling/non-image/loading target. */
  protected readonly currentThumb = signal<string | undefined>(undefined);

  constructor() {
    // Resolve the current value's preview tile whenever the link changes (ADR-0066): one read by id with
    // thumbnails=1. A dangling/non-image target resolves to no thumbnailUrl and falls back to the placeholder.
    // No World scope: "resolve exactly this id" is no browse, and naming one would blank the preview of a
    // link the picker itself offered from a Mounted Shelf (ADR-0080).
    effect((onCleanup) => {
      const current = this.value();
      this.currentThumb.set(undefined);
      if (!current) return;
      const sub = this.entities.list({ ids: [current.entityId], thumbnails: true }).subscribe({
        next: (page) => this.currentThumb.set(page.items[0]?.thumbnailUrl),
        error: () => this.currentThumb.set(undefined),
      });
      onCleanup(() => sub.unsubscribe());
    });

    // A narrowing the World outlives would silently answer the next search from a Container the user
    // cannot see chosen: a new World is a new set of Containers, so the selection goes with it.
    effect(() => {
      this.worldId();
      untracked(() => this.container.set(undefined));
    });

    // Search image Assets through the one entity-search machinery whenever the panel is open and the query
    // changes (ADR-0065/0066), pinned to the asset type + image kind. onCleanup cancels superseded requests;
    // a failed search empties the grid (upload still works). Closed → no premature search fires.
    effect((onCleanup) => {
      if (!this.picking()) {
        this.results.set([]);
        return;
      }
      const sub = this.entities.list({ ...this.read(), thumbnails: true }).subscribe({
        next: (page) => this.results.set(page.items),
        error: () => this.results.set([]),
      });
      onCleanup(() => sub.unsubscribe());
    });

    // The Container facet's counts, off the same read the tiles come from — its own selection dropped, as
    // every drill-down facet's is, so the chip you are standing on keeps its siblings to move to.
    effect((onCleanup) => {
      if (!this.picking()) {
        this.containers.set([]);
        return;
      }
      const sub = this.entities.facets({ ...this.read(), container: undefined }).subscribe({
        next: (facets) => this.containers.set(facets.container ?? []),
        error: () => this.containers.set([]),
      });
      onCleanup(() => sub.unsubscribe());
    });
  }

  /**
   * The one read behind both the tiles and the chips annotating them, so the two cannot disagree.
   * Designating a Thumbnail is pointing at an Entity, so this is a **link-target read** like every other
   * Entity Link Field picker's (ADR-0079) — which is what offers a mounted Shelf's art beside this
   * World's own, the World's own first (ADR-0080). Resolving the *current* value is not: that is an id
   * lookup, and it reads through no scope at all.
   */
  private read() {
    const container = this.container();
    return {
      q: this.query().trim(),
      worldId: this.worldId(),
      type: [CORE_ASSET_TYPE_ID],
      field: [IMAGE_KIND_FIELD_TOKEN],
      container: container ? [container] : undefined,
      read: 'link-target' as const,
    };
  }

  /** Commit a picked image Asset as the link — its id plus a name snapshot (the dangling fallback). */
  protected pick(asset: EntitySummary): void {
    this.valueChange.emit({ entityId: asset.id, label: asset.name });
    this.picking.set(false);
    this.query.set('');
  }

  /** Clear the link — the field falls back to the type icon at render (ADR-0066). */
  protected clear(): void {
    this.valueChange.emit(undefined);
  }

  /**
   * Upload the picked file into the World, minting (or deduping to) an Asset, then store its wrapper's id
   * as the link (ADR-0065/0066). A failure keeps the panel open with a retry hint. No-op without a World.
   */
  protected onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const worldId = this.worldId();
    if (!file || !worldId) return;
    this.error.set(false);
    this.uploading.set(true);
    this.assets.upload(worldId, file).subscribe({
      next: (entity) => {
        this.uploading.set(false);
        this.picking.set(false);
        input.value = '';
        this.valueChange.emit({ entityId: entity.id, label: entity.name });
      },
      error: () => {
        this.uploading.set(false);
        this.error.set(true);
        input.value = '';
      },
    });
  }
}
