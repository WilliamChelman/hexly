import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ENTITY_LIST_MAX_LIMIT, EntityFacets, EntitySummary, FacetCount, FieldFacet } from '@hexly/domain';
import {
  assetValueUrl,
  ASSET_KIND_FACET_KEY,
  CORE_ASSET_TYPE_ID,
  IMAGE_KIND_FIELD_TOKEN,
  readAssetValue,
} from '@hexly/plugin-asset';
import { AssetsClient, EntitiesClient } from '@hexly/web-core';
import { ContainerChipsComponent, linkTargetRead, pickerFacetTokens } from '@hexly/web-entity';
import { ButtonComponent, DialogComponent, DialogRef, FacetSearchInputComponent } from '@hexly/web-ui';

/** What the picker is launched with: the World whose Assets it uploads into and searches. */
export interface ImagePickerData {
  readonly worldId: string;
}

/** An empty Facet snapshot — the rail's resting state before the first counts land. */
const NO_FACETS: EntityFacets = { type: [], tag: [], visibility: [], fields: [] };

/** An Asset the grid can actually offer: one whose own bytes resolved to a capability URL to place. */
type PlaceableAsset = EntitySummary & { readonly assetUrl: string };

const isPlaceable = (e: EntitySummary): e is PlaceableAsset => !!e.assetUrl;

/**
 * The **Image** source chooser (#269, #281): the one dialog the Image Tool opens to obtain an Asset URL
 * before an Image element lands. Two paths to the same result — **upload a file** (mints a new World Asset
 * in one step) or **pick an existing** Asset — both {@link DialogRef.close close} the dialog with the
 * served capability URL. Cancelling (Escape, backdrop, the Cancel button) closes with `undefined`, and no
 * element is placed.
 *
 * The pick path is a **link-target read** (ADR-0079, #416): a Board Image is not a link — it is a
 * capability URL, decor by construction (ADR-0069) — but it asks the question every link picker asks,
 * *what may this point at?*, so it asks it through the same read rather than a listing seam of its own
 * that would have to learn Mount scope twice. Preset to the asset type + image kind (ADR-0065), it
 * searches by name (FTS `q`) and narrows by image Facets (orientation, hue) — and, in a World that
 * **Mounts** a shelf of art, offers that shelf's images beside this World's own, the World's own ranked
 * first, narrowable to one Container (ADR-0080). Each tile's URL is resolved against *its own* Container,
 * so a placed shelf image renders for every reader of the World it landed in.
 *
 * The picker is stateless beyond its in-flight upload, query, active Facets and the fetched results; the
 * placement itself lives in {@link BoardImagePlacement}, so this component only turns a choice into a URL.
 */
