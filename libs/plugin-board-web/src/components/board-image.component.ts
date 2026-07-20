import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { IconComponent } from '@hexly/web-ui';
import { ImageElement } from '@hexly/plugin-board';

/**
 * An **Image** Board Element's face (#269): the World Asset at the element's `assetUrl`, drawn to fill
 * the element's box (`object-contain`, so the whole picture shows without distortion). Always static —
 * an Image has no edit mode, so this host is `pointer-events-none`: every press falls through to the
 * element box above the canvas, which owns select/drag/resize (CONTEXT.md → Image).
 *
 * An Asset that fails to load — deleted, or a URL that never resolved — degrades to a graceful
 * **placeholder** rather than a broken-image glyph, so one missing Asset never breaks the surface. The
 * broken state is keyed to the failing URL, so re-pointing the element at a good Asset recovers on its own.
 */
@Component({
  selector: 'app-board-image',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block w-full h-full pointer-events-none select-none' },
  imports: [IconComponent],
  template: `
    @if (missing()) {
      <div class="placeholder" role="img" [attr.aria-label]="missingLabel()" [attr.data-testid]="'image-placeholder'">
        <app-icon name="board-image" [size]="32" />
        <span class="label">{{ missingLabel() }}</span>
      </div>
    } @else {
      <img
        class="image"
        draggable="false"
        [src]="src()"
        [attr.alt]="alt()"
        [attr.data-testid]="'image-asset'"
        (error)="onError()"
      />
    }
  `,
  styles: `
    @reference '#app-styles.css';

    .image {
      @apply w-full h-full object-contain;
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
    .placeholder svg {
      @apply w-8 h-8 opacity-70;
    }
    .placeholder .label {
      @apply text-xs text-center;
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

  /** Whether to show the placeholder: no Asset set, or the current one failed to load. */
  protected readonly missing = computed(() => this.src() === '' || this.brokenSrc() === this.src());

  protected readonly alt = computed(() => this.i18n.translate('board.canvas.image'));
  protected readonly missingLabel = computed(() => this.i18n.translate('board.canvas.missingAsset'));

  /** Mark the current Asset URL broken so the render falls back to the placeholder. */
  protected onError(): void {
    this.brokenSrc.set(this.src());
  }
}
