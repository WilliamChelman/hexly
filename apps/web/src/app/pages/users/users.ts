import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { CreateUserRequest, InstanceRole, MIN_PASSWORD_LENGTH, UserAccount, UsersError } from '@hexly/domain';
import { Observable } from 'rxjs';
import { UsersClient, ToasterService, AuthClient } from '@hexly/web-core';
import { Eyebrow, Field, Input, Panel, Button } from '@hexly/web-ui';

/**
 * The user-management panel (ADR-0047): account management with zero content powers.
 * Every action is a thin {@link UsersClient} call followed by a reload — the server is
 * the source of truth, so a refusal surfaces as an error toast and leaves the list
 * unchanged. The Superadmin repair surface (the Reindex) lives on its own {@link Admin}
 * page.
 */
@Component({
  selector: 'app-users',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Eyebrow, Field, Input, Panel, Button],
  template: `
    <section class="users">
      <span appEyebrow>{{ 'users.heading' | transloco }}</span>
      <h1 class="users-heading">{{ 'users.heading' | transloco }}</h1>
      <p class="users-subhead">{{ 'users.subhead' | transloco }}</p>

      <h2 class="users-heading text-xl">
        {{ 'users.create.heading' | transloco }}
      </h2>
      <div appPanel class="users-panel">
        <form class="users-create" (submit)="create($event)">
          <label appField [label]="'users.create.displayName' | transloco">
            <input
              appInput
              type="text"
              data-testid="new-name"
              [value]="newName()"
              (input)="newName.set($any($event.target).value)"
            />
          </label>
          <label appField [label]="'users.create.email' | transloco">
            <input
              appInput
              type="email"
              data-testid="new-email"
              [value]="newEmail()"
              (input)="newEmail.set($any($event.target).value)"
            />
          </label>
          <label appField [label]="'users.create.password' | transloco">
            <input
              appInput
              type="password"
              data-testid="new-password"
              [value]="newPassword()"
              (input)="newPassword.set($any($event.target).value)"
            />
          </label>
          <button appButton type="submit" data-testid="create-user" [disabled]="!canCreate()">
            {{ 'users.create.submit' | transloco }}
          </button>
        </form>
      </div>

      <h2 class="users-heading text-xl">
        {{ 'users.users.heading' | transloco }}
      </h2>

      <label appField [label]="'users.filter' | transloco" class="max-w-xs">
        <input
          appInput
          type="search"
          data-testid="filter"
          [value]="query()"
          (input)="query.set($any($event.target).value)"
        />
      </label>

      <section appPanel class="users-table-panel">
        <table class="users-table">
          <thead>
            <tr>
              <th class="text-left">{{ 'users.col.account' | transloco }}</th>
              <th class="text-center">
                {{ 'users.col.manageUsers' | transloco }}
              </th>
              <th class="text-center">
                {{ 'users.col.createWorlds' | transloco }}
              </th>
              @if (isSuperadmin()) {
                <th class="text-center">
                  {{ 'users.col.superadmin' | transloco }}
                </th>
              }
              <th class="text-center">{{ 'users.col.status' | transloco }}</th>
              <th class="text-right">{{ 'users.col.actions' | transloco }}</th>
            </tr>
          </thead>
          <tbody>
            @for (u of filtered(); track u.id) {
              <tr [attr.data-testid]="'user-' + u.id" [class.is-disabled]="u.disabledAt !== null">
                <td>
                  <div class="users-name">{{ u.displayName }}</div>
                  <div class="users-email">{{ u.email }}</div>
                </td>
                <td class="text-center">
                  @if (canManage(u)) {
                    <button
                      appButton
                      icon
                      size="sm"
                      [attr.data-testid]="'role-manage-users-' + u.id"
                      [active]="hasRole(u, 'manage-users')"
                      [attr.aria-pressed]="hasRole(u, 'manage-users')"
                      [title]="
                        (hasRole(u, 'manage-users')
                          ? 'users.actions.revokeManageUsers'
                          : 'users.actions.grantManageUsers'
                        ) | transloco
                      "
                      (click)="toggleRole(u, 'manage-users')"
                    >
                      {{ hasRole(u, 'manage-users') ? '✓' : '–' }}
                    </button>
                  } @else {
                    <span class="users-na">—</span>
                  }
                </td>
                <td class="text-center">
                  @if (canManage(u)) {
                    <button
                      appButton
                      icon
                      size="sm"
                      [attr.data-testid]="'role-create-worlds-' + u.id"
                      [active]="hasRole(u, 'create-worlds')"
                      [attr.aria-pressed]="hasRole(u, 'create-worlds')"
                      [title]="
                        (hasRole(u, 'create-worlds')
                          ? 'users.actions.revokeCreateWorlds'
                          : 'users.actions.grantCreateWorlds'
                        ) | transloco
                      "
                      (click)="toggleRole(u, 'create-worlds')"
                    >
                      {{ hasRole(u, 'create-worlds') ? '✓' : '–' }}
                    </button>
                  } @else {
                    <span class="users-na">—</span>
                  }
                </td>
                @if (isSuperadmin()) {
                  <td class="text-center">
                    <button
                      appButton
                      icon
                      size="sm"
                      [attr.data-testid]="'superadmin-' + u.id"
                      [active]="u.isSuperadmin"
                      [attr.aria-pressed]="u.isSuperadmin"
                      [title]="
                        (u.isSuperadmin ? 'users.actions.revokeSuperadmin' : 'users.actions.grantSuperadmin')
                          | transloco
                      "
                      (click)="toggleSuperadmin(u)"
                    >
                      {{ u.isSuperadmin ? '✓' : '–' }}
                    </button>
                  </td>
                }
                <td class="users-status text-center">
                  {{ (u.disabledAt !== null ? 'users.status.disabled' : 'users.status.active') | transloco }}
                </td>
                <td>
                  @if (resettingId() === u.id) {
                    <form class="users-reset" (submit)="submitReset($event, u)">
                      <input
                        appInput
                        type="password"
                        [attr.data-testid]="'reset-input-' + u.id"
                        [value]="resetDraft()"
                        (input)="resetDraft.set($any($event.target).value)"
                      />
                      <button
                        appButton
                        size="sm"
                        type="submit"
                        [attr.data-testid]="'reset-save-' + u.id"
                        [disabled]="resetDraft().length < minPassword"
                      >
                        {{ 'users.actions.resetSave' | transloco }}
                      </button>
                    </form>
                  } @else {
                    <div class="users-actions">
                      <button
                        appButton
                        variant="ghost"
                        size="sm"
                        [attr.data-testid]="'disable-' + u.id"
                        (click)="toggleDisabled(u)"
                      >
                        {{ (u.disabledAt !== null ? 'users.actions.enable' : 'users.actions.disable') | transloco }}
                      </button>
                      <button
                        appButton
                        variant="ghost"
                        size="sm"
                        [attr.data-testid]="'reset-' + u.id"
                        (click)="startReset(u)"
                      >
                        {{ 'users.actions.reset' | transloco }}
                      </button>
                      <button appButton size="sm" danger [attr.data-testid]="'delete-' + u.id" (click)="remove(u)">
                        {{ 'users.actions.delete' | transloco }}
                      </button>
                    </div>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td class="users-empty" [attr.colspan]="isSuperadmin() ? 6 : 5">
                  {{ 'users.users.empty' | transloco }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </section>
    </section>
  `,
  styles: `
    @reference '#app-styles.css';
    .users {
      @apply mx-auto flex w-full max-w-5xl flex-col gap-3 p-6;
    }
    .users-heading {
      @apply font-display text-2xl text-ink-strong;
    }
    .users-subhead {
      @apply text-sm text-ink-muted;
    }
    .users-panel {
      @apply flex flex-col gap-3 p-4;
    }
    .users-create {
      @apply flex flex-wrap items-end gap-3;
    }
    .users-create > label {
      @apply flex-1 basis-40;
    }
    .users-table-panel {
      @apply overflow-x-auto p-0;
    }
    .users-table {
      @apply w-full border-collapse text-sm;
    }
    .users-table th {
      @apply px-3 py-2 text-2xs font-semibold uppercase tracking-widest text-ink-muted border-b border-line;
    }
    .users-table td {
      @apply px-3 py-2 align-middle border-b border-line/60;
    }
    .users-table tbody tr:last-child td {
      @apply border-b-0;
    }
    .users-table tr.is-disabled {
      @apply opacity-60;
    }
    .users-name {
      @apply font-semibold text-ink-strong;
    }
    .users-email {
      @apply text-xs text-ink-muted;
    }
    .users-status {
      @apply text-xs text-ink-muted;
    }
    .users-na {
      @apply text-ink-faint;
    }
    .users-actions {
      @apply flex flex-wrap justify-end gap-2;
    }
    .users-reset {
      @apply flex items-center gap-2;
    }
    .users-empty {
      @apply py-4 text-center text-sm text-ink-muted;
    }
  `,
})
export class Users {
  private readonly users = inject(UsersClient);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);

  protected readonly isSuperadmin = inject(AuthClient).isSuperadmin;
  protected readonly minPassword = MIN_PASSWORD_LENGTH;

  protected readonly accounts = signal<readonly UserAccount[]>([]);

  protected readonly query = signal('');
  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.accounts();
    return this.accounts().filter((u) => u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  });

  protected readonly newName = signal('');
  protected readonly newEmail = signal('');
  protected readonly newPassword = signal('');

  protected readonly resettingId = signal<string | null>(null);
  protected readonly resetDraft = signal('');

  constructor() {
    this.reload();
  }

  /**
   * Whether the caller may edit this account's roles. Only a Superadmin may manage a
   * Superadmin account (the server enforces it too); everyone with the panel may
   * manage a plain account.
   */
  protected canManage(u: UserAccount): boolean {
    return !u.isSuperadmin || this.isSuperadmin();
  }

  protected hasRole(u: UserAccount, role: InstanceRole): boolean {
    return u.roles.includes(role);
  }

  protected canCreate(): boolean {
    return (
      this.newName().trim().length > 0 &&
      this.newEmail().trim().length > 0 &&
      this.newPassword().length >= this.minPassword
    );
  }

  protected create(event: Event): void {
    event.preventDefault();
    if (!this.canCreate()) return;
    const req: CreateUserRequest = {
      displayName: this.newName().trim(),
      email: this.newEmail().trim(),
      password: this.newPassword(),
    };
    this.run(this.users.createUser(req), 'users.toast.created', () => {
      this.newName.set('');
      this.newEmail.set('');
      this.newPassword.set('');
    });
  }

  protected toggleDisabled(u: UserAccount): void {
    this.run(this.users.setDisabled(u.id, u.disabledAt === null), 'users.toast.saved');
  }

  /**
   * Add or remove the role from the account's set, then write the whole set back
   * (ADR-0047). The server replaces the stored `roles` wholesale, so the panel sends
   * the new array rather than a delta.
   */
  protected toggleRole(u: UserAccount, role: InstanceRole): void {
    const next = u.roles.includes(role) ? u.roles.filter((r) => r !== role) : [...u.roles, role];
    this.run(this.users.setRoles(u.id, next), 'users.toast.saved');
  }

  protected toggleSuperadmin(u: UserAccount): void {
    this.run(this.users.setSuperadmin(u.id, !u.isSuperadmin), 'users.toast.saved');
  }

  protected startReset(u: UserAccount): void {
    this.resetDraft.set('');
    this.resettingId.set(u.id);
  }

  protected submitReset(event: Event, u: UserAccount): void {
    event.preventDefault();
    if (this.resetDraft().length < this.minPassword) return;
    this.run(this.users.resetPassword(u.id, this.resetDraft()), 'users.toast.reset', () => this.resettingId.set(null));
  }

  protected remove(u: UserAccount): void {
    if (
      typeof confirm === 'function' &&
      !confirm(
        this.transloco.translate('users.confirmDelete', {
          name: u.displayName,
        }),
      )
    )
      return;
    this.run(this.users.deleteUser(u.id), 'users.toast.deleted');
  }

  private run(op: Observable<unknown>, successKey: string, onOk?: () => void): void {
    op.subscribe({
      next: () => {
        onOk?.();
        this.toaster.show(this.transloco.translate(successKey), 'success');
        this.reload();
      },
      error: (err: unknown) => {
        this.toaster.show(this.errorMessage(err), 'error');
      },
    });
  }

  /** Localize the server's structured error code (`users.error.<code>`); no
   * English is matched off the wire. */
  private errorMessage(err: unknown): string {
    const code = err instanceof HttpErrorResponse ? (err.error as UsersError | null)?.code : undefined;
    const key = code ? `users.error.${code}` : 'users.toast.error';
    const message = this.transloco.translate(key);
    // Transloco echoes the key back on a miss — fall back to the generic message.
    return message === key ? this.transloco.translate('users.toast.error') : message;
  }

  private reload(): void {
    this.users.list().subscribe((accounts) => this.accounts.set(accounts));
  }
}
