import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdminError,
  AdminErrorCode,
  AdminUser,
  AuthUser,
  CreateUserRequest,
} from '@hexly/domain';
import { asc, count, eq } from 'drizzle-orm';
import { solelyOwnsAnything } from '../acl/owner-set';
import { AuthService } from '../auth/auth.service';
import { DB, Db } from '../db/db';
import { entityGrants, sessions, users, worldMembers } from '../db/schema';

/**
 * The Instance Admin domain (ADR-0037, #163): account management with zero content
 * powers. Creating a user reuses {@link AuthService.seedUser} — the same provisioning
 * trunk as the seed CLI — so there is one hashing/insert path. Nothing here touches a
 * World or Entity: the Admin flag confers no content access.
 */
@Injectable()
export class AdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly auth: AuthService,
  ) {}

  /**
   * Provision a new account (Admin-driven). A duplicate email is a 409 — the
   * `users.email` UNIQUE index would otherwise surface as an opaque 500.
   */
  async createUser(req: CreateUserRequest): Promise<void> {
    const existing = this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, req.email.trim().toLowerCase()))
      .get();
    if (existing) throw this.conflict(AdminErrorCode.EmailInUse);
    // In-app provisioned accounts start gated from World Creation (ADR-0040) — an
    // Admin grants it deliberately. Only the out-of-band seed CLI leaves it on.
    await this.auth.seedUser(req.email, req.password, req.displayName, {
      canCreateWorlds: false,
    });
  }

  /**
   * Disable or re-enable an account (ADR-0037, #163): the immediate lever. Disabling
   * stamps `disabled_at` — `AuthService.authenticate`/`login` then refuse it, so live
   * sessions and fresh logins both stop, while the user's data and memberships stay
   * untouched. Enabling clears the stamp. Idempotent; an unknown id is a 404.
   *
   * Guarded like delete/demote: a plain Admin can't touch a Superadmin, no one may
   * disable themselves (self-lockout), and the last Superadmin can't be disabled — a
   * disabled Superadmin can't authenticate, so this must not drain the repair tier to zero.
   */
  setDisabled(actor: AuthUser, id: string, disabled: boolean): void {
    const target = this.loadTarget(id);
    this.assertCanManage(actor, target);
    if (disabled && actor.id === id) throw this.conflict(AdminErrorCode.SelfDisable);
    if (disabled && target.isSuperadmin && this.isLastSuperadmin())
      throw this.conflict(AdminErrorCode.LastSuperadmin);
    this.db
      .update(users)
      .set({ disabledAt: disabled ? Date.now() : null })
      .where(eq(users.id, id))
      .run();
  }

  /**
   * Every account for the admin panel (ADR-0037, #163): id, email (an Admin concern),
   * display name, the two tier flags, and the disabled stamp — never the hash. Stable
   * order by display name so the panel doesn't reshuffle between reads.
   */
  listUsers(): AdminUser[] {
    return this.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        isAdmin: users.isAdmin,
        isSuperadmin: users.isSuperadmin,
        canCreateWorlds: users.canCreateWorlds,
        disabledAt: users.disabledAt,
      })
      .from(users)
      .orderBy(asc(users.displayName))
      .all();
  }

  /**
   * Admin-driven password reset (ADR-0037, #163): no current-password check — the
   * Admin is resetting on the user's behalf. Re-hashes with argon2 via the shared
   * {@link AuthService}. An unknown id is a 404. A plain Admin can't reset a Superadmin's
   * password (that would be a login-as-Superadmin escalation) — see {@link assertCanManage}.
   */
  async resetPassword(actor: AuthUser, id: string, password: string): Promise<void> {
    this.assertCanManage(actor, this.loadTarget(id));
    await this.auth.setPassword(id, password);
  }

  /**
   * Set or clear the Instance Admin flag (ADR-0037, #163). Idempotent; an unknown id
   * is a 404. Confers no content access — it only opens the account-management surface.
   * A plain Admin can't touch a Superadmin, and no one may demote themselves out of the
   * admin surface (self-lockout).
   */
  setAdmin(actor: AuthUser, id: string, isAdmin: boolean): void {
    this.assertCanManage(actor, this.loadTarget(id));
    if (!isAdmin && actor.id === id) throw this.conflict(AdminErrorCode.SelfAdminRevoke);
    this.db.update(users).set({ isAdmin }).where(eq(users.id, id)).run();
  }

  /**
   * Grant or revoke the World Creation capability (ADR-0040): account management, so
   * Instance-Admin-gated like {@link setAdmin}. No self-revoke guard — losing your own
   * World Creation causes no lockout (unlike demoting yourself out of the admin surface).
   * An Admin may grant it to themselves, an explicit, visible act — the capability is
   * orthogonal to Admin, so it is never implied. An unknown id is a 404.
   */
  setCanCreateWorlds(actor: AuthUser, id: string, canCreateWorlds: boolean): void {
    this.assertCanManage(actor, this.loadTarget(id));
    this.db.update(users).set({ canCreateWorlds }).where(eq(users.id, id)).run();
  }

  /**
   * Delete an account (ADR-0037, #163). Refused (409) while the user is the sole Owner
   * of any World or Entity — the ≥1-Owner invariant extended to deletion, so no data is
   * ever orphaned; deletion follows reassignment (or Superadmin cleanup). Otherwise their
   * ACL residue — sessions, memberships, and non-sole owner/editor/viewer grants — is
   * cleared in one transaction (those tables reference `users` with no cascade), then the
   * row goes. An unknown id is a 404.
   */
  deleteUser(actor: AuthUser, id: string): void {
    const user = this.loadTarget(id);
    this.assertCanManage(actor, user);
    if (actor.id === id) throw this.conflict(AdminErrorCode.SelfDelete);
    // The last Superadmin is irremovable (ADR-0037, #163) — deletion must not lose the
    // repair capability, the same guard the demote path raises.
    if (user.isSuperadmin && this.isLastSuperadmin())
      throw this.conflict(AdminErrorCode.LastSuperadmin);
    if (solelyOwnsAnything(this.db, id)) throw this.conflict(AdminErrorCode.SoleOwner);
    this.db.transaction((tx) => {
      tx.delete(sessions).where(eq(sessions.userId, id)).run();
      tx.delete(worldMembers).where(eq(worldMembers.userId, id)).run();
      tx.delete(entityGrants).where(eq(entityGrants.userId, id)).run();
      tx.delete(users).where(eq(users.id, id)).run();
    });
  }

  /**
   * Set or clear the Superadmin flag (ADR-0037, #163) — the repair tier, so this endpoint
   * is Superadmin-only (guarded at the route). Demoting the last Superadmin is refused
   * (409): the operator's in-app repair capability can't be dropped to zero. Idempotent
   * on promotion; an unknown id is a 404.
   */
  setSuperadmin(id: string, isSuperadmin: boolean): void {
    const user = this.db
      .select({ isSuperadmin: users.isSuperadmin })
      .from(users)
      .where(eq(users.id, id))
      .get();
    if (!user) throw this.notFound();
    if (!isSuperadmin && user.isSuperadmin && this.isLastSuperadmin())
      throw this.conflict(AdminErrorCode.LastSuperadmin);
    this.db.update(users).set({ isSuperadmin }).where(eq(users.id, id)).run();
  }

  /** Whether exactly one Superadmin remains — the ≥1-Superadmin invariant's live count. */
  private isLastSuperadmin(): boolean {
    const [{ n }] = this.db
      .select({ n: count() })
      .from(users)
      .where(eq(users.isSuperadmin, true))
      .all();
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

  /** A structured 409 (invariant conflict) carrying a stable {@link AdminErrorCode}. */
  private conflict(code: AdminErrorCode): ConflictException {
    return new ConflictException({ code } satisfies AdminError);
  }

  /** A structured 404 for an unknown account — the id-scoped mutations' existence guard. */
  private notFound(): NotFoundException {
    return new NotFoundException({ code: AdminErrorCode.UserNotFound } satisfies AdminError);
  }

  /**
   * The actor-vs-target tier gate (ADR-0037, #163): the Admin surface is Admin-gated at the
   * route, but a plain Admin must not manage a Superadmin — resetting their password (a
   * login-as-Superadmin escalation), disabling, demoting, or deleting them. Only a Superadmin
   * manages a Superadmin. The Superadmin-flag toggle is separately SuperadminGuard-gated.
   */
  private assertCanManage(actor: AuthUser, target: { isSuperadmin: boolean }): void {
    if (target.isSuperadmin && !actor.isSuperadmin)
      throw new ForbiddenException({ code: AdminErrorCode.SuperadminManaged } satisfies AdminError);
  }
}
