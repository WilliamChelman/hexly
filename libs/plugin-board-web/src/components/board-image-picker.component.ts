import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AssetSummary } from '@hexly/domain';
import { assetValueUrl, readAssetValue } from '@hexly/plugin-asset';
import { AssetsClient } from '@hexly/web-core';
import { ButtonComponent, DialogComponent, DialogRef } from '@hexly/web-ui';

/** What the picker is launched with: the World whose Assets it uploads into and lists. */
export interface ImagePickerData {
  readonly worldId: string;
}

/**
 * The **Image** source chooser (#269): the one dialog the Image Tool opens to obtain an Asset URL before
 * an Image element lands. Two paths to the same result — **upload a file** (mints a new World Asset in
 * one step) or **pick an existing** World Asset — both {@link DialogRef.close close} the dialog with the
 * served capability URL. Cancelling (Escape, backdrop, the Cancel button) closes with `undefined`, and no
 * element is placed.
 *
 * The picker is stateless beyond its in-flight upload and the fetched Asset list; the placement itself
 * lives in {@link BoardImagePlacement}, so this component only turns a user's choice into a URL.
 */
@Component({
  selector: 'app-board-image-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogComponent, ButtonComponent, TranslocoPipe],
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

        <!-- Pick: reuse an Asset already in this World. -->
        <div class="flex flex-col gap-2">
          <span class="text-sm text-ink-strong">{{ 'board.imagePicker.existing' | transloco }}</span>
          @if (assets(); as list) {
            @if (list.length === 0) {
              <p class="text-xs text-ink-muted">{{ 'board.imagePicker.empty' | transloco }}</p>
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
  /** The World's existing Assets, or null while the list is loading. */
  protected readonly assets = signal<AssetSummary[] | null>(null);

  constructor() {
    // Fetch the existing Assets up front so the "pick" grid is ready; a failure (incl. a 403 for a
    // Viewer who can't enumerate — board review) leaves an empty grid, which reads the same as a
    // World with no Assets — upload still works. Non-image Assets (e.g. a PDF) are filtered out: the
    // grid renders each tile as an `<img>`, so only image mimes belong in an Image picker.
    this.assetsClient.list(this.ref.data.worldId).subscribe({
      next: (list) => this.assets.set(list.filter((a) => a.mime.startsWith('image/'))),
      error: () => this.assets.set([]),
    });
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
