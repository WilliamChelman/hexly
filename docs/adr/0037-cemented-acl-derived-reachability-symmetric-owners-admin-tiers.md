# Cemented ACL: absolute privacy, derived reachability, symmetric ownership sets, two admin tiers

ADR-0004 and ADR-0024 sketched the sharing model; this ADR cements it into an implementable spec and resolves their ambiguities. Both layers — world roles and entity-level grants — are built together, not staged. The access predicate for reading an Entity is:

```
canRead(user, entity) =
    user ∈ entity.owners
  ∨ user has an entity-level grant (Editor or Viewer)
  ∨ (user is a member of entity.world ∧ entity.visibility = 'shared')
```

plus the anonymous equivalents: a per-entity Public Link (an anonymous Viewer grant) and the World Public Link (anonymous World Viewer over `shared` Entities).

## The cemented rules

- **Private is absolute within the collaboration model.** No role — World Owner, Instance Admin — pierces `private`. Only an Entity's Owners and its entity-level grants (named or link) reach it. ADR-0024's role table is hereby qualified: World Owner's "edit others' entities" applies to `shared` Entities only.
- **World Owners fully curate the shared surface**: edit, delete, and change visibility of any `shared` Entity in their World — but do **not** manage its grants/links. Grant and link administration belongs to the Entity's Owners alone (grants pierce `private` and outlive visibility flips, so they stay with the accountable party; delete is the World Owner's nuclear revoke).
- **Editor grants cover substance, not lifecycle**: document, name, tags, metadata — everything autosave touches. No delete, no visibility change, no grant management.
- **Grants target any Instance user** — World membership is not a precondition. This is less code than enforcing member-only and covers "share one note with an outsider". Consequently **World reachability is derived, not stored**: a World is reachable iff you own it, are a member, or can reach any Entity inside it. The World Index lists reachable Worlds; an ex-member who still owns Entities in a World keeps minimal reachability.
- **Per-user visibility is not a deferred feature** — ADR-0024 deferred it while keeping ADR-0004's grants "available on top", but a Viewer grant on a `private` Entity *is* per-user visibility. The two collapse into one thing, delivered by the grants layer.
- **The per-entity Public Link pierces `private`** — it is an anonymous Viewer grant, one rule with the named grants (and with ADR-0034's capability-URL assets). Revoking the link is how access is withdrawn, not flipping visibility.
- **The Home Entity is always `shared`** (visibility locked, like its title and deletability) so a World shared with anyone always has a landing page.
- **Ownership is a symmetric set, at both levels.** Worlds and Entities have one or more Owners, all equal; any Owner may add or remove other Owners; the creator holds no special status after creation. Single invariant: at least one Owner — the last cannot be removed or resign. A rogue co-owner *can* evict the creator; co-own only with people you trust (it's a friends instance).
- **Membership admin**: World Owners add/remove members and set roles (Contributor ↔ Viewer) by picking existing Instance users — no invite/acceptance flow (closed user set, ADR-0004). Members may leave voluntarily; access simply recomputes.
- **Ex-member residue is accepted.** A removed member's `private` Entities remain in the World — unreadable and individually undeletable by the World Owners (private is absolute; world deletion is the nuclear remedy). A ~5-user instance solves this socially, and the rules stay clean.
- **Two admin tiers.** **Instance Admin**: account management (create/disable/delete users, password resets, the Admin flag itself) plus future instance-settings panels — zero content powers. **Superadmin**: unrestricted, the in-app embodiment of the operator (who already holds shell/DB access), sitting outside the collaboration model; exists for repair, not administration. At least one Superadmin, seeded at setup.
- **Orphans are impossible by construction.** Deleting a user is refused while they solely own any World or Entity (the ≥1-Owner invariant extended to account deletion). *Disable* — login locked, data and memberships intact — is the immediate lever; deletion follows reassignment or Superadmin cleanup.
- **No existence leaks.** Listings and facet counts scope to what the caller can list; inaccessible Entities/Worlds read as 404, never 403 (extends the existing entity pattern). A reachable World with a forbidden mutation stays 403.

## Schema deltas (sketch)

```
world_members:  role gains 'owner'          -- world ownership becomes member rows; worlds.owner_id retires
entity_owners:  { entity_id, user_id }      -- entities.owner_id retires into a set
entity_grants:  { entity_id, user_id, role: editor | viewer }
entity_links:   { id (token), entity_id }   -- per-entity Public Link (world_links already exists)
users:          + is_admin, is_superadmin, disabled_at
```

## Considered Options

- **World Owner sees others' private Entities** ("it's the GM's world") — rejected: `private` stops meaning private; players lose their scratch space. Middle grounds (read-not-edit, delete-unseen) were rejected as two rules where one suffices.
- **Staging the grants layer after world roles** — rejected by deliberate choice to build both layers in one push, accepting the larger surface (grant CRUD, share UI, per-entity links) to avoid shipping an ACL that immediately grows a second one.
- **Member-only grant targets** — rejected: the restriction is *extra* code, and it kills the share-one-note-with-an-outsider flow.
- **Link access gated on `shared`** (visibility as link kill-switch) — rejected: named and anonymous grants would diverge, and the secret-handout flow dies.
- **Creator-protected or creator-adminned ownership** — rejected: reintroduces hierarchy and still needs a transfer mechanism for hand-off; symmetric sets need neither.
- **Cascade or orphan-tolerant user deletion** — rejected: cascade is unrecoverable on accident (the motivating fear); orphan-tolerance propagates an ownerless code path everywhere, the same reasoning that made `world_id` NOT NULL in ADR-0024.
- **Single almighty admin role** — rejected in favour of the two tiers: day-to-day account management shouldn't carry content omniscience, but pretending no one can read the SQLite file is dishonest — the Superadmin makes the operator's real power visible and auditable.

## Consequences

- Extends ADR-0004 and ADR-0024; qualifies 0024's role table (Owner edits *shared* others' Entities only) and un-defers per-user visibility (delivered as grants).
- `EntitiesService`'s owner-only choke point (`ownedRow`) generalizes to the access predicate above; `WorldsService.reachableWorld` generalizes to derived reachability. Listing/facet queries must scope by the same predicate to avoid existence leaks.
- The unauthenticated surface grows from zero to token-scoped read-only routes (world link, entity link) — each must stay read-only and revocable per ADR-0004.
- Deferred, explicitly: link expiry, multiple concurrent links per target, per-member visibility UI beyond grants, ownership-transfer UX sugar (a transfer is add-owner + resign).
