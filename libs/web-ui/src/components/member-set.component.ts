import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { MemberRole, UserSummary, WorldMember } from '@hexly/domain';
import { WorldsClient, UserDirectoryClient, ToasterService } from '@hexly/web-core';
import { Button } from './button.component';
import { Select } from './select.component';

/**
 * A World's non-owner membership set (ADR-0037): a World Owner adds an Instance user as a
 * Contributor or World Viewer, changes a member's role between the two, or removes them.
 * Writes are Owner-only server-side; a refusal surfaces as an error toast, leaving the list
 * untouched.
 *
 * Membership is stored as user ids + roles; names come from the {@link UserDirectoryClient}
 * directory, which carries no email (ADR-0004). Owners are excluded from the add candidates
 * — promoting to Owner belongs to the owner-set surface.
 */
@Component({
  selector: 'app-member-set',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Button, Select],
  template: `
    <ul class="member-list">
      @for (m of rows(); track m.userId) {
        <li class="member-row" [attr.data-testid]="'member-' + m.userId">
          <span class="member-name">{{ m.name }}</span>
          <select
            appSelect
            class="member-select"
            [attr.data-testid]="'role-' + m.userId"
            [value]="m.role"
            (change)="setRole(m, $any($event.target))"
          >
            <option value="contributor">
              {{ 'ui.members.contributor' | transloco }}
            </option>
            <option value="viewer">{{ 'ui.members.viewer' | transloco }}</option>
          </select>
          <button appButton size="sm" danger [attr.data-testid]="'remove-' + m.userId" (click)="remove(m.userId)">
            {{ 'ui.members.remove' | transloco }}
          </button>
        </li>
      } @empty {
        <li class="member-empty">{{ 'ui.members.empty' | transloco }}</li>
      }
    </ul>

    <div class="member-add">
      <label class="member-add-label" for="member-add-select">{{ 'ui.members.addLabel' | transloco }}</label>
      <div class="member-add-row">
        <select
          appSelect
          id="member-add-select"
          class="member-select"
          data-testid="add-select"
          [value]="selectedUser()"
          (change)="selectedUser.set($any($event.target).value)"
        >
          <option value="">{{ 'ui.members.addPlaceholder' | transloco }}</option>
          @for (c of candidates(); track c.id) {
            <option [value]="c.id">{{ c.displayName }}</option>
          }
        </select>
        <select
          appSelect
          class="member-select"
          data-testid="add-role"
          [value]="selectedRole()"
          (change)="selectedRole.set($any($event.target).value)"
        >
          <option value="contributor">
            {{ 'ui.members.contributor' | transloco }}
          </option>
          <option value="viewer">{{ 'ui.members.viewer' | transloco }}</option>
        </select>
        <button appButton variant="primary" data-testid="add" [disabled]="!selectedUser()" (click)="add()">
          {{ 'ui.members.add' | transloco }}
        </button>
      </div>
    </div>
  `,
  styles: `
    @reference '#app-styles.css';
    .member-list {
      @apply flex flex-col gap-1;
    }
    .member-row {
      @apply flex items-center justify-between gap-3 py-1;
    }
    .member-name {
      @apply flex-1;
    }
    .member-empty {
      @apply py-1 text-sm text-ink-muted;
    }
    .member-add {
      @apply mt-4 flex flex-col gap-2;
    }
    .member-add-label {
      @apply text-sm font-semibold text-ink-muted;
    }
    .member-add-row {
      @apply flex items-center gap-2;
    }
    /* Layout only — the look is the appSelect primitive's. */
    .member-add-row .member-select:first-child {
      @apply flex-1;
    }
  `,
})
export class MemberSet implements OnInit {
  readonly id = input.required<string>();

  private readonly worlds = inject(WorldsClient);
  private readonly users = inject(UserDirectoryClient);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);

  private readonly members = signal<readonly WorldMember[]>([]);
  private readonly owners = signal<readonly string[]>([]);
  private readonly directory = signal<readonly UserSummary[]>([]);

  /** The directory user picked in the add control, or '' for the placeholder. */
  readonly selectedUser = signal<string>('');
  /** The role the add control will assign — Contributor by default. */
  readonly selectedRole = signal<MemberRole>('contributor');

  /** Directory users who are neither members nor Owners — the add control's options. */
  readonly candidates = computed(() => {
    const taken = new Set<string>([...this.members().map((m) => m.userId), ...this.owners()]);
    return this.directory().filter((u) => !taken.has(u.id));
  });

  /** Member ids resolved to display rows, in the server's stable order. */
  readonly rows = computed(() =>
    this.members().map((m) => ({
      userId: m.userId,
      name: this.nameOf(m.userId),
      role: m.role,
    })),
  );

  ngOnInit(): void {
    this.users.list().subscribe({
      next: (d) => this.directory.set(d),
      error: () => this.loadFailed(),
    });
    // Owners are loaded only to keep them out of the member add list; a failure here
    // isn't fatal to managing members, so it stays silent (the member load reports).
    this.worlds.owners(this.id()).subscribe({ next: (o) => this.owners.set(o), error: () => undefined });
    this.worlds.members(this.id()).subscribe({
      next: (m) => this.members.set(m),
      error: () => this.loadFailed(),
    });
  }

  add(): void {
    const userId = this.selectedUser();
    if (!userId) return;
    this.mutate(this.worlds.addMember(this.id(), userId, this.selectedRole()), 'ui.members.addError', (members) => {
      this.members.set(members);
      this.selectedUser.set('');
    });
  }

  setRole(row: { userId: string; role: MemberRole }, select: HTMLSelectElement): void {
    // The row `<select>` is a one-way [value] bind, so a rejected change would otherwise
    // leave the DOM showing the role the server refused — revert it to the known role on
    // failure (the signal is unchanged, so nothing else would).
    this.mutate(
      this.worlds.setMemberRole(this.id(), row.userId, select.value as MemberRole),
      'ui.members.roleError',
      (members) => this.members.set(members),
      () => (select.value = row.role),
    );
  }

  remove(userId: string): void {
    this.mutate(this.worlds.removeMember(this.id(), userId), 'ui.members.removeError', (members) =>
      this.members.set(members),
    );
  }

  /**
   * Run a member-set mutation, applying its result on success or surfacing the failure as an
   * error toast. The list is mutated only inside `onOk`; `onErr` runs first on failure, for
   * DOM the signal can't revert on its own (the row role `<select>`).
   */
  private mutate(
    op$: Observable<WorldMember[]>,
    genericKey: string,
    onOk: (members: WorldMember[]) => void,
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

  /** A read (directory or member set) failed — the panel can't be trusted, so say so. */
  private loadFailed(): void {
    this.toaster.show(this.transloco.translate('ui.members.loadError'), 'error');
  }

  private nameOf(id: string): string {
    return this.directory().find((u) => u.id === id)?.displayName ?? id;
  }
}
