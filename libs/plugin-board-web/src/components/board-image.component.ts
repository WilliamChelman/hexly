import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { ButtonComponent, IconComponent } from '@hexly/web-ui';
import { ImageElement } from '@hexly/plugin-board';

/**
 * An **Image** Board Element's face (#269): the World Asset at the element's `assetUrl`, drawn to fill
 * the element's box (`object-contain`, so the whole picture shows without distortion). Always static —
 * an Image has no edit mode, so this host is `pointer-events-none`: every press falls through to the
 * element box above the canvas, which owns select/drag/resize (CONTEXT.md → Image). While the Asset
 * fetch is in flight the frame carries a quiet pulsing wash, so a slow load reads as loading, not blank.
 *
 * An Asset that fails to load — deleted, or a URL that never resolved — degrades to a graceful
 * **placeholder** rather than a broken-image glyph, so one missing Asset never breaks the surface. The
 * broken state is keyed to the failing URL, so re-pointing the element at a good Asset recovers on its
 * own; a **retry** affordance covers the transient failure (network blip) where the URL itself is fine.
 */
@Component({
  selector: 'app-board-image',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative block w-full h-full pointer-events-none select-none' },
  imports: [ButtonComponent, IconComponent],
  template: `
    @if (missing()) {
      <div class="placeholder" [attr.data-testid]="'image-placeholder'">
        <div class="badge" role="img" [attr.aria-label]="missingLabel()">
          <app-icon name="board-image" [size]="32" />
          <span class="label">{{ missingLabel() }}</span>
        </div>
        <!-- Retry only when a URL actually failed (nothing to re-attempt with no Asset set). The host is
             pointer-events-none, so the button re-enables its own pointer and swallows the press so it
             never starts a select/drag on the element box. -->
        @if (broken()) {
          <button
            type="button"
            appButton
            variant="ghost"
            size="sm"
            class="retry"
            data-testid="image-retry"
            (pointerdown)="$event.stopPropagation()"
            (click)="retry(); $event.stopPropagation()"
          >
            {{ retryLabel() }}
          </button>
        }
      </div>
    } @else {
      @if (!loaded()) {
        <div
          class="loading"
          role="status"
          [attr.aria-label]="loadingLabel()"
          [attr.data-testid]="'image-loading'"
        ></div>
      }
      <img
        class="image"
        draggable="false"
        [class.opacity-0]="!loaded()"
        [src]="src()"
        [attr.alt]="alt()"
        [attr.data-testid]="'image-asset'"
        (load)="onLoad()"
        (error)="onError()"
      />
    }
  `,
  styles: `
    @reference '#app-styles.css';

    .image {
      @apply w-full h-full object-contain transition-opacity;
    }
    /* The in-flight wash: a quiet pulse over the frame until the Asset resolves or fails. */
    .loading {
      @apply absolute inset-0 animate-pulse;
      background: color-mix(in srgb, var(--color-line) 16%, transparent);
    }
    .placeholder {
      @apply w-full h-full flex flex-col items-center justify-center gap-1 p-2 text-ink-muted;
      background: repeating-linear-gradient(
        45deg,
        color-mix(in srgb, var(--color-line) 22%, transparent),
        color-mix(in srgb, var(--color-line) 22%, transparent) 8px,
        transparent 8px,
        transparent 16px
      );
    }
    /* The glyph + label group; role="img" lives here, not the container, so the retry button stays exposed. */
    .placeholder .badge {
      @apply flex flex-col items-center gap-1;
    }
    .placeholder svg {
      @apply w-8 h-8 opacity-70;
    }
    .placeholder .label {
      @apply text-xs text-center;
    }
    .placeholder .retry {
      @apply pointer-events-auto;
    }
  `,
})
export class BoardImageComponent {
  /** The Image element this renders — its `assetUrl` and geometry. */
  readonly element = input.required<ImageElement>();

  private readonly i18n = inject(TranslocoService);

  /** The Asset URL to draw; the served capability URL the element stores. */
  protected readonly src = computed(() => this.element().assetUrl);

  /** The URL that failed to load, if any — so a broken Asset recovers when the element is re-pointed. */
  private readonly brokenSrc = signal<string | null>(null);

  /** The URL the `<img>` last finished loading, so the in-flight wash shows only while a fetch is pending. */
  private readonly loadedSrc = signal<string | null>(null);

  /** Whether the current Asset URL failed to load — the placeholder state that offers a retry. */
  protected readonly broken = computed(() => this.src() !== '' && this.brokenSrc() === this.src());

  /** Whether to show the placeholder: no Asset set, or the current one failed to load. */
  protected readonly missing = computed(() => this.src() === '' || this.broken());

  /** Whether the current Asset URL has resolved — until then the wash pulses and the image stays hidden. */
  protected readonly loaded = computed(() => this.loadedSrc() === this.src());

  protected readonly alt = computed(() => this.i18n.translate('board.canvas.image'));
  protected readonly missingLabel = computed(() => this.i18n.translate('board.canvas.missingAsset'));
  protected readonly loadingLabel = computed(() => this.i18n.translate('board.canvas.imageLoading'));
  protected readonly retryLabel = computed(() => this.i18n.translate('board.canvas.imageRetry'));

  /** Mark the current Asset URL broken so the render falls back to the placeholder. */
  protected onError(): void {
    this.brokenSrc.set(this.src());
  }

  /** Record the resolved URL so the wash drops — and shows again if the element is re-pointed. */
  protected onLoad(): void {
    this.loadedSrc.set(this.src());
  }

  /** Clear the broken flag: the `@if` remounts the `<img>`, re-attempting the same URL (a transient failure). */
  protected retry(): void {
    this.brokenSrc.set(null);
  }
}
