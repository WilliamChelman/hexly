import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { EntityGrant, GrantRole, UserSummary } from '@hexly/domain';
import { EntitiesClient, UserDirectoryClient, ToasterService } from '@hexly/web-core';
import { Button } from './button';
import { Select } from './select';

/**
 * An Entity's named grant set (ADR-0037, #161): the surgical per-Entity layer beside the
 * owner set. An Owner hands any Instance user an Editor or Viewer grant on this one Entity
 * — World membership is not a precondition, and a Viewer grant on a `private` Entity is
 * per-user visibility. An Owner adds, changes the role of, or revokes a grant. All writes
 * are Owner-only server-side; a refusal surfaces as an error toast, leaving the list intact.
 *
 * Grants are stored as user ids + roles; names come from the {@link UserDirectoryClient} directory,
 * which carries no email (ADR-0004). The Entity's Owners are excluded from the add
 * candidates — an Owner already has full access, so granting them is meaningless.
 */
@Component({
  selector: 'app-grant-set',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Button, Select],
  template: `
    <ul class="grant-list">
      @for (g of rows(); track g.userId) {
        <li class="grant-row" [attr.data-testid]="'grant-' + g.userId">
          <span class="grant-name">{{ g.name }}</span>
          <select
            appSelect
            class="grant-select"
            [attr.data-testid]="'grant-role-' + g.userId"
            [value]="g.role"
            (change)="setRole(g, $any($event.target))"
          >
            <option value="editor">{{ 'grants.editor' | transloco }}</option>
            <option value="viewer">{{ 'grants.viewer' | transloco }}</option>
          </select>
          <button appButton size="sm" danger [attr.data-testid]="'grant-revoke-' + g.userId" (click)="revoke(g.userId)">
            {{ 'grants.revoke' | transloco }}
          </button>
        </li>
      } @empty {
        <li class="grant-empty">{{ 'grants.empty' | transloco }}</li>
      }
    </ul>

    <div class="grant-add">
      <label class="grant-add-label" for="grant-add-select">{{ 'grants.addLabel' | transloco }}</label>
      <div class="grant-add-row">
        <select
          appSelect
          id="grant-add-select"
          class="grant-select"
          data-testid="grant-add-select"
          [value]="selectedUser()"
          (change)="selectedUser.set($any($event.target).value)"
        >
          <option value="">{{ 'grants.addPlaceholder' | transloco }}</option>
          @for (c of candidates(); track c.id) {
            <option [value]="c.id">{{ c.displayName }}</option>
          }
        </select>
        <select
          appSelect
          class="grant-select"
          data-testid="grant-add-role"
          [value]="selectedRole()"
          (change)="selectedRole.set($any($event.target).value)"
        >
          <option value="editor">{{ 'grants.editor' | transloco }}</option>
          <option value="viewer">{{ 'grants.viewer' | transloco }}</option>
        </select>
        <button appButton variant="primary" data-testid="grant-add" [disabled]="!selectedUser()" (click)="add()">
          {{ 'grants.add' | transloco }}
        </button>
      </div>
    </div>
  `,
  styles: `
    @reference '#app-styles.css';
    .grant-list {
      @apply flex flex-col gap-1;
    }
    .grant-row {
      @apply flex items-center justify-between gap-3 py-1;
    }
    .grant-name {
      @apply flex-1;
    }
    .grant-empty {
      @apply py-1 text-sm text-ink-muted;
    }
    .grant-add {
      @apply mt-4 flex flex-col gap-2;
    }
    .grant-add-label {
      @apply text-sm font-semibold text-ink-muted;
    }
    .grant-add-row {
      @apply flex items-center gap-2;
    }
    /* Layout only — the look is the appSelect primitive's. */
    .grant-add-row .grant-select:first-child {
      @apply flex-1;
    }
  `,
})
export class GrantSet implements OnInit {
  readonly id = input.required<string>();

  private readonly entities = inject(EntitiesClient);
  private readonly users = inject(UserDirectoryClient);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);

  private readonly grants = signal<readonly EntityGrant[]>([]);
  private readonly directory = signal<readonly UserSummary[]>([]);
  private readonly owners = signal<readonly string[]>([]);

  /** The directory user picked in the add control, or '' for the placeholder. */
  readonly selectedUser = signal<string>('');
  /** The role the add control will grant — Viewer by default (the least power). */
  readonly selectedRole = signal<GrantRole>('viewer');

  /** Directory users who are neither grantees nor Owners — the add control's options. */
  readonly candidates = computed(() => {
    const taken = new Set<string>([...this.grants().map((g) => g.userId), ...this.owners()]);
    return this.directory().filter((u) => !taken.has(u.id));
  });

  /** Grantee ids resolved to display rows, in the server's stable order. */
  readonly rows = computed(() =>
    this.grants().map((g) => ({
      userId: g.userId,
      name: this.nameOf(g.userId),
      role: g.role,
    })),
  );

  ngOnInit(): void {
    this.users.list().subscribe({
      next: (d) => this.directory.set(d),
      error: () => this.loadFailed(),
    });
    this.entities.grants(this.id()).subscribe({
      next: (g) => this.grants.set(g),
      error: () => this.loadFailed(),
    });
    // Owners are loaded only to keep them out of the add candidates; a failure here isn't
    // fatal to managing grants, so it stays silent (the grant load reports on its own).
    this.entities.owners(this.id()).subscribe({ next: (o) => this.owners.set(o), error: () => undefined });
  }

  add(): void {
    const userId = this.selectedUser();
    if (!userId) return;
    this.mutate(this.entities.addGrant(this.id(), userId, this.selectedRole()), 'grants.addError', (grants) => {
      this.grants.set(grants);
      this.selectedUser.set('');
    });
  }

  setRole(row: { userId: string; role: GrantRole }, select: HTMLSelectElement): void {
    // The row `<select>` is a one-way [value] bind, so a rejected change would otherwise
    // leave the DOM showing the role the server refused — revert it to the known role on
    // failure (the signal is unchanged, so nothing else would).
    this.mutate(
      this.entities.addGrant(this.id(), row.userId, select.value as GrantRole),
      'grants.roleError',
      (grants) => this.grants.set(grants),
      () => (select.value = row.role),
    );
  }

  revoke(userId: string): void {
    this.mutate(this.entities.removeGrant(this.id(), userId), 'grants.revokeError', (grants) =>
      this.grants.set(grants),
    );
  }

  /**
   * Run a grant-set mutation, applying its result on success or surfacing the failure as
   * an error toast. The list is only ever mutated inside `onOk`, so a refusal leaves it
   * exactly as it was; `onErr` runs first on failure for any DOM the signal can't revert
   * on its own (the row role `<select>`).
   */
  private mutate(
    op$: Observable<EntityGrant[]>,
    genericKey: string,
    onOk: (grants: EntityGrant[]) => void,
    onErr?: () => void,
  ): void {
    op$.subscribe({
      next: onOk,
      error: () => {
        onErr?.();
        this.toaster.show(this.transloco.translate(genericKey), 'error');
      },
    });
  }

  /** A read (directory or grant set) failed — the panel can't be trusted, so say so. */
  private loadFailed(): void {
    this.toaster.show(this.transloco.translate('grants.loadError'), 'error');
  }

  private nameOf(id: string): string {
    return this.directory().find((u) => u.id === id)?.displayName ?? id;
  }
}
