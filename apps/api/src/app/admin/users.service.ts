import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuthUser,
  CreateUserRequest,
  InstanceRole,
  instanceRolesSchema,
  UserAccount,
  UsersError,
  UsersErrorCode,
} from '@hexly/domain';
import { asc, count, eq } from 'drizzle-orm';
import { solelyOwnsAnything } from '../acl/owner-set';
import { AuthService } from '../auth/auth.service';
import { DB, Db } from '../db/db';
import { EntityWrites } from '../entities/entity-writes';
import { WorldWrites } from '../worlds/world-writes';
import { sessions, users } from '../db/schema';

/**
 * The account-management domain (ADR-0037, ADR-0047). Nothing here touches a World or
 * Entity: the `manage-users` role confers no content access.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly auth: AuthService,
    private readonly writes: EntityWrites,
    private readonly worldWrites: WorldWrites,
  ) {}

  /** Provision a new account. A duplicate email is a 409, not the UNIQUE index's opaque 500. */
  async createUser(req: CreateUserRequest): Promise<void> {
    const existing = this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, req.email.trim().toLowerCase()))
      .get();
    if (existing) throw this.conflict(UsersErrorCode.EmailInUse);
    // In-app provisioned accounts start with no Instance Roles (ADR-0047), so they cannot
    // create Worlds until one is granted. Only the seed CLI hands out `create-worlds` up front.
    await this.auth.seedUser(req.email, req.password, req.displayName, {
      roles: [],
    });
  }

  /**
   * Disable or re-enable an account. Disabling stamps `disabled_at`, which
   * `AuthService.authenticate`/`login` refuse, so live sessions and fresh logins both stop;
   * the user's data and memberships stay untouched. Idempotent; an unknown id is a 404.
   *
   * A `manage-users` holder can't disable a Superadmin, no one may disable themselves, and
   * the last Superadmin can't be disabled (a disabled Superadmin can't authenticate).
   */
  setDisabled(actor: AuthUser, id: string, disabled: boolean): void {
    const target = this.loadTarget(id);
    this.assertCanManage(actor, target);
    if (disabled && actor.id === id) throw this.conflict(UsersErrorCode.SelfDisable);
    if (disabled && target.isSuperadmin && this.isLastSuperadmin()) throw this.conflict(UsersErrorCode.LastSuperadmin);
    this.db
      .update(users)
      .set({ disabledAt: disabled ? Date.now() : null })
      .where(eq(users.id, id))
      .run();
  }

  /** Every account, never the password hash. Ordered by display name. */
  listUsers(): UserAccount[] {
    return this.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        roles: users.roles,
        isSuperadmin: users.isSuperadmin,
        disabledAt: users.disabledAt,
      })
      .from(users)
      .orderBy(asc(users.displayName))
      .all()
      .map((row) => ({ ...row, roles: parseRoles(row.roles) }));
  }

  /**
   * Management-driven password reset: no current-password check, the operator resets on the
   * user's behalf. An unknown id is a 404. A `manage-users` holder can't reset a Superadmin's
   * password (a login-as-Superadmin escalation) — see {@link assertCanManage}.
   */
  async resetPassword(actor: AuthUser, id: string, password: string): Promise<void> {
    this.assertCanManage(actor, this.loadTarget(id));
    await this.auth.setPassword(id, password);
  }

  /**
   * Replace an account's whole Instance-Role set (ADR-0047). Idempotent; an unknown id is a
   * 404. The roles open the account-management surface and gate World creation, nothing more.
   * A `manage-users` holder can't touch a Superadmin, and no one may strip their own
   * `manage-users` role.
   */
  setRoles(actor: AuthUser, id: string, roles: readonly InstanceRole[]): void {
    this.assertCanManage(actor, this.loadTarget(id));
    if (actor.id === id && !roles.includes('manage-users')) throw this.conflict(UsersErrorCode.SelfManageUsersRevoke);
    this.db
      .update(users)
      .set({ roles: JSON.stringify([...roles]) })
      .where(eq(users.id, id))
      .run();
  }

  /**
   * Delete an account. Refused (409) while the user is the sole Owner of any World or Entity
   * (the ≥1-Owner invariant): deletion follows reassignment. Otherwise their ACL residue —
   * sessions, memberships, and non-sole owner/editor/viewer grants — is cleared in one
   * transaction, since those tables reference `users` with no cascade. An unknown id is a 404.
   */
  deleteUser(actor: AuthUser, id: string): void {
    const user = this.loadTarget(id);
    this.assertCanManage(actor, user);
    if (actor.id === id) throw this.conflict(UsersErrorCode.SelfDelete);
    // The last Superadmin is irremovable: deletion must not drop the repair tier to zero.
    if (user.isSuperadmin && this.isLastSuperadmin()) throw this.conflict(UsersErrorCode.LastSuperadmin);
    if (solelyOwnsAnything(this.db, id)) throw this.conflict(UsersErrorCode.SoleOwner);
    // One outermost transaction (ADR-0045). The purges bump the touched rows' `seq` but emit
    // nothing: the deleted user's sessions go with them, and no surviving principal's Rights changed.
    this.writes.transact(() => {
      this.db.delete(sessions).where(eq(sessions.userId, id)).run();
      this.worldWrites.purgeMembershipsOf(id);
      this.writes.purgeGrantsOf(id);
      this.db.delete(users).where(eq(users.id, id)).run();
    });
  }

  /**
   * Set or clear the Superadmin flag — Superadmin-only, guarded at the route. Not an Instance
   * Role: toggled on its own, never through the roles set. Demoting the last Superadmin is
   * refused (409). Idempotent on promotion; an unknown id is a 404.
   */
  setSuperadmin(id: string, isSuperadmin: boolean): void {
    const user = this.db.select({ isSuperadmin: users.isSuperadmin }).from(users).where(eq(users.id, id)).get();
    if (!user) throw this.notFound();
    if (!isSuperadmin && user.isSuperadmin && this.isLastSuperadmin())
      throw this.conflict(UsersErrorCode.LastSuperadmin);
    this.db.update(users).set({ isSuperadmin }).where(eq(users.id, id)).run();
  }

  /** Whether exactly one Superadmin remains — the ≥1-Superadmin invariant's live count. */
  private isLastSuperadmin(): boolean {
    const [{ n }] = this.db.select({ n: count() }).from(users).where(eq(users.isSuperadmin, true)).all();
    return n === 1;
  }

  /** Load the target's id + tier for the id-scoped mutations; an unknown id is a 404. */
  private loadTarget(id: string): { id: string; isSuperadmin: boolean } {
    const target = this.db
      .select({ id: users.id, isSuperadmin: users.isSuperadmin })
      .from(users)
      .where(eq(users.id, id))
      .get();
    if (!target) throw this.notFound();
    return target;
  }

  /** A structured 409 (invariant conflict) carrying a stable {@link UsersErrorCode}. */
  private conflict(code: UsersErrorCode): ConflictException {
    return new ConflictException({ code } satisfies UsersError);
  }

  /** A structured 404 for an unknown account — the id-scoped mutations' existence guard. */
  private notFound(): NotFoundException {
    return new NotFoundException({
      code: UsersErrorCode.UserNotFound,
    } satisfies UsersError);
  }

  /**
   * The actor-vs-target tier gate: only a Superadmin may manage a Superadmin — reset their
   * password (a login-as-Superadmin escalation), disable, demote, or delete them.
   */
  private assertCanManage(actor: AuthUser, target: { isSuperadmin: boolean }): void {
    if (target.isSuperadmin && !actor.isSuperadmin)
      throw new ForbiddenException({
        code: UsersErrorCode.SuperadminManaged,
      } satisfies UsersError);
  }
}

/** A corrupt or hand-edited `roles` value degrades to no roles rather than breaking the listing. */
function parseRoles(raw: string): InstanceRole[] {
  try {
    const parsed = instanceRolesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