@Component({
  selector: 'app-board-image-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ContainerChipsComponent, DialogComponent, ButtonComponent, FacetSearchInputComponent, TranslocoPipe],
  template: `
    <app-dialog open align="top" [heading]="'board.imagePicker.title' | transloco" (closed)="cancel()">
      <div class="flex flex-col gap-4">
        <!-- Upload: mint a new Asset from a picked file. -->
        <div class="flex flex-col gap-2">
          <label class="text-sm text-ink-strong" for="board-image-upload">
            {{ 'board.imagePicker.upload' | transloco }}
          </label>
          <input
            id="board-image-upload"
            type="file"
            accept="image/*"
            class="text-sm"
            data-testid="image-upload-input"
            [disabled]="uploading()"
            (change)="onFile($event)"
          />
          @if (uploading()) {
            <p class="text-xs text-ink-muted">{{ 'board.imagePicker.uploading' | transloco }}</p>
          }
          @if (error()) {
            <p class="text-xs text-danger" data-testid="image-upload-error">
              {{ 'board.imagePicker.uploadError' | transloco }}
            </p>
          }
        </div>

        <!-- Pick: the link-target read over this World's image Assets and any Mounted shelf's (ADR-0080). -->
        <div class="flex flex-col gap-2">
          <span class="text-sm text-ink-strong">{{ 'board.imagePicker.existing' | transloco }}</span>
          <!-- The shared box (ADR-0082): the image Facets below are typeable as Facet Tokens, off the
               counts this dialog already reads, and a token is reversed by backspacing it. -->
          <app-facet-search-input
            testid="image-search"
            [value]="query()"
            [keys]="tokens.keys()"
            [facets]="facetCounts()"
            [placeholder]="'board.imagePicker.search' | transloco"
            [listLabel]="'board.imagePicker.suggestionsLabel' | transloco"
            (queryChange)="query.set($event)"
          />
          <!-- A dollar-name nothing here answers to is *said*, never quietly searched for (ADR-0082). -->
          @if (tokens.parsed().unresolvedKeys.length > 0) {
            <p class="text-xs text-ink-faint" role="status" data-testid="image-unknown-facet">
              {{ 'board.imagePicker.unknownFacet' | transloco: { keys: tokens.parsed().unresolvedKeys.join(', ') } }}
            </p>
          }

          <!-- The **Container** facet: only where this World Mounts a shelf the read reached (ADR-0080). -->
          <app-container-chips testid="image" [containers]="containers()" [(selected)]="targets.container" />

          <!-- Image Facets (orientation, hue) — the pinned kind axis is hidden, it is never a choice here. -->
          @for (facet of facetGroups(); track facet.key) {
            <div class="flex flex-col gap-1" [attr.data-testid]="'image-facet-' + facet.key">
              <span class="text-xs uppercase tracking-wide text-ink-faint">{{ label(facet) }}</span>
              <div class="flex flex-wrap gap-1">
                @for (value of facet.values; track value.value) {
                  <button
                    type="button"
                    class="facet-chip"
                    [attr.data-testid]="'image-facet-' + facet.key + '-' + value.value"
                    [attr.aria-pressed]="isActive(facet.key, value.value)"
                    (click)="toggleFacet(facet.key, value.value)"
                  >
                    <span>{{ valueLabel(facet, value) }}</span>
                    <span class="text-ink-faint tabular-nums">{{ value.count }}</span>
                  </button>
                }
              </div>
            </div>
          }

          @if (assets(); as list) {
            @if (list.length === 0) {
              <p class="text-xs text-ink-muted" data-testid="image-empty">
                {{ (hasFilters() ? 'board.imagePicker.noMatches' : 'board.imagePicker.empty') | transloco }}
              </p>
            } @else {
              <div class="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto" role="list">
                @for (asset of list; track asset.id) {
                  <button
                    type="button"
                    role="listitem"
                    class="asset-tile"
                    [title]="asset.name"
                    [attr.aria-label]="asset.name"
                    data-testid="image-asset-choice"
                    [attr.data-asset-id]="asset.id"
                    (click)="choose(asset.assetUrl)"
                  >
                    <!-- The thumbnail (ADR-0065), so the grid never downloads raw bytes; it falls back to
                         the original on the serving route when no thumb was minted. -->
                    <img class="w-full h-full object-cover" draggable="false" [src]="asset.thumbnailUrl" alt="" />
                  </button>
                }
              </div>
            }
          } @else {
            <p class="text-xs text-ink-muted">{{ 'board.imagePicker.loading' | transloco }}</p>
          }
        </div>
      </div>

      <button dialogFooter appButton type="button" data-testid="image-picker-cancel" (click)="cancel()">
        {{ 'board.imagePicker.cancel' | transloco }}
      </button>
    </app-dialog>
  `,
  styles: `
    @reference '#app-styles.css';

    .asset-tile {
      @apply block aspect-square w-full overflow-hidden rounded-md border border-line bg-surface-sunken;
      @apply cursor-pointer transition-colors hover:border-accent focus-visible:border-accent outline-none;
    }
    .facet-chip {
      @apply flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs text-ink-strong;
      @apply cursor-pointer transition-colors hover:border-accent aria-pressed:border-accent aria-pressed:bg-accent/15 aria-pressed:text-accent-strong;
    }
  `,
})
export class BoardImagePickerComponent {
  private readonly ref = inject<DialogRef<ImagePickerData, string>>(DialogRef);
  private readonly assetsClient = inject(AssetsClient);
  private readonly entitiesClient = inject(EntitiesClient);
  private readonly i18n = inject(TranslocoService);

  /** In-flight upload guard: disables the file input and shows the uploading hint. */
  protected readonly uploading = signal(false);
  /** Whether the last upload failed — surfaces a retry hint without closing the dialog. */
  protected readonly error = signal(false);

  /** The name-search box (FTS `q`); a change refetches through the pinned entity-search. */
  protected readonly query = signal('');
  /** The active image Facet selections, keyed by dimension (`orientation`/`hue`) → chosen values (OR within). */
  protected readonly activeFacets = signal<Record<string, readonly string[]>>({});

  /**
   * What the box means (ADR-0082). `$type` is out of the vocabulary: the read is pinned to the asset
   * type, and the wire's `type` ORs, so a token there could only widen past the pin — a stated miss.
   */
  protected readonly tokens = pickerFacetTokens(
    () => this.query(),
    () => false,
  );

  /**
   * The one read behind the grid and its rail. A **link-target read** (ADR-0079) preset to the asset type
   * and image kind: the type pin is also what lifts the hidden-from-default-listing exclusion Assets carry
   * (ADR-0065), so they surface here exactly as they always have.
   */
  protected readonly targets = linkTargetRead(
    () => this.ref.data.worldId,
    () => {
      // The residual text and the tokens' own filters, under the pinned type and image kind, beside the
      // chips' selections — a typed Facet and a clicked one AND, as they do everywhere (ADR-0082).
      const { field = [], ...narrowing } = this.tokens.narrowing();
      return {
        ...narrowing,
        type: [CORE_ASSET_TYPE_ID],
        field: [IMAGE_KIND_FIELD_TOKEN, ...field, ...this.fieldTokens()],
      };
    },
  );

