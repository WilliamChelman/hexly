# Instance-level capabilities are orthogonal per-user flags; World creation is gated

> **Superseded in part by [ADR-0047](./0047-instance-roles-as-a-set-operator-surface-is-admin.md):** the storage shape moved from boolean flags to a `roles` set, and the vocabulary from "capability" to "Instance Role". The orthogonality decision below (World creation is not implied by account management) still holds.


Until now any authenticated user could create a World (`POST /worlds`, `POST /worlds/import` — guarded only by the session). To let an operator control who spins up Worlds (clutter/structure on the World Index, not resource or monetization), we add a per-user **World Creation** capability. Rather than build a general roles system, instance-level powers are modelled as a **closed, code-known set of orthogonal boolean capabilities on the `users` row** — the same shape `is_admin`/`is_superadmin` already have — of which `manage-users` (Instance Admin) and `can_create_worlds` are the first two members.

## The decision

- **Orthogonal capabilities, not a ladder and not a role builder.** A user independently holds `manage-users` and/or `can_create_worlds`. There is no rank in which admin implies creator: creating a World is a *content* power, and Instance Admin is defined as having **zero content powers** (ADR-0037) — a ladder would erode that boundary. The set is closed and code-known (like `EntityType`, `MemberRole`), so there is no operator-authored role/permission matrix.
- **`can_create_worlds` is a new boolean column on `users`**, defaulting to `false`. Surfaced on `AuthUser` (`canCreateWorlds`) alongside `isAdmin`/`isSuperadmin`, so the web nav gates the "New World" affordance on exactly what the server enforces.
- **Enforced on both World-minting routes** — `POST /worlds` and `POST /worlds/import` — with a 403 for a caller lacking the capability. The **seed CLI is exempt** (out-of-band bootstrap, predates any capability).
- **Superadmin always may create** — the repair identity's OR'd bypass (ADR-0037), consistent with `Superadmin ⊇ Admin`.
- **Granting is account management, done by an Instance Admin** — `PATCH /admin/users/:id/can-create-worlds`, `InstanceAdminGuard`, mirroring `setAdmin`. An Admin does **not** inherently hold `can_create_worlds`; to create a World an Admin explicitly grants it (to a user, or to themselves) — an auditable, visible act, never an implicit content power.
- **Migration is a clean slate: backfill `false` for every existing user, admins included.** The instance keeps working because Admins can immediately grant the capability to whoever should create. Revoking is **not retroactive** — the flag gates the create action only; Worlds a user already owns or manages are untouched.

## Considered Options

- **A general roles system (roles table, role→permission mapping, assignment UI)** — rejected. One bit of information per user ("may create Worlds") does not justify the machinery; it pays off only with a set of permissions we don't have. When a *second* instance-level content capability appears, refactor the flags into a role model with two real data points instead of guessing the shape now. `manage-users` being an existing power (Instance Admin) is not a second point — it's the same flag renamed.
- **Fold creation into Instance Admin (admin ⊇ creator)** — rejected: breaks the documented "Instance Admin = zero content powers" boundary. Creating a World is a content act; account management must not silently confer it.
- **Grandfather existing users to `true` on migration** — rejected in favour of the clean slate: the operator's intent is to tighten who creates, so the default going forward *and* on upgrade is "cannot create," with Admins granting explicitly. (Even the sensitive half of the Admin boundary survives self-granting: `can_create_worlds` only makes *new* Worlds you own — it never grants read/edit over anyone else's existing or private content.)
- **Ship the bit via the ADR-0039 `rights` array** — rejected: `rights` are verbs *on a fetched resource*, and there is no World yet at creation time. A global user capability rides on `AuthUser`, where `isAdmin`/`isSuperadmin` already live.
- **A persona noun ("World Creator", "Author")** — rejected: it re-implies the role-bundle we declined and collides with existing vocabulary ("Contributor" already means may-create-*Entities*-in-a-World; "creator" is used loosely for whoever made a World). Modelled as a bare capability, matching how Instance Admin is framed.
