import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { switchMap, takeWhile, timer } from 'rxjs';
import { CompendiumPackSummary, ImporterErrorCode, ImportRunSummary } from '@hexly/domain';
import { HexlyDatePipe, ToasterService } from '@hexly/web-core';
import { ButtonComponent } from '@hexly/web-ui';
import { AdminClient } from '../services/admin.client';

/** How often a running reconcile is polled — the reindex cadence (ADR-0046), one at a time per pack. */
const PACKS_POLL_MS = 1000;

/**
 * The operator's **compendium pack** panel (ADR-0079): install, reimport and removal of the packs a
 * **Compendium** is stocked from, in the admin area rather than World Settings because a pack is
 * Instance-wide.
 *
 * Pack-agnostic like the World Imports panel: the label is a transloco key piped through, so a Plugin
 * supplies its own copy. The reconcile outlives the request, so the panel follows it by re-reading the
 * list — which carries every pack's run, and is therefore both the list and the poll target.
 */
@Component({
  selector: 'app-compendium-packs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, HexlyDatePipe, ButtonComponent],
  template: `
    <ul class="pack-list">
      @for (pack of packs(); track pack.importer) {
        <li class="pack-row" [attr.data-testid]="'pack-' + pack.importer">
          <div class="pack-meta">
            <span class="pack-name">{{ pack.label | transloco }}</span>
            @if (pack.run.status === 'running') {
              <span class="pack-status" [attr.data-testid]="'pack-running-' + pack.importer">
                {{ 'admin.packs.running' | transloco }}
              </span>
            } @else if (pack.run.status === 'failed') {
              <span class="pack-status is-failed" [attr.data-testid]="'pack-error-' + pack.importer">
                {{ 'admin.packs.lastRunFailed' | transloco }}
              </span>
            } @else if (pack.installed; as installed) {
              <span class="pack-status" [attr.data-testid]="'pack-status-' + pack.importer">
                {{
                  'admin.packs.installed'
                    | transloco
                      : {
                          rev: shortRev(installed.rev),
                          count: installed.entryCount,
                          date: installed.updatedAt | hexlyDate,
                        }
                }}
              </span>
            } @else {
              <span class="pack-status" [attr.data-testid]="'pack-uninstalled-' + pack.importer">
                {{ 'admin.packs.notInstalled' | transloco }}
              </span>
            }
          </div>

          <!-- Disabled per row, not per panel: the reconcile serializes on the pack, so a run holds
               that pack alone and another is free to start (ADR-0079). -->
          <button
            appButton
            variant="primary"
            size="sm"
            [attr.data-testid]="'pack-install-' + pack.importer"
            [disabled]="pack.run.status === 'running'"
            (click)="install(pack.importer)"
          >
            {{ (pack.installed ? 'admin.packs.reimport' : 'admin.packs.install') | transloco }}
          </button>
          @if (pack.installed) {
            <button
              appButton
              size="sm"
              danger
              [attr.data-testid]="'pack-remove-' + pack.importer"
              [disabled]="pack.run.status === 'running'"
              (click)="remove(pack.importer)"
            >
              {{ 'admin.packs.remove' | transloco }}
            </button>
          }
        </li>
      } @empty {
        <li class="pack-empty">{{ 'admin.packs.empty' | transloco }}</li>
      }
    </ul>
  `,
  styles: `
    @reference '#app-styles.css';
    .pack-list {
      @apply flex flex-col gap-1;
    }
    .pack-row {
      @apply flex items-center gap-3 py-1;
    }
    .pack-meta {
      @apply flex flex-1 flex-col;
    }
    .pack-name {
      @apply text-ink-strong;
    }
    .pack-status {
      @apply text-2xs text-ink-muted tabular-nums;
    }
    /* A failed run reads as failed, not as an absent line. */
    .pack-status.is-failed {
      @apply text-danger;
    }
    .pack-empty {
      @apply py-1 text-sm text-ink-muted;
    }
  `,
})
export class CompendiumPacksPanelComponent implements OnInit {
  private readonly admin = inject(AdminClient);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly packs = signal<readonly CompendiumPackSummary[]>([]);

