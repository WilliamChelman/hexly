import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { type AssetStorageMoveProgress, type AssetStorageMoveRefusal, DESKTOP_BRIDGE } from '@hexly/web-core';
import { ButtonComponent, DialogComponent, DialogRef } from '@hexly/web-ui';

/**
 * `choosing` is the native folder picker main opens as this dialog mounts; `moved` is terminal in the sense
 * that matters — the app is already on its way to relaunching.
 */
type MoveState = 'choosing' | 'copying' | 'cancelling' | 'moved' | 'failed';

/**
 * The Desktop App's Asset-storage move, as the user sees it (#326). It exists because the copy can be
 * gigabytes: it is where progress is reported and the only place the move can be cancelled. The move *is* the
 * dialog — opening it starts the picker, closing it cancels a copy in flight.
 */
@Component({
  selector: 'app-move-asset-storage-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, DialogComponent, TranslocoPipe],
  template: `
    <app-dialog [open]="true" align="top" [heading]="'assetStorage.heading' | transloco" (closed)="dismiss()">
      <!-- One live region for every state, so a screen reader hears the copy finish without being flooded. -->
      <div class="flex flex-col gap-3" aria-live="polite">
        @switch (state()) {
          @case ('choosing') {
            <p class="m-0 text-sm text-ink-muted" data-testid="asset-move-choosing">
              {{ 'assetStorage.choosing' | transloco }}
            </p>
          }
          @case ('copying') {
            <p class="m-0 text-sm text-ink" data-testid="asset-move-progress">
              {{ 'assetStorage.copying' | transloco: counts() }}
            </p>
            <div
              class="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken"
              role="progressbar"
              aria-valuemin="0"
              aria-valuemax="100"
              [attr.aria-valuenow]="percent()"
            >
              <!-- Bytes, not files: one 4 GB map among a hundred thumbnails would make a file count lie. -->
              <div
                class="h-full rounded-full bg-accent transition-[width] duration-200 motion-reduce:transition-none"
                [style.width.%]="percent()"
              ></div>
            </div>
            <p class="m-0 truncate text-xs text-ink-faint" data-testid="asset-move-file">{{ file() }}</p>
          }
          @case ('cancelling') {
            <p class="m-0 text-sm text-ink-muted" data-testid="asset-move-cancelling">
              {{ 'assetStorage.cancelling' | transloco }}
            </p>
          }
          @case ('moved') {
            <p class="m-0 text-sm text-ink" data-testid="asset-move-done">
              {{ 'assetStorage.moved' | transloco: moved() }}
            </p>
          }
          @case ('failed') {
            <p class="m-0 text-sm text-ink" data-testid="asset-move-failed">
              {{ 'assetStorage.failedTitle' | transloco }}
            </p>
            <!-- Our own refusal is a code with copy of its own; a filesystem message can only be passed through. -->
            <p class="m-0 text-sm text-ink-muted" data-testid="asset-move-reason">
              {{ refusal() ? ('assetStorage.refused.' + refusal() | transloco) : reason() }}
            </p>
          }
        }
      </div>

      @if (state() === 'copying') {
        <button dialogFooter type="button" appButton data-testid="asset-move-cancel" (click)="cancel()">
          {{ 'common.cancel' | transloco }}
        </button>
      }
      @if (state() === 'failed') {
        <button dialogFooter type="button" appButton data-testid="asset-move-close" (click)="close()">
          {{ 'common.close' | transloco }}
        </button>
      }
    </app-dialog>
  `,
})
export class MoveAssetStorageDialogComponent {
  private readonly dialogRef = inject(DialogRef) as DialogRef<void, void>;
  private readonly bridge = inject(DESKTOP_BRIDGE);

  protected readonly state = signal<MoveState>('choosing');
  private readonly progress = signal<AssetStorageMoveProgress | null>(null);
  protected readonly reason = signal('');
  protected readonly refusal = signal<AssetStorageMoveRefusal | null>(null);
  protected readonly moved = signal({ count: 0, folder: '' });

  protected readonly counts = computed(() => ({
    copied: this.progress()?.copiedFiles ?? 0,
    total: this.progress()?.totalFiles ?? 0,
  }));
  protected readonly file = computed(() => this.progress()?.file ?? '');
  protected readonly percent = computed(() => {
    const progress = this.progress();
    if (!progress?.totalBytes) return 0;
    return Math.round((progress.copiedBytes / progress.totalBytes) * 100);
  });

  constructor() {
    void this.run();
  }

  private async run(): Promise<void> {
    // Only ever opened from a Command that checked the bridge, so this is the type narrowing rather than a gate.
    if (!this.bridge) return this.dialogRef.close();

    const outcome = await this.bridge.moveAssetStorage((progress) => {
      this.progress.set(progress);
      // The first report is also how the picker's dismissal is told from a copy that has begun.
      if (this.state() === 'choosing') this.state.set('copying');
    });

    switch (outcome.status) {
      case 'moved':
        this.moved.set({ count: outcome.files, folder: outcome.to });
        this.state.set('moved');
        return;
      case 'failed':
        this.reason.set(outcome.reason);
        this.state.set('failed');
        return;
      case 'refused':
        this.refusal.set(outcome.refusal);
        this.state.set('failed');
        return;
      default:
        // Dismissed or cancelled: the user's own gesture, and the Assets are where they were.
        this.dialogRef.close();
    }
  }

  /** Ask main to stop. The dialog stays up until it answers, because an abort mid-file is not instant. */
  protected cancel(): void {
    this.state.set('cancelling');
    this.bridge?.cancelAssetStorageMove();
  }

  protected close(): void {
    this.dialogRef.close();
  }

  /**
   * Escape or the backdrop. Unless the move has already settled that is a cancel — `choosing` included, where
   * the copy is about to start — so no unreported copy is left running with a relaunch at the end of it.
   */
  protected dismiss(): void {
    if (this.state() === 'choosing' || this.state() === 'copying') this.cancel();
    this.dialogRef.close();
  }
}
