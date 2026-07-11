import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ReindexJob } from '@hexly/domain';
import { switchMap, takeWhile, timer } from 'rxjs';
import { AdminClient, ToasterService } from '@hexly/web-core';
import { Eyebrow, Panel, Button } from '@hexly/web-ui';

/**
 * How often a running Reindex is polled. Slow enough to cost the server nothing next to the walk
 * it watches, fast enough that the count visibly moves.
 */
const REINDEX_POLL_MS = 1000;

/**
 * The Superadmin repair surface (ADR-0046): the Reindex, which recomputes every Entity's
 * document-derived state. The tier outside the collaboration model — no Entity is reachable to a
 * plain user-manager, so this lives apart from the {@link Users} account panel. The walk outlives
 * the request that starts it, so the panel follows it by polling; the server is the source of
 * truth for whether one is running.
 */
@Component({
  selector: 'app-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Eyebrow, Panel, Button],
  template: `
    <section class="admin">
      <span appEyebrow>{{ 'admin.heading' | transloco }}</span>
      <h1 class="admin-heading">{{ 'admin.heading' | transloco }}</h1>

      <h2 class="admin-heading text-xl">{{ 'admin.reindex.heading' | transloco }}</h2>
      <div appPanel class="admin-panel">
        <p class="admin-subhead">{{ 'admin.reindex.description' | transloco }}</p>
        <div>
          <button appButton data-testid="reindex" [disabled]="reindexing()" (click)="reindex()">
            @if (reindexing()) {
              {{ 'admin.reindex.progress' | transloco: progress() }}
            } @else {
              {{ 'admin.reindex.submit' | transloco }}
            }
          </button>
        </div>
      </div>
    </section>
  `,
  styles: `
    @reference '#app-styles.css';
    .admin { @apply mx-auto flex w-full max-w-5xl flex-col gap-3 p-6; }
    .admin-heading { @apply font-display text-2xl text-ink-strong; }
    .admin-subhead { @apply text-sm text-ink-muted; }
    .admin-panel { @apply flex flex-col gap-3 p-4; }
  `,
})
export class Admin {
  private readonly admin = inject(AdminClient);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly destroyRef = inject(DestroyRef);

  /** The instance's Reindex job, as last seen from the server. `null` until one is fetched. */
  protected readonly job = signal<ReindexJob | null>(null);
  /** The server's word, not a local latch — so a reload mid-walk still finds the button busy. */
  protected readonly reindexing = computed(() => this.job()?.status === 'running');
  protected readonly progress = computed(() => ({
    walked: this.job()?.walked ?? 0,
    total: this.job()?.total ?? 0,
  }));

  constructor() {
    // A Reindex outlives the page that started it. Rejoin one already walking.
    this.admin.reindexStatus().subscribe((job) => this.follow(job));
  }

  /**
   * The Superadmin Reindex (ADR-0046): recompute every Entity's derived state.
   *
   * The walk outlives its request, so the POST only starts it; {@link follow} watches it home.
   */
  protected reindex(): void {
    if (this.reindexing()) return;
    this.admin.reindex().subscribe({
      next: (job) => this.follow(job),
      error: (err: unknown) => this.toaster.show(this.errorMessage(err), 'error'),
    });
  }

  /**
   * Adopt `job`, and if it is still walking, poll until it stops — then announce how it landed.
   *
   * `switchMap` off a `timer` rather than a chain of delays: a poll that never answers is
   * abandoned when the next tick fires, so a single stalled request cannot strand the button in
   * its disabled state. The status is the server's, so there is no local latch to leak.
   */
  private follow(job: ReindexJob): void {
    this.job.set(job);
    if (job.status !== 'running') return;
    timer(REINDEX_POLL_MS, REINDEX_POLL_MS)
      .pipe(
        switchMap(() => this.admin.reindexStatus()),
        // Inclusive: the first non-running poll is the one worth announcing.
        takeWhile((j) => j.status === 'running', true),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (j) => {
          this.job.set(j);
          if (j.status !== 'running') this.announce(j);
        },
        error: (err: unknown) => {
          // The walk may well be fine; this page just lost sight of it. Free the button.
          this.job.set(null);
          this.toaster.show(this.errorMessage(err), 'error');
        },
      });
  }

  /**
   * Report a finished Reindex: how much it rebuilt, and what it could not read.
   *
   * Anything but `succeeded` is a walk that did not land. `failed` is the database refusing;
   * `idle` is the API having restarted and forgotten a job we watched start — neither is a
   * success, and both are answered by pressing the button again, since the chunks that committed
   * stay committed.
   */
  private announce(job: ReindexJob): void {
    if (job.status !== 'succeeded') {
      this.toaster.show(this.transloco.translate('admin.toast.reindexAborted'), 'error');
      return;
    }
    if (job.failures.length > 0) {
      this.toaster.show(
        this.transloco.translate('admin.toast.reindexedWithFailures', {
          count: job.reindexed,
          failed: job.failures.length,
        }),
        'error',
      );
      return;
    }
    this.toaster.show(
      this.transloco.translate('admin.toast.reindexed', { count: job.reindexed }),
      'success',
    );
  }

  /** Localize the server's structured error code (`admin.error.<code>`); no
   * English is matched off the wire. */
  private errorMessage(err: unknown): string {
    const code =
      err instanceof HttpErrorResponse ? (err.error as { code?: string } | null)?.code : undefined;
    const key = code ? `admin.error.${code}` : 'admin.toast.error';
    const message = this.transloco.translate(key);
    // Transloco echoes the key back on a miss — fall back to the generic message.
    return message === key ? this.transloco.translate('admin.toast.error') : message;
  }
}