  ngOnInit(): void {
    this.reload((packs) => {
      // A reconcile outlives the page that started it, so a reload mid-install rejoins one rather than
      // offering a button that would 409.
      for (const pack of packs) if (pack.run.status === 'running') this.follow(pack.importer);
    });
  }

  /** A git-short rev for the status line; a Draw Steel pack pins a full commit SHA (ADR-0061). */
  protected shortRev(rev: string): string {
    return rev.slice(0, 7);
  }

  /** Install (or reimport) a pack, then follow that pack's reconcile home. */
  protected install(importerId: string): void {
    this.admin.installPack(importerId).subscribe({
      next: () => this.follow(importerId),
      error: (err: unknown) => this.error(this.installErrorKey(err)),
    });
  }

  /** Remove a pack; a refusal toasts and leaves the shelf where it was. */
  protected remove(importerId: string): void {
    this.admin.removePack(importerId).subscribe({
      next: () => {
        this.reload();
        this.toaster.show(this.transloco.translate('admin.packs.removed'), 'success');
      },
      error: () => this.error('admin.packs.removeError'),
    });
  }

  /** Re-read the list, optionally handing it on — the one place a fresh list is adopted. */
  private reload(then?: (packs: readonly CompendiumPackSummary[]) => void): void {
    this.admin.packs().subscribe({
      next: (packs) => {
        this.packs.set(packs);
        then?.(packs);
      },
      error: () => this.error('admin.packs.loadError'),
    });
  }

  /**
   * Poll the list until *this* pack stops running, then announce how its run landed. Keyed by pack
   * rather than by "anything running", since the reconcile serializes per pack: two may be installing
   * at once, and each press deserves the answer to its own. `switchMap` off a `timer` (the reindex
   * pattern, ADR-0046): a poll that never answers is abandoned on the next tick, so one stalled
   * request cannot strand a row as busy.
   */
  private follow(importerId: string): void {
    timer(0, PACKS_POLL_MS)
      .pipe(
        switchMap(() => this.admin.packs()),
        // Inclusive: the first read where this pack has stopped is the one worth announcing.
        takeWhile((packs) => runOf(packs, importerId)?.status === 'running', true),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (packs) => {
          this.packs.set(packs);
          const run = runOf(packs, importerId);
          if (run && run.status !== 'running') this.announce(run);
        },
        error: () => {
          // The reconcile may well be fine; this panel just lost sight of it. Free the controls.
          this.reload();
          this.error('admin.packs.statusError');
        },
      });
  }

  /**
   * Report a run that settled. Anything but `succeeded` is a run that aborted (the fetch threw or a
   * write refused), and is answered by pressing Install again: the chunks that committed stay
   * committed (ADR-0060).
   */
  private announce(run: ImportRunSummary): void {
    if (run.status !== 'succeeded') {
      this.error('admin.packs.runError');
      return;
    }
    const count = run.created + run.updated;
    this.toaster.show(this.transloco.translate('admin.packs.imported', { count }), 'success');
  }

  /** A 409 means a run is already in flight for this pack (ADR-0060); everything else is the generic failure. */
  private installErrorKey(err: unknown): string {
    const code = err instanceof HttpErrorResponse ? (err.error as { code?: string } | null)?.code : undefined;
    return code === ImporterErrorCode.ImportRunning ? 'admin.packs.runningError' : 'admin.packs.runError';
  }

  private error(key: string): void {
    this.toaster.show(this.transloco.translate(key), 'error');
  }
}

/** One pack's run in a freshly read list, or undefined if the Instance stopped offering the pack. */
function runOf(packs: readonly CompendiumPackSummary[], importerId: string): ImportRunSummary | undefined {
  return packs.find((pack) => pack.importer === importerId)?.run;
}
