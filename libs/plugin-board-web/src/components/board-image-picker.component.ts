import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AssetSummary, EntityFacets, FieldFacet } from '@hexly/domain';
import { assetValueUrl, ASSET_KIND_FACET_KEY, readAssetValue } from '@hexly/plugin-asset';
import { AssetsClient, AssetSearchParams } from '@hexly/web-core';
import { ButtonComponent, DialogComponent, DialogRef, InputComponent } from '@hexly/web-ui';

/** What the picker is launched with: the World whose Assets it uploads into and searches. */
export interface ImagePickerData {
  readonly worldId: string;
}

/** An empty Facet snapshot — the rail's resting state before the first counts land. */
const NO_FACETS: EntityFacets = { type: [], tag: [], visibility: [], fields: [] };

/**
 * The **Image** source chooser (#269, #281): the one dialog the Image Tool opens to obtain an Asset URL
 * before an Image element lands. Two paths to the same result — **upload a file** (mints a new World Asset
 * in one step) or **pick an existing** World Asset — both {@link DialogRef.close close} the dialog with the
 * served capability URL. Cancelling (Escape, backdrop, the Cancel button) closes with `undefined`, and no
 * element is placed.
 *
 * The pick path reuses the one entity-search machinery, pinned server-side to the asset type + image kind
 * (ADR-0065): it searches Assets by name (FTS `q`) and filters by image Facets (orientation, hue) — the
 * same contract as the Asset Browser — rather than listing every upload and filtering mimes client-side, so
 * picking art on an image-heavy World is fast. The picker is stateless beyond its in-flight upload, query,
 * active Facets and the fetched results; the placement itself lives in {@link BoardImagePlacement}, so this
 * component only turns a user's choice into a URL.
 */
@Component({
  selector: 'app-board-image-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogComponent, ButtonComponent, InputComponent, TranslocoPipe],
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
            <p class="text-xs text-ember" data-testid="image-upload-error">
              {{ 'board.imagePicker.uploadError' | transloco }}
            </p>
          }
        </div>

        <!-- Pick: search + Facets over the World's image Assets (same contract as the Asset Browser). -->
        <div class="flex flex-col gap-2">
          <span class="text-sm text-ink-strong">{{ 'board.imagePicker.existing' | transloco }}</span>
          <input
            appInput
            type="search"
            data-testid="image-search"
            [attr.placeholder]="'board.imagePicker.search' | transloco"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
          />

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
                    <span>{{ value.label ?? value.value }}</span>
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
                @for (asset of list; track asset.url) {
                  <button
                    type="button"
                    role="listitem"
                    class="asset-tile"
                    [title]="asset.originalFilename"
                    [attr.aria-label]="asset.originalFilename"
                    data-testid="image-asset-choice"
                    (click)="choose(asset.url)"
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
      @apply cursor-pointer transition-colors hover:border-gold focus-visible:border-gold outline-none;
    }
    .facet-chip {
      @apply flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs text-ink-strong;
      @apply cursor-pointer transition-colors hover:border-gold aria-pressed:border-gold aria-pressed:bg-gold/15 aria-pressed:text-gold;
    }
  `,
})
export class BoardImagePickerComponent {
  private readonly ref = inject<DialogRef<ImagePickerData, string>>(DialogRef);
  private readonly assetsClient = inject(AssetsClient);
  private readonly i18n = inject(TranslocoService);

  /** In-flight upload guard: disables the file input and shows the uploading hint. */
  protected readonly uploading = signal(false);
  /** Whether the last upload failed — surfaces a retry hint without closing the dialog. */
  protected readonly error = signal(false);

  /** The name-search box (FTS `q`); a change refetches through the pinned entity-search. */
  protected readonly query = signal('');
  /** The active image Facet selections, keyed by dimension (`orientation`/`hue`) → chosen values (OR within). */
  protected readonly activeFacets = signal<Record<string, readonly string[]>>({});

  /** The matched image Assets, or null while the current search is in flight. */
  protected readonly assets = signal<AssetSummary[] | null>(null);
  /** The live Facet counts; the pinned `kind` dimension is dropped — it is never a picker choice. */
  private readonly facetCounts = signal<EntityFacets>(NO_FACETS);
  protected readonly facetGroups = computed<readonly FieldFacet[]>(() =>
    this.facetCounts().fields.filter((f) => f.key !== ASSET_KIND_FACET_KEY),
  );
  /** Whether any search is narrowing the set — the empty state then reads "no matches", not "no images". */
  protected readonly hasFilters = computed(
    () => this.query().trim() !== '' || Object.values(this.activeFacets()).some((v) => v.length > 0),
  );

  constructor() {
    // Search + count through the one entity-search machinery whenever the query or Facets change (ADR-0065).
    // onCleanup cancels superseded requests. A failure (incl. a 403 for a Viewer who can't enumerate — board
    // review) leaves an empty grid, which reads the same as a World with no matching images; upload still works.
    effect((onCleanup) => {
      const params: AssetSearchParams = { q: this.query().trim() || undefined, field: this.fieldTokens() };
      const search = this.assetsClient.search(this.ref.data.worldId, params).subscribe({
        next: (list) => this.assets.set(list),
        error: () => this.assets.set([]),
      });
      const facets = this.assetsClient.facets(this.ref.data.worldId, params).subscribe({
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
