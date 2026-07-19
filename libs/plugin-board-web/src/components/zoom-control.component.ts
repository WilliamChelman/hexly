import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { IconComponent } from '@hexly/web-ui';

/**
 * The board surface's zoom cluster: zoom out, level, zoom in, reset-view. Purely presentational; the
 * canvas owns the camera (ADR-0003) and wires the actions (ADR-0007). The free-positioned twin of the
 * Hex Map's zoom control.
 */
@Component({
  selector: 'app-board-zoom-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'group',
    '[attr.aria-label]': 'groupLabel()',
    class: 'flex items-center gap-[2px] p-[3px] border border-line rounded-lg shadow-2 backdrop-blur-[4px]',
  },
  imports: [IconComponent, TranslocoPipe],
  template: `
    <button type="button" class="zbtn" [attr.aria-label]="'board.canvas.zoomOut' | transloco" (click)="zoomOut.emit()">
      <app-icon name="minus" [size]="16" />
    </button>
    <span class="lvl">{{ percent() }}%</span>
    <button type="button" class="zbtn" [attr.aria-label]="'board.canvas.zoomIn' | transloco" (click)="zoomIn.emit()">
      <app-icon name="plus" [size]="16" />
    </button>
    <span class="div"></span>
    <button type="button" class="zbtn" [attr.aria-label]="'board.canvas.fit' | transloco" (click)="fit.emit()">
      <app-icon name="fit" [size]="16" />
    </button>
  `,
  styles: `
    @reference '#app-styles.css';

    :host {
      background: color-mix(in oklab, var(--color-surface) 88%, transparent);
    }
    .zbtn {
      @apply inline-grid place-items-center w-8 h-7 border-0 bg-transparent
        text-ink-muted rounded-md cursor-pointer;
      /* transition on motion tokens (--dur-… / --ease-…) has no utility form — stays raw. */
      transition:
        background-color var(--dur-fast) var(--ease-out),
        color var(--dur-fast) var(--ease-out);
    }
    .zbtn:hover {
      @apply bg-gold-soft text-gold;
    }
    .lvl {
      @apply min-w-[3.4em] text-center font-mono text-2xs tracking-[0.02em] text-ink;
    }
    .div {
      @apply w-px h-4 bg-line;
      margin: 0 2px;
    }
  `,
})
export class ZoomControlComponent {
  private readonly transloco = inject(TranslocoService);

  readonly percent = input.required<number>();

  readonly zoomIn = output<void>();
  readonly zoomOut = output<void>();
  readonly fit = output<void>();

  protected readonly groupLabel = toSignal(this.transloco.selectTranslate('board.canvas.zoom'), {
    initialValue: '',
  });
}
