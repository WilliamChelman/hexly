# nx monorepo with a shared, framework-agnostic domain library

Hexly is a single nx workspace holding `apps/web` (Angular editor), `apps/api` (NestJS backend), and `libs/domain`. The domain library is framework-free — no Angular, no NestJS imports — and owns the Hex Map types, the axial/cube coordinate math, the Zod schema for the map document, and the document migrations.

We chose a monorepo (over two repos) specifically so the model has **one source of truth**: the client manipulates hexes and the server validates and persists the *same* document, so the coordinate math and the document schema must not diverge. The framework-agnostic constraint on `libs/domain` is deliberate and load-bearing — it keeps the model reusable by both runtimes and prevents either framework leaking into the core.

We deliberately keep `libs/` minimal (just `domain`) until there's real pain; renderer and UI libraries are not split out preemptively.
