import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslocoPipe } from '@jsverse/transloco';
import { InboundReference } from '@hexly/domain';
import { EntitiesClient } from '@hexly/web-core';
import { ButtonComponent, DialogComponent, DialogRef } from '@hexly/web-ui';

/** What the caller seeds the confirmation with: the Entity to delete, named in the prompt. */
export interface DeleteEntityDialogData {
  readonly id: string;
  readonly name: string;
}

/** Name at most this many referrers inline before collapsing the rest into "and N more". */
const MAX_NAMED = 5;

/**
 * The generic Entity delete confirmation (ADR-0065): usage-aware, but **naming no type** — the same
 * dialog backs the Entity Browser and the Asset Browser (an Asset is an ordinary Entity here, so its
 * delete gets no special-cased copy). Before confirming, it reads the Entity's inbound links — pure UI
 * over the backlink index, per-viewer filtered like any References read (ADR-0046) — and names the
 * referencing Entities the caller can see, so a delete that would dangle live references is a decision,
 * not a surprise. A failed/empty usage read degrades to the plain "delete X?" prompt.
 *
 * Opened through {@link DialogService}, seeded via its {@link DialogRef}; it resolves `true` on confirm
 * and `false` on cancel/dismiss, so the caller owns the actual delete (its refresh/toast flow).
 */
@Component({
  selector: 'app-delete-entity-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, DialogComponent, TranslocoPipe],
  template: `
    <app-dialog [open]="true" [heading]="'deleteEntity.heading' | transloco" (closed)="cancel()">
      @if (!loaded()) {
        <p class="m-0 text-sm text-ink-muted" data-testid="delete-checking">
          {{ 'deleteEntity.checking' | transloco }}
        </p>
      } @else if (usage().length > 0) {
        <p class="m-0 text-sm text-ink" data-testid="delete-usage-intro">
          {{ 'deleteEntity.usageIntro' | transloco: { name: name } }}
        </p>
        <ul class="m-0 flex list-none flex-col gap-1 p-0" data-testid="delete-usage-list">
          @for (ref of named(); track ref.source.id) {
            <li class="truncate text-sm text-ink-muted" data-testid="delete-usage-item">{{ ref.source.name }}</li>
          }
          @if (overflow() > 0) {
            <li class="text-sm text-ink-faint" data-testid="delete-usage-more">
              {{ 'deleteEntity.usageMore' | transloco: { count: overflow() } }}
            </li>
          }
        </ul>
        <p class="m-0 text-sm text-ink-muted" data-testid="delete-usage-note">
          {{ 'deleteEntity.usageNote' | transloco }}
        </p>
      } @else {
        <p class="m-0 text-sm text-ink-muted" data-testid="delete-prompt">
          {{ 'deleteEntity.prompt' | transloco: { name: name } }}
        </p>
      }
      <button dialogFooter type="button" appButton data-testid="delete-cancel" (click)="cancel()">
        {{ 'common.cancel' | transloco }}
      </button>
      <button
        dialogFooter
        type="button"
        appButton
        danger
        data-testid="delete-confirm"
        [attr.aria-disabled]="!loaded() || null"
        (click)="confirm()"
      >
        {{ 'common.delete' | transloco }}
      </button>
    </app-dialog>
  `,
})
export class DeleteEntityDialogComponent {
  private readonly dialogRef = inject(DialogRef) as DialogRef<DeleteEntityDialogData, boolean>;
  private readonly entities = inject(EntitiesClient);

  /** The Entity being deleted — the delete verb already gated its trigger, so this is name-only. */
  protected readonly name = this.dialogRef.data.name;

  /** False until the usage read lands, so the delete stays inert and the prompt never flashes a wrong branch. */
  protected readonly loaded = signal(false);

  /** The viewer-filtered inbound references (usage); empty on an empty or failed read. */
  private readonly _usage = signal<readonly InboundReference[]>([]);
  protected readonly usage = this._usage.asReadonly();
  protected readonly named = computed(() => this._usage().slice(0, MAX_NAMED));
  protected readonly overflow = computed(() => Math.max(0, this._usage().length - MAX_NAMED));

  constructor() {
    // Usage is pure UI over inbound links (ADR-0065) — a per-viewer backlink read. A failed read still
    // lets the delete proceed (plain prompt) rather than trapping the caller behind a broken fetch.
    this.entities
      .references(this.dialogRef.data.id)
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (refs) => {
          this._usage.set(refs.referencedBy);
          this.loaded.set(true);
        },
        error: () => this.loaded.set(true),
      });
  }

  protected cancel(): void {
    this.dialogRef.close(false);
  }

  protected confirm(): void {
    if (!this.loaded()) return;
    this.dialogRef.close(true);
  }
}
