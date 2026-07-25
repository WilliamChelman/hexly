import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { switchMap, takeWhile, timer } from 'rxjs';
import { ImporterErrorCode, ImporterSummary, ImportRunSummary, Visibility } from '@hexly/domain';
import { ClientConfigStore, HexlyDatePipe, ToasterService, WorldsClient } from '@hexly/web-core';
import { ButtonComponent, SelectComponent } from '@hexly/web-ui';

/** How often a running reconcile is polled — the reindex cadence (ADR-0046), one at a time per World. */
const IMPORT_POLL_MS = 1000;

/**
 * A row's status line, either a live in-process run or the durable last-imported state (#260). `failed`
 * carries no detail — it renders its own distinct copy; `succeeded` carries the revision, count, and date
 * the line shows, sourced from the in-process job or the provenance-index summary interchangeably.
 */
type ImporterStatusLine =
  | { readonly kind: 'running' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'succeeded'; readonly rev: string | null; readonly count: number; readonly date: number | null };

/**
 * The generic World-Owner Imports panel (ADR-0060): it lists whatever {@link Importer}s the enabled
 * Plugins registered for this World and, per row, offers Import/Reimport, Remove, and a
 * shared/private Visibility (cut with the rest of Visibility when Collaboration is off, ADR-0071).
 * Importer-agnostic — the label is the summary's transloco key piped
 * through, so a Plugin (e.g. Draw Steel) supplies its copy via its web catalogs and this panel never
 * names it. The reconcile outlives the request that starts it, so the panel follows the one run per
 * World by polling; the server's status is the source of truth for whether one is in flight.
 */
@Component({
  selector: 'app-world-imports',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, HexlyDatePipe, ButtonComponent, SelectComponent],
  template: `
    <ul class="importer-list">
      @for (imp of importers(); track imp.id) {
        <li class="importer-row" [attr.data-testid]="'importer-' + imp.id">
          <div class="importer-meta">
            <span class="importer-name">{{ imp.label | transloco }}</span>
            @if (statusFor(imp); as st) {
              @switch (st.kind) {
                @case ('running') {
                  <span class="importer-status" [attr.data-testid]="'importer-running-' + imp.id">
                    {{ 'imports.running' | transloco }}
                  </span>
                }
                @case ('failed') {
                  <span class="importer-status is-failed" [attr.data-testid]="'importer-error-' + imp.id">
                    {{ 'imports.lastRunFailed' | transloco }}
                  </span>
                }
                @case ('succeeded') {
                  <span class="importer-status" [attr.data-testid]="'importer-status-' + imp.id">
                    {{
                      'imports.lastRun'
                        | transloco
                          : {
                              rev: shortRev(st.rev),
                              count: st.count,
                              date: st.date ? (st.date | hexlyDate) : '',
                            }
                    }}
                  </span>
                }
              }
            }
          </div>

          <!-- Visibility goes with every other Visibility affordance when Collaboration is off (ADR-0071). -->
          @if (collaboration()) {
            <select
              appSelect
              class="importer-visibility"
              [attr.aria-label]="'imports.visibility' | transloco"
              [attr.data-testid]="'importer-visibility-' + imp.id"
              [value]="visibilityFor(imp.id)"
              [disabled]="running()"
              (change)="setVisibility(imp.id, $event)"
            >
              <option value="shared">{{ 'imports.shared' | transloco }}</option>
              <option value="private">{{ 'imports.private' | transloco }}</option>
            </select>
          }

          <button
            appButton
            variant="primary"
            size="sm"
            [attr.data-testid]="'importer-run-' + imp.id"
            [disabled]="running()"
            (click)="run(imp.id)"
          >
            {{ (hasRun(imp) ? 'imports.reimport' : 'imports.import') | transloco }}
          </button>
          <button
            appButton
            size="sm"
            danger
            [attr.data-testid]="'importer-remove-' + imp.id"
            [disabled]="running()"
            (click)="remove(imp.id)"
          >
            {{ 'imports.remove' | transloco }}
          </button>
        </li>
      } @empty {
        <li class="importer-empty">{{ 'imports.empty' | transloco }}</li>
      }
    </ul>
  `,
  styles: `
    @reference '#app-styles.css';
    .importer-list {
      @apply flex flex-col gap-1;
    }
    .importer-row {
      @apply flex items-center gap-3 py-1;
    }
    .importer-meta {
      @apply flex flex-1 flex-col;
    }
    .importer-name {
      @apply text-ink-strong;
    }
    .importer-status {
      @apply text-2xs text-ink-muted tabular-nums;
    }
    /* A failed run reads as failed, not as an empty success line (#262 review). */
    .importer-status.is-failed {
      @apply text-ember;
    }
    .importer-empty {
      @apply py-1 text-sm text-ink-muted;
    }
  `,
})
export class WorldImportsPanelComponent implements OnInit {
  readonly id = input.required<string>();

  private readonly worlds = inject(WorldsClient);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly clientConfig = inject(ClientConfigStore);

  /** Whether the Collaboration layer is on (ADR-0071) — with it off an import has no Visibility to choose. */
  protected readonly collaboration = computed(() => this.clientConfig.isCollaborationEnabled());

  protected readonly importers = signal<readonly ImporterSummary[]>([]);
  /** The World's one import run as last seen from the server; `null` until fetched. Drives the busy state. */
  protected readonly status = signal<ImportRunSummary | null>(null);
  /** Per-Importer Visibility choice for the next run; defaults to `shared`, the panel's opening stance. */
  private readonly visibility = signal<Record<string, Visibility>>({});

  /** The server's word, not a local latch — a reload mid-run still finds one importer busy. */
  protected readonly running = computed(() => this.status()?.status === 'running');

