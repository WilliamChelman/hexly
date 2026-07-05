import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AdminError, AdminUser, CreateUserRequest, MIN_PASSWORD_LENGTH } from '@hexly/domain';
import { Observable } from 'rxjs';
import { AdminClient } from '../../core/services/admin.client';
import { AuthClient } from '../../core/services/auth.client';
import { ToasterService } from '../../core/services/toaster.service';
import { Eyebrow } from '../../ui/eyebrow';
import { Field } from '../../ui/field';
import { Input } from '../../ui/input';
import { Panel } from '../../ui/panel';
import { Button } from '../../ui/button';

/**
 * The Instance Admin panel (ADR-0037, #163): account management with zero content powers.
 * An Admin creates users, disables/enables and deletes them, resets passwords, and toggles
 * the Admin flag; a Superadmin additionally sees the Superadmin toggle. Every action is a
 * thin call to {@link AdminClient} followed by a reload — the server is the source of truth,
 * so a refusal (e.g. deleting a sole Owner, or demoting the last Superadmin) surfaces as an
 * error toast and leaves the list unchanged. Reached only via the admin-guarded route.
 */
@Component({
  selector: 'app-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Eyebrow, Field, Input, Panel, Button],
  template: `
    <section class="admin">
      <span appEyebrow>{{ 'admin.heading' | transloco }}</span>
      <h1 class="admin-heading">{{ 'admin.heading' | transloco }}</h1>
      <p class="admin-subhead">{{ 'admin.subhead' | transloco }}</p>

      <h2 class="admin-heading text-xl">{{ 'admin.create.heading' | transloco }}</h2>
      <div appPanel class="admin-panel">
        <form class="admin-create" (submit)="create($event)">
          <label appField [label]="'admin.create.displayName' | transloco">
            <input appInput type="text" data-testid="new-name" [value]="newName()" (input)="newName.set($any($event.target).value)" />
          </label>
          <label appField [label]="'admin.create.email' | transloco">
            <input appInput type="email" data-testid="new-email" [value]="newEmail()" (input)="newEmail.set($any($event.target).value)" />
          </label>
          <label appField [label]="'admin.create.password' | transloco">
            <input appInput type="password" data-testid="new-password" [value]="newPassword()" (input)="newPassword.set($any($event.target).value)" />
          </label>
          <button appButton type="submit" data-testid="create-user" [disabled]="!canCreate()">
            {{ 'admin.create.submit' | transloco }}
          </button>
        </form>
      </div>

      <h2 class="admin-heading text-xl">{{ 'admin.users.heading' | transloco }}</h2>

      <label appField [label]="'admin.filter' | transloco" class="max-w-xs">
        <input appInput type="search" data-testid="filter" [value]="query()" (input)="query.set($any($event.target).value)" />
      </label>

      <section appPanel class="admin-table-panel">
        <table class="admin-table">
          <thead>
            <tr>
              <th class="text-left">{{ 'admin.col.account' | transloco }}</th>
              <th class="text-center">{{ 'admin.col.admin' | transloco }}</th>
              <th class="text-center">{{ 'admin.col.worlds' | transloco }}</th>
              @if (isSuperadmin()) { <th class="text-center">{{ 'admin.col.superadmin' | transloco }}</th> }
              <th class="text-center">{{ 'admin.col.status' | transloco }}</th>
              <th class="text-right">{{ 'admin.col.actions' | transloco }}</th>
            </tr>
          </thead>
          <tbody>
            @for (u of filtered(); track u.id) {
              <tr [attr.data-testid]="'user-' + u.id" [class.is-disabled]="u.disabledAt !== null">
                <td>
                  <div class="admin-name">{{ u.displayName }}</div>
                  <div class="admin-email">{{ u.email }}</div>
                </td>
                <td class="text-center">
                  <button appButton icon size="sm" [attr.data-testid]="'admin-' + u.id"
                    [active]="u.isAdmin" [attr.aria-pressed]="u.isAdmin"
                    [title]="(u.isAdmin ? 'admin.actions.revokeAdmin' : 'admin.actions.grantAdmin') | transloco"
                    (click)="toggleAdmin(u)">{{ u.isAdmin ? '✓' : '–' }}</button>
                </td>
                <td class="text-center">
                  @if (!u.isSuperadmin || isSuperadmin()) {
                    <button appButton icon size="sm" [attr.data-testid]="'world-creation-' + u.id"
                      [active]="u.canCreateWorlds" [attr.aria-pressed]="u.canCreateWorlds"
                      [title]="(u.canCreateWorlds ? 'admin.actions.revokeWorldCreation' : 'admin.actions.grantWorldCreation') | transloco"
                      (click)="toggleCanCreateWorlds(u)">{{ u.canCreateWorlds ? '✓' : '–' }}</button>
                  } @else {
                    <span class="admin-na">—</span>
                  }
                </td>
                @if (isSuperadmin()) {
                  <td class="text-center">
                    <button appButton icon size="sm" [attr.data-testid]="'superadmin-' + u.id"
                      [active]="u.isSuperadmin" [attr.aria-pressed]="u.isSuperadmin"
                      [title]="(u.isSuperadmin ? 'admin.actions.revokeSuperadmin' : 'admin.actions.grantSuperadmin') | transloco"
                      (click)="toggleSuperadmin(u)">{{ u.isSuperadmin ? '✓' : '–' }}</button>
                  </td>
                }
                <td class="admin-status text-center">
                  {{ (u.disabledAt !== null ? 'admin.status.disabled' : 'admin.status.active') | transloco }}
                </td>
                <td>
                  @if (resettingId() === u.id) {
                    <form class="admin-reset" (submit)="submitReset($event, u)">
                      <input appInput type="password" [attr.data-testid]="'reset-input-' + u.id" [value]="resetDraft()" (input)="resetDraft.set($any($event.target).value)" />
                      <button appButton size="sm" type="submit" [attr.data-testid]="'reset-save-' + u.id" [disabled]="resetDraft().length < minPassword">
                        {{ 'admin.actions.resetSave' | transloco }}
                      </button>
                    </form>
                  } @else {
                    <div class="admin-actions">
                      <button appButton variant="ghost" size="sm" [attr.data-testid]="'disable-' + u.id" (click)="toggleDisabled(u)">
                        {{ (u.disabledAt !== null ? 'admin.actions.enable' : 'admin.actions.disable') | transloco }}
                      </button>
                      <button appButton variant="ghost" size="sm" [attr.data-testid]="'reset-' + u.id" (click)="startReset(u)">
                        {{ 'admin.actions.reset' | transloco }}
                      </button>
                      <button appButton size="sm" danger [attr.data-testid]="'delete-' + u.id" (click)="remove(u)">
                        {{ 'admin.actions.delete' | transloco }}
                      </button>
                    </div>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td class="admin-empty" [attr.colspan]="isSuperadmin() ? 6 : 5">{{ 'admin.users.empty' | transloco }}</td>
              </tr>
            }
          </tbody>
        </table>
      </section>
    </section>
  `,
  styles: `
    @reference '#app-styles.css';
    .admin { @apply mx-auto flex w-full max-w-5xl flex-col gap-3 p-6; }
    .admin-heading { @apply font-display text-2xl text-ink-strong; }
    .admin-subhead { @apply text-sm text-ink-muted; }
    .admin-panel { @apply flex flex-col gap-3 p-4; }
    .admin-create { @apply flex flex-wrap items-end gap-3; }
    .admin-create > label { @apply flex-1 basis-40; }
    .admin-table-panel { @apply overflow-x-auto p-0; }
    .admin-table { @apply w-full border-collapse text-sm; }
    .admin-table th { @apply px-3 py-2 text-2xs font-semibold uppercase tracking-widest text-ink-muted border-b border-line; }
    .admin-table td { @apply px-3 py-2 align-middle border-b border-line/60; }
    .admin-table tbody tr:last-child td { @apply border-b-0; }
    .admin-table tr.is-disabled { @apply opacity-60; }
    .admin-name { @apply font-semibold text-ink-strong; }
    .admin-email { @apply text-xs text-ink-muted; }
    .admin-status { @apply text-xs text-ink-muted; }
    .admin-na { @apply text-ink-faint; }
    .admin-actions { @apply flex flex-wrap justify-end gap-2; }
    .admin-reset { @apply flex items-center gap-2; }
    .admin-empty { @apply py-4 text-center text-sm text-ink-muted; }
  `,
})
export class Admin {
  private readonly admin = inject(AdminClient);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);

  protected readonly isSuperadmin = inject(AuthClient).isSuperadmin;
  protected readonly minPassword = MIN_PASSWORD_LENGTH;

  protected readonly users = signal<readonly AdminUser[]>([]);

  /** Case-insensitive filter over display name + email (#163). */
  protected readonly query = signal('');
  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.users();
    return this.users().filter(
      (u) =>
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q),
    );
  });

  protected readonly newName = signal('');
  protected readonly newEmail = signal('');
  protected readonly newPassword = signal('');

  /** The user whose password is being reset inline, or null. */
  protected readonly resettingId = signal<string | null>(null);
  protected readonly resetDraft = signal('');

  constructor() {
    this.reload();
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
    this.run(this.admin.createUser(req), 'admin.toast.created', () => {
      this.newName.set('');
      this.newEmail.set('');
      this.newPassword.set('');
    });
  }

  protected toggleDisabled(u: AdminUser): void {
    this.run(this.admin.setDisabled(u.id, u.disabledAt === null), 'admin.toast.saved');
  }

  protected toggleAdmin(u: AdminUser): void {
    this.run(this.admin.setAdmin(u.id, !u.isAdmin), 'admin.toast.saved');
  }

  protected toggleCanCreateWorlds(u: AdminUser): void {
    this.run(
      this.admin.setCanCreateWorlds(u.id, !u.canCreateWorlds),
      'admin.toast.saved',
    );
  }

  protected toggleSuperadmin(u: AdminUser): void {
    this.run(this.admin.setSuperadmin(u.id, !u.isSuperadmin), 'admin.toast.saved');
  }

  protected startReset(u: AdminUser): void {
    this.resetDraft.set('');
    this.resettingId.set(u.id);
  }

  protected submitReset(event: Event, u: AdminUser): void {
    event.preventDefault();
    if (this.resetDraft().length < this.minPassword) return;
    this.run(this.admin.resetPassword(u.id, this.resetDraft()), 'admin.toast.reset', () =>
      this.resettingId.set(null),
    );
  }

  protected remove(u: AdminUser): void {
    if (typeof confirm === 'function' && !confirm(this.transloco.translate('admin.confirmDelete', { name: u.displayName })))
      return;
    this.run(this.admin.deleteUser(u.id), 'admin.toast.deleted');
  }

  /** Run a mutation, then reload + toast on success or surface the server's refusal. */
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

  /**
   * Resolve a failed mutation to a localized message from the server's structured error
   * code (ADR-0037, #163) — `admin.error.<code>` when the body carries a known {@link
   * AdminErrorCode}, else a generic fallback. No English is matched off the wire.
   */
  private errorMessage(err: unknown): string {
    const code = err instanceof HttpErrorResponse ? (err.error as AdminError | null)?.code : undefined;
    const key = code ? `admin.error.${code}` : 'admin.toast.error';
    const message = this.transloco.translate(key);
    // Transloco echoes the key back on a miss — fall back to the generic message.
    return message === key ? this.transloco.translate('admin.toast.error') : message;
  }

  private reload(): void {
    this.admin.list().subscribe((users) => this.users.set(users));
  }
}
