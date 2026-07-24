# Deployment Profile and Collaboration are two independent knobs

Shipping the **Desktop App** (ADR-0070) means hiding user management and sharing, and one flag looked sufficient. It isn't: there are two independent facts, and a single flag forces one of them to lie. So the client learns both over the existing unauthenticated `GET /api/config` channel (ADR-0052, Seam 4):

- **`profile`** — `desktop | server`, the **Deployment Profile**. Pinned by the entry point, with **no `hexly.yml` key**, so nobody can declare `profile: desktop` on a five-user server. `apps/api/src/main.ts` pins `server`; the desktop main pins `desktop`; `e2e-server.mjs` pins whichever a run needs.
- **`features.collaboration`** — a boolean in `hexly.yml` beside `features.plugin`, one documented home per ADR-0036. The Desktop App passes an override into `loadConfig` and ignores the key entirely, so the flag is not negotiable there.

## Why not one flag

A **solo self-hoster** — one account, Docker, no sharing — has Collaboration off _and a real password_. Under a single flag they would lose their login page along with their share buttons, or keep their sharing UI to keep logging in. Two flags, two cut lists, no forced trade.

The reverse conflation is just as bad: gating a share button on "we're in Electron" asserts a packaging fact to make a collaboration decision. That is the same collapse ADR-0039 removed when it replaced `canWrite`/`canManage` with per-resource verb arrays — two affordances sharing one rule is fine, but the gate must name the rule it means.

The dividing line, stated once: **policy questions read a flag; capability questions check the capability.** "Is `/login` a meaningful destination here?" is policy — read `profile`. "Can I re-mint a session?" is a capability — check for the preload bridge (ADR-0070), because that is the honest test and it is also what makes the same code work in a browser-based e2e run.

## The two cut lists

| Affordance                                                                      | Gated on              |
| ------------------------------------------------------------------------------- | --------------------- |
| Login page, `/login` route, Sign in / Sign out, 401 → re-mint                   | `profile === desktop` |
| Change password, Profile section (email, display name)                          | `profile === desktop` |
| Native menus, multi-window, spellcheck, Reveal data folder, asset-folder picker | `profile === desktop` |
| Entity share dialog + `manage-owners`, owner set, member set                    | `collaboration` off   |
| World and Entity Public Link, `/public/**` routes                               | `collaboration` off   |
| Entity Visibility toggle, and the Visibility Facet                              | `collaboration` off   |
| `/users` and its Command Palette entry                                          | `collaboration` off   |
| `/admin` — Superadmin Reindex                                                   | neither: always on    |

**Reindex stays** on both. ADR-0037 gives the Superadmin repair, not administration, and on the Desktop App the user _is_ the operator — there is no shell to recover from, so cutting it would leave a drifted vault with no in-app remedy. **Live-follow stays** for the reason ADR-0070 gives: multi-window.

## Enforced, not merely hidden

When Collaboration is off, the grants, members, owner-set, public-link and user-management routes **404**. This follows ADR-0068's precedent — System-managed definitions are enforced at the write choke point rather than hidden in the UI — and the motivating case is the solo self-hoster, whose port is genuinely network-reachable: a hidden button does not stop a stale tab or a curious script from minting an unguessable World Public Link into a private world. It also makes "Collaboration is off" a fact an e2e run can assert, rather than a UI convention.

Two boundaries: **`/api/auth/login` is never gated by this flag** — it is auth, not collaboration, and the solo self-hoster needs it — and neither is `/api/admin/reindex`.

`ClientConfigStore` **falls open** on a failed `/api/config`, as it already does for plugin enablement: a failed fetch shows the collaboration UI. That is the right failure for the audience that can experience it (a server), and in the Desktop App the channel is the in-process API, so a failure means nothing works anyway.

## Entity Visibility is left inert

With Collaboration off, `canReadEntity` resolves through ownership alone, so `entities.visibility` is read by nothing. We keep storing `private` (the schema default) and change no write path — no code, no branch. The consequence is named rather than fixed: a self-hoster who later turns Collaboration **on** finds their whole corpus private and invisible to new members, remedied by one bulk flip. If that upgrade becomes a real journey, the right build is a "publish all" action — which also fixes rows written before it existed — not a mint-time default, which cannot.

## Considered Options

- **A single flag, named for the packaging (`mode: desktop`).** Rejected: it imports "mode", a word `CONTEXT.md` already tells you to avoid for both `View` and `Tool`; it makes a headless Docker container "in Desktop Mode"; and it locks out the solo self-hoster.
- **A single flag, named for the collaboration only.** The first version of this design, and it broke on the first real gate: `authGuard`'s renewal branch read `if (!collaboration)`, which is wrong for a solo self-hoster who has a password and for whom `/login` is correct.
- **One enum with three values (`desktop | server | solo`).** Rejected: the enum crosscuts two independent axes, so every consumer must remember which values group together ("desktop and solo hide sharing; desktop alone has a bridge") — a set membership test where a boolean would do.
- **Deriving Collaboration from a headcount** (one user and a Superadmin ⇒ solo). Rejected: spooky action. A server that happens to have one user would silently lose its sharing UI, and adding the second would silently restore it.
- **A noun for the shape** (`Solo Instance`, `Desktop Instance`). Rejected: **Desktop App** and **Collaboration** already name the artifact and the layer, and "an Instance with Collaboration off" is three words. A third term is a synonym to keep honest against two others.
- **Hide only, endpoints live.** Rejected on the public-link hole above; the practical desktop exposure is nil, but the claim becomes untestable and the server case stays real.
- **Disabling only the capability-minting routes.** Rejected: it leaves a rule you have to explain — "sharing links are off, but you can still add a member who can't be shown anywhere" — and a rule that needs explaining rots.

## Consequences

- **Instance Role checks are not a proxy for this.** The **Sole User** holds Superadmin _and_ every Instance Role, so `nav-commands.ts` gates on `canManageUsers()` and `isSuperadmin()` — **both true** — and the Command Palette would cheerfully offer "Go to Users" in the Desktop App without an explicit Collaboration gate. Every surface reached through a role check needs auditing against these two lists, not just the visible buttons.
- **The user-menu trigger renders the Sole User's initials** (it splits `displayName`), which is an identity affordance for an identity nobody can see or edit once the Profile section is cut. It needs a non-identity trigger in the desktop profile.
- **E2E grows two browser runs, both in the established #221 per-config pattern.** A `features.collaboration: false` server-profile run (its own port, `configYaml`, and login setup — it logs in normally, because a server profile keeps its login page) covers the collaboration cut list and the 404s. A `profile: desktop` run authenticates by POSTing `/api/auth/login` directly and saving the cookie, since there is no login page, and covers the profile cut list at browser speed. Only the shell itself needs Electron.
- **`GET /api/config` is unauthenticated**, so both flags are readable without a session. Neither is a secret: they describe the deployment, and the 404 enforcement means learning "collaboration is off" tells an attacker only what the routes already tell them.
- **Two flags can disagree in principle** (`profile: desktop` with `collaboration: true`) but not in practice: the desktop entry point pins both. A server can never claim the desktop profile at all, since it has no config key.
