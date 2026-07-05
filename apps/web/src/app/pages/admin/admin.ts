import {
  ChangeDetectionStrategy,
  Component,
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
import { Chip } from '../../ui/chip';

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
  imports: [TranslocoPipe, Eyebrow, Field, Input, Panel, Button, Chip],
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
      <div appPanel class="admin-panel">
        <ul class="admin-list">
          @for (u of users(); track u.id) {
            <li class="admin-row" [attr.data-testid]="'user-' + u.id">
              <div class="admin-identity">
                <span class="admin-name">{{ u.displayName }}</span>
                <span class="admin-email">{{ u.email }}</span>
                <span class="admin-badges">
                  @if (u.isSuperadmin) { <app-chip tone="gold">{{ 'admin.badge.superadmin' | transloco }}</app-chip> }
                  @if (u.isAdmin) { <app-chip tone="sea">{{ 'admin.badge.admin' | transloco }}</app-chip> }
                  @if (u.canCreateWorlds) { <app-chip tone="astra">{{ 'admin.badge.worldCreator' | transloco }}</app-chip> }
                  @if (u.disabledAt !== null) { <app-chip>{{ 'admin.badge.disabled' | transloco }}</app-chip> }
                </span>
              </div>

              @if (resettingId() === u.id) {
                <form class="admin-reset" (submit)="submitReset($event, u)">
                  <input appInput type="password" [attr.data-testid]="'reset-input-' + u.id" [value]="resetDraft()" (input)="resetDraft.set($any($event.target).value)" />
                  <button appButton size="sm" type="submit" [attr.data-testid]="'reset-save-' + u.id" [disabled]="resetDraft().length < minPassword">
                    {{ 'admin.actions.resetSave' | transloco }}
                  </button>
                </form>
              } @else {
                <div class="admin-actions">
                  <button appButton size="sm" [attr.data-testid]="'disable-' + u.id" (click)="toggleDisabled(u)">
                    {{ (u.disabledAt !== null ? 'admin.actions.enable' : 'admin.actions.disable') | transloco }}
                  </button>
                  <button appButton size="sm" [attr.data-testid]="'admin-' + u.id" (click)="toggleAdmin(u)">
                    {{ (u.isAdmin ? 'admin.actions.revokeAdmin' : 'admin.actions.grantAdmin') | transloco }}
                  </button>
                  @if (!u.isSuperadmin || isSuperadmin()) {
                    <button appButton size="sm" [attr.data-testid]="'world-creation-' + u.id" (click)="toggleCanCreateWorlds(u)">
                      {{ (u.canCreateWorlds ? 'admin.actions.revokeWorldCreation' : 'admin.actions.grantWorldCreation') | transloco }}
                    </button>
                  }
                  @if (isSuperadmin()) {
                    <button appButton size="sm" [attr.data-testid]="'superadmin-' + u.id" (click)="toggleSuperadmin(u)">
                      {{ (u.isSuperadmin ? 'admin.actions.revokeSuperadmin' : 'admin.actions.grantSuperadmin') | transloco }}
                    </button>
                  }
                  <button appButton size="sm" [attr.data-testid]="'reset-' + u.id" (click)="startReset(u)">
                    {{ 'admin.actions.reset' | transloco }}
                  </button>
                  <button appButton size="sm" danger [attr.data-testid]="'delete-' + u.id" (click)="remove(u)">
                    {{ 'admin.actions.delete' | transloco }}
                  </button>
                </div>
              }
            </li>
          } @empty {
            <li class="admin-empty">{{ 'admin.users.empty' | transloco }}</li>
          }
        </ul>
      </div>
    </section>
  `,
  styles: `
    @reference '#app-styles.css';
    .admin { @apply mx-auto flex w-full max-w-3xl flex-col gap-3 p-6; }
    .admin-heading { @apply font-display text-2xl text-ink-strong; }
    .admin-subhead { @apply text-sm text-ink-muted; }
    .admin-panel { @apply flex flex-col gap-3; }
    .admin-create { @apply flex flex-wrap items-end gap-3; }
    .admin-list { @apply flex flex-col divide-y divide-line; }
    .admin-row { @apply flex flex-wrap items-center justify-between gap-3 py-3; }
    .admin-identity { @apply flex flex-col gap-1; }
    .admin-name { @apply text-sm font-semibold text-ink-strong; }
    .admin-email { @apply text-xs text-ink-muted; }
    .admin-badges { @apply flex flex-wrap gap-1; }
    .admin-actions { @apply flex flex-wrap gap-2; }
    .admin-reset { @apply flex items-center gap-2; }
    .admin-empty { @apply py-3 text-sm text-ink-muted; }
  `,
})
export class Admin {
  private readonly admin = inject(AdminClient);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);

  protected readonly isSuperadmin = inject(AuthClient).isSuperadmin;
  protected readonly minPassword = MIN_PASSWORD_LENGTH;

  protected readonly users = signal<readonly AdminUser[]>([]);

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