  /** Set once a user-initiated run establishes live state, so a slow initial GET can't rewind it (#262 review). */
  private runEstablished = false;

  ngOnInit(): void {
    this.loadImporters();
    // A reconcile outlives the page that started it — rejoin one already running, and seed the last-run line.
    this.worlds.importStatus(this.id()).subscribe({
      // A user-initiated run may resolve before this initial GET; a late `idle` must not rewind the
      // live state it established, or the controls re-enable mid-run (#262 review).
      next: (job) => {
        if (this.runEstablished) return;
        this.follow(job);
      },
      // A status fetch failing shouldn't blank the whole panel; the list still renders and a run re-seeds it.
      error: () => undefined,
    });
  }

  protected visibilityFor(importerId: string): Visibility {
    // No toggle means no intent to honour: the import mints at the schema default (ADR-0071).
    return this.visibility()[importerId] ?? (this.collaboration() ? 'shared' : 'private');
  }

  protected setVisibility(importerId: string, event: Event): void {
    const value = (event.target as HTMLSelectElement).value as Visibility;
    this.visibility.update((all) => ({ ...all, [importerId]: value }));
  }

  /**
   * The status line for one row: a live in-process run for this Importer wins, else the durable
   * last-imported line derived from the provenance index on the list payload — so the line survives
   * an API restart (#260) and a failed run reads as failed, not as an empty success line (#262 review).
   */
  protected statusFor(imp: ImporterSummary): ImporterStatusLine | null {
    const job = this.status();
    if (job && job.importer === imp.id && job.status !== 'idle') {
      if (job.status === 'succeeded') {
        return { kind: 'succeeded', rev: job.rev, count: job.created + job.updated, date: job.finishedAt };
      }
      return { kind: job.status };
    }
    const last = imp.lastImported;
    return last ? { kind: 'succeeded', rev: last.rev, count: last.entityCount, date: last.updatedAt } : null;
  }

  /** Whether this World has an imported set on record for this Importer — flips the action to Reimport. */
  protected hasRun(imp: ImporterSummary): boolean {
    return this.status()?.importer === imp.id || imp.lastImported !== undefined;
  }

  /** A git-short rev for the status line; the stamp is a full commit SHA (ADR-0061), unwieldy in full. */
  protected shortRev(rev: string | null): string {
    return rev ? rev.slice(0, 7) : '';
  }

  /** Start (or reimport) an Importer at its chosen Visibility, then follow the reconcile home. */
  protected run(importerId: string): void {
    if (this.running()) return;
    this.worlds.runImport(this.id(), importerId, this.visibilityFor(importerId)).subscribe({
      // The run is now the live state; a still-in-flight initial GET must not rewind it (#262 review).
      next: (job) => {
        this.runEstablished = true;
        this.follow(job);
      },
      error: (err: unknown) => this.error(this.runErrorKey(err)),
    });
  }

  /** Remove an Importer's whole set (no recreate); a refusal toasts and leaves the list untouched. */
  protected remove(importerId: string): void {
    if (this.running()) return;
    this.worlds.removeImporter(this.id(), importerId).subscribe({
      next: () => {
        // The set is gone; drop any status line that named it so the row reads clean.
        if (this.status()?.importer === importerId) this.status.set(null);
        // Re-read so the durable last-imported line (from the provenance index) clears too (#260).
        this.loadImporters();
        this.toaster.show(this.transloco.translate('imports.removed'), 'success');
      },
      error: () => this.error('imports.removeError'),
    });
  }

  /**
   * Adopt `job`; if it is still running, poll until it stops, then announce how it landed. `switchMap`
   * off a `timer` (the reindex pattern, ADR-0046): a poll that never answers is abandoned on the next
   * tick, so one stalled request cannot strand the panel as busy.
   */
  private follow(job: ImportRunSummary): void {
    this.status.set(job);
    if (job.status !== 'running') return;
    timer(IMPORT_POLL_MS, IMPORT_POLL_MS)
      .pipe(
        switchMap(() => this.worlds.importStatus(this.id())),
        // Inclusive: the first non-running poll is the one worth announcing.
        takeWhile((j) => j.status === 'running', true),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (j) => {
          this.status.set(j);
          if (j.status !== 'running') {
            this.announce(j);
            // The run settled; re-read so each row's durable last-imported line reflects it (#260).
            this.loadImporters();
          }
        },
        error: () => {
          // The reconcile may well be fine; this panel just lost sight of it. Free the controls.
          this.status.set(null);
          this.error('imports.statusError');
        },
      });
  }

  /** Report a finished run: anything but `succeeded` is a run that aborted (the fetch threw or a write refused). */
  private announce(job: ImportRunSummary): void {
    if (job.status !== 'succeeded') {
      this.error('imports.runError');
      return;
    }
    this.toaster.show(this.transloco.translate('imports.imported', { count: job.created + job.updated }), 'success');
  }

  /** A 409 means a run is already in flight (ADR-0060); everything else is the generic run failure. */
  private runErrorKey(err: unknown): string {
    const code = err instanceof HttpErrorResponse ? (err.error as { code?: string } | null)?.code : undefined;
    return code === ImporterErrorCode.ImportRunning ? 'imports.runningError' : 'imports.runError';
  }

  /** (Re)load the Importer list — its rows carry the durable last-imported line (#260). */
  private loadImporters(): void {
    this.worlds.importers(this.id()).subscribe({
      next: (list) => this.importers.set(list),
      error: () => this.error('imports.loadError'),
    });
  }

  private error(key: string): void {
    this.toaster.show(this.transloco.translate(key), 'error');
  }
}