  /** The matched image Assets, or null while the current search is in flight. */
  protected readonly assets = signal<PlaceableAsset[] | null>(null);
  /**
   * The live Facet counts — the chips' values, and the box's value typeahead (ADR-0082), off the one
   * read. The pinned `kind` dimension is dropped from the chips: it is never a picker choice.
   */
  protected readonly facetCounts = signal<EntityFacets>(NO_FACETS);
  protected readonly facetGroups = computed<readonly FieldFacet[]>(() =>
    this.facetCounts().fields.filter((f) => f.key !== ASSET_KIND_FACET_KEY),
  );
  /** The **Container** facet's live values — this World and the Shelves it Mounts that still hold a match. */
  protected readonly containers = computed<readonly FacetCount[]>(() => this.facetCounts().container ?? []);
  /** Whether any search is narrowing the set — the empty state then reads "no matches", not "no images". */
  protected readonly hasFilters = computed(
    () =>
      this.query().trim() !== '' ||
      !!this.targets.container() ||
      Object.values(this.activeFacets()).some((v) => v.length > 0),
  );

  constructor() {
    // Search + count through the one link-target read whenever the query, the Facets or the Container
    // narrowing change (ADR-0065, ADR-0080). Both off the same read, so the rail can never annotate a grid
    // it disagrees with. onCleanup cancels superseded requests; a failed search leaves an empty grid, which
    // reads the same as a World with no matching images, and upload still works.
    effect((onCleanup) => {
      const params = this.targets.params();
      // Unpaginated, as this grid has always been: the Facets are what keep the set small, and the cap is
      // the shared list ceiling so an image-heavy World never floods it in one read.
      const search = this.entitiesClient.list({ ...params, thumbnails: true, limit: ENTITY_LIST_MAX_LIMIT }).subscribe({
        // Only what can actually be placed: a wrapper carrying no resolvable bytes has no URL for an
        // Image element to hold, so it is dropped forward-only rather than offered as a dead tile.
        next: (page) => this.assets.set(page.items.filter(isPlaceable)),
        error: () => this.assets.set([]),
      });
      const facets = this.entitiesClient.facets(params).subscribe({
        next: (counts) => this.facetCounts.set(counts),
        error: () => undefined, // a failed count leaves the last-good rail rather than blanking it
      });
      onCleanup(() => {
        search.unsubscribe();
        facets.unsubscribe();
      });
    });
  }

  /** A harvested dimension carries an i18n key the active Locale translates (ADR-0055); fall back to its key. */
  protected label(facet: FieldFacet): string {
    return facet.labelKey ? this.i18n.translate(facet.labelKey) : facet.label;
  }

  /**
   * One Facet value's chip label (ADR-0055/0065). A harvested dimension carries a `valuesKeyPrefix`, so its
   * enum value translates as `<prefix>.<value>`; an untranslated value (or a scalar Field with no prefix)
   * falls back to the raw token — the server-sent `label`, else the value.
   */
  protected valueLabel(facet: FieldFacet, value: FacetCount): string {
    if (facet.valuesKeyPrefix) {
      const key = `${facet.valuesKeyPrefix}.${value.value}`;
      const translated = this.i18n.translate(key);
      if (translated !== key) return translated;
    }
    return value.label ?? value.value;
  }

  /** Whether one Facet value is currently selected. */
  protected isActive(key: string, value: string): boolean {
    return (this.activeFacets()[key] ?? []).includes(value);
  }

  /** Toggle one Facet value on/off; the search effect refetches the narrowed set and counts. */
  protected toggleFacet(key: string, value: string): void {
    const current = this.activeFacets();
    const values = current[key] ?? [];
    const next = values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
    const updated = { ...current };
    if (next.length) updated[key] = next;
    else delete updated[key];
    this.activeFacets.set(updated);
  }

  /** The active Facet selections as the `key:eq:value` tokens the server AND-s with the pinned image kind. */
  private fieldTokens(): string[] {
    const tokens: string[] = [];
    for (const [key, values] of Object.entries(this.activeFacets()))
      for (const value of values) tokens.push(`${key}:eq:${value}`);
    return tokens;
  }

  /** Upload the picked file, then close with its URL; a failure keeps the dialog open with a retry hint. */
  protected onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.error.set(false);
    this.uploading.set(true);
    this.assetsClient.upload(this.ref.data.worldId, file).subscribe({
      // The endpoint returns the wrapper Asset Entity (ADR-0065); the Image element stores its served URL,
      // read off the asset-ref. A wrapper with no readable ref is treated as a failed upload.
      next: (entity) => {
        const value = readAssetValue(entity.document);
        if (value) this.choose(assetValueUrl(this.ref.data.worldId, value));
        else this.failUpload(input);
      },
      error: () => this.failUpload(input),
    });
  }

  /** Close with the chosen Asset URL — the value the Image Tool places an element at. */
  protected choose(url: string): void {
    this.ref.close(url);
  }

  /** An upload that failed (or minted an unreadable wrapper): keep the dialog open with a retry hint. */
  private failUpload(input: HTMLInputElement): void {
    this.uploading.set(false);
    this.error.set(true);
    input.value = '';
  }

  /** Dismiss without choosing; the Image Tool places nothing. */
  protected cancel(): void {
    this.ref.close();
  }
}
