import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UserSummary } from '@hexly/domain';
import { WorldsClient, EntitiesClient, UserDirectoryClient, AuthClient, ToasterService } from '@hexly/web-core';
import { Button } from './button';
import { Select } from './select';

/**
 * The symmetric ownership set of a World or Entity (ADR-0037, #158): view every
 * Owner, add a co-Owner from the Instance directory, remove an Owner, or resign
 * your own ownership. All Owners are equal — no hidden hierarchy — so the only
 * guard is the ≥1-Owner invariant the server enforces (a refused last-Owner
 * removal surfaces as an error toast, leaving the set untouched).
 *
 * Ownership is stored as user ids; names come from the {@link UserDirectoryClient}
 * directory, which carries no email (ADR-0004).
 */
@Component({
  selector: 'app-owner-set',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Button, Select],
  template: `
    <ul class="owner-list">
      @for (o of rows(); track o.id) {
        <li class="owner-row" [attr.data-testid]="'owner-' + o.id">
          <span class="owner-name"
            >{{ o.name }}
            @if (o.isSelf) {
              <span class="owner-you"> ({{ 'owners.you' | transloco }})</span>
            }
          </span>
          @if (o.isSelf) {
            <button appButton size="sm" [attr.data-testid]="'resign-' + o.id" (click)="resign()">
              {{ 'owners.resign' | transloco }}
            </button>
          } @else {
            <button appButton size="sm" danger [attr.data-testid]="'remove-' + o.id" (click)="remove(o.id)">
              {{ 'owners.remove' | transloco }}
            </button>
          }
        </li>
      }
    </ul>

    <div class="owner-add">
      <label class="owner-add-label" for="owner-add-select">{{ 'owners.addLabel' | transloco }}</label>
      <div class="owner-add-row">
        <select
          appSelect
          id="owner-add-select"
          class="owner-select"
          data-testid="add-select"
          [value]="selected()"
          (change)="selected.set($any($event.target).value)"
        >
          <option value="">{{ 'owners.addPlaceholder' | transloco }}</option>
          @for (c of candidates(); track c.id) {
            <option [value]="c.id">{{ c.displayName }}</option>
          }
        </select>
        <button appButton variant="primary" data-testid="add" [disabled]="!selected()" (click)="add()">
          {{ 'owners.add' | transloco }}
        </button>
      </div>
    </div>
  `,
  styles: `
    @reference '#app-styles.css';
    .owner-list {
      @apply flex flex-col gap-1;
    }
    .owner-row {
      @apply flex items-center justify-between gap-3 py-1;
    }
    .owner-you {
      @apply text-ink-muted;
    }
    .owner-add {
      @apply mt-4 flex flex-col gap-2;
    }
    .owner-add-label {
      @apply text-sm font-semibold text-ink-muted;
    }
    .owner-add-row {
      @apply flex items-center gap-2;
    }
    /* Layout only — the look is the appSelect primitive's. */
    .owner-select {
      @apply flex-1;
    }
  `,
})
export class OwnerSet implements OnInit {
  /** Which resource this set belongs to — routes reads/writes to the right client. */
  readonly kind = input.required<'world' | 'entity'>();
  readonly id = input.required<string>();

  /**
   * Emitted after the current user resigns their own ownership: resigning can
   * cost them reach to this resource, so the host navigates away rather than
   * leaving a now-forbidden page open.
   */
  readonly resigned = output<void>();

  private readonly worlds = inject(WorldsClient);
  private readonly entities = inject(EntitiesClient);
  private readonly users = inject(UserDirectoryClient);
  private readonly auth = inject(AuthClient);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);

  private readonly owners = signal<readonly string[]>([]);
  private readonly directory = signal<readonly UserSummary[]>([]);

  /** The directory user picked in the add control, or '' for the placeholder. */
  readonly selected = signal<string>('');

  /** Directory users who aren't already Owners — the add control's options. */
  readonly candidates = computed(() => this.directory().filter((u) => !this.owners().includes(u.id)));

  /** The current user's id — the one whose row offers "resign" instead of "remove". */
  private readonly me = computed(() => this.auth.currentUser()?.id ?? null);

  /** Owner ids resolved to display rows, in the server's stable order. */
  readonly rows = computed(() =>
    this.owners().map((id) => ({
      id,
      name: this.nameOf(id),
      isSelf: id === this.me(),
    })),
  );

  ngOnInit(): void {
    this.users.list().subscribe({
      next: (d) => this.directory.set(d),
      error: () => this.loadFailed(),
    });
    this.reload();
  }

  add(): void {
    const userId = this.selected();
    if (!userId) return;
    this.mutate(this.client().addOwner(this.id(), userId), 'owners.addError', (owners) => {
      this.owners.set(owners);
      this.selected.set('');
    });
  }

  remove(userId: string): void {
    this.mutate(this.client().removeOwner(this.id(), userId), 'owners.removeError', (owners) =>
      this.owners.set(owners),
    );
  }

  resign(): void {
    const me = this.me();
    if (!me) return;
    this.mutate(this.client().removeOwner(this.id(), me), 'owners.removeError', () => this.resigned.emit());
  }

  /**
   * Run an owner-set mutation, applying its result on success or surfacing the
   * failure as an error toast. The server's ≥1-Owner invariant comes back as a
   * 409 — named specifically so the user learns *why* it was refused — while any
   * other failure falls back to the operation's generic message. The set is only
   * ever mutated inside `onOk`, so a refusal leaves it exactly as it was.
   */
  private mutate(op$: Observable<string[]>, genericKey: string, onOk: (owners: string[]) => void): void {
    op$.subscribe({
      next: onOk,
      error: (err: unknown) => {
        const lastOwner = err instanceof HttpErrorResponse && err.status === 409;
        const key = lastOwner ? 'owners.lastOwner' : genericKey;
        this.toaster.show(
          this.transloco.translate(key, {
            kind: this.transloco.translate(`owners.${this.kind()}`),
          }),
          'error',
        );
      },
    });
  }

  private reload(): void {
    this.client()
      .owners(this.id())
      .subscribe({
        next: (owners) => this.owners.set(owners),
        error: () => this.loadFailed(),
      });
  }

  /** A read (directory or owner set) failed — the panel can't be trusted, so say so. */
  private loadFailed(): void {
    this.toaster.show(this.transloco.translate('owners.loadError'), 'error');
  }

  private client(): WorldsClient | EntitiesClient {
    return this.kind() === 'world' ? this.worlds : this.entities;
  }

  private nameOf(id: string): string {
    return this.directory().find((u) => u.id === id)?.displayName ?? id;
  }
}
