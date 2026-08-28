# Nomey — agent instructions

## Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before
writing any code. Knowledge of older SDKs produces code that does not compile
here. Verify APIs against that URL rather than recalling them.

---

## What Nomey is

A mobile app (iOS + Android) built on three pillars:

1. **Personal finance** — income, expenses, categories, budgets, recurring
   items, savings goals, forecasting, real available money.
2. **Shared expenses** — groups, trips, couples, flatshares, who paid, how it
   splits, debts, settlements.
3. **~5-second entry** — adding an ordinary expense must be near-instant, from
   inside the app and later from widgets, Siri and the Action Button.

Web is deliberately **not** a target platform.

---

## How decisions get made

**No instruction is technically authoritative on its own** — not the user's,
not a second technical review's, not a previous agent's, and not yours. The
goal is the best decision backed by evidence, plus a record of why it was
taken. Neither obedience nor being obeyed is the objective.

When a request touches **architecture, security, the data model, dependencies,
infrastructure, compatibility, build/release, or anything hard to reverse**,
before executing:

1. **Check the repository's actual state.** Do not reason from what you assume
   is there.
2. **Consult official, versioned documentation** when the decision depends on
   external behaviour.
3. **Check whether an accepted ADR already governs it.**
4. **Weigh alternatives and their trade-offs.**
5. **If the request is technically worse than another option, say so before
   executing it**, not after.
6. **Separate verified facts from inferences from preferences**, and label
   which is which.
7. **Avoid absolutes** — "zero risk", "always", "impossible", "required" —
   unless actually demonstrated. Say what was measured and what was not.
8. **For open decisions of consequence, recommend and wait.** Do not change the
   project while the decision is still open.

Disagreeing is part of the job. Once a decision is made with the trade-offs on
the table, implement it fully and record the reasoning where it belongs — an
ADR for architecture, the commit message for everything else.

---

## Rules that matter most

These are the rules most likely to be violated by default. Breaking one of them
produces a bug that is silent, expensive, or both.

> **Three kinds of statement live here.** Do not read them as one:
>
> - **Decided product invariants** — settled by the product. No implementation
>   may contradict them.
> - **Accepted technical and security principles** — justified engineering
>   positions, revisable with a better argument or contrary evidence.
> - **`Open (ADR)`** — explicitly undecided. Marked as such in place, and
>   binding on nobody.
>
> Everything here is expressed in domain terms, not schema terms. Table names,
> column layout and which facts are stored versus derived are **not settled** —
> they belong to the data-model ADR written in Phase 1. Needing a concrete table
> name to proceed is a signal the ADR is missing, not a licence to invent one.

**Before writing any strong rule here — MUST, NEVER, ALWAYS — apply this
test.** Is it a _statement about the world_ (then it needs evidence and
qualification) or a _constraint we choose to impose_ (then an imperative is
fine)? And crucially: **is the imperative smuggling in a decision that belongs
to an ADR?** Grammatical force does not turn a pending implementation choice
into an invariant.

Strong rules are welcome. A strong rule earns its place when it states a
decided invariant, states a sufficiently justified security principle, or is
backed by an accepted ADR. Otherwise it belongs in an ADR, not here.

### 1. Money

- **Monetary values that are a source of accounting truth are represented
  exactly**, never through binary floating point that can introduce precision
  error.
- **Every amount carries a monetary definition.** There is no such thing as a
  bare amount. Nomey is multi-currency by design even while the UI shows one.
- **The monetary definition has a stable internal identity. The ISO 4217 code is
  a visible attribute of it, not that identity.** Two amounts are **not**
  aggregable merely because they share an ISO code: the same code can belong to
  different definitions over time. The full rules are in ADR-003 and are not
  restated here.
- **Decimal scale belongs to the monetary definition.** EUR has 2, JPY has 0.
  Never hardcode 2 decimals.
- **Rounding and remainder allocation are deterministic and documented.** 100
  between 3 is 33.33 / 33.33 / 33.34, and which participant absorbs the extra
  minor unit follows a written rule. If balances do not reconcile exactly, it
  is a bug.
- **Formatting is not domain logic.** `domain/` does the arithmetic; `lib/format`
  turns the result into a locale string.

**The boundary rule** — this is the one to apply mechanically:

> Any value that gets persisted, that enters a balance or a debt, or that is
> displayed as an accounting figure, comes from the exact representation.
> Approximate computation (chart geometry, forecasts, budget-consumption
> ratios, animated counters) may use floating point, but must never feed back
> into a value of record.

**Settled — [ADR-003](docs/adr/ADR-003-money-representation.md), status
`Aceptado`.** Amounts are integer minor units (`bigint` / `BIGINT`), exchange
rates are a separate exact decimal, and nothing monetary crosses JSON as a
number. Read the ADR before writing anything that touches money.

**The verification requirement was met.** Experiment **E11** ran against a real
local Supabase stack and measured that PostgreSQL and PostgREST both keep the
value exact, but JavaScript degrades it the moment it parses those JSON numbers
into `number`: `int8` above 2^53 loses precision silently, and `numeric` loses
its exact-decimal guarantee and its scale. **An explicit textual boundary is
therefore required** — which boundary is a schema decision, not this file's.
Evidence: `supabase/e11/`.

Note that in TypeScript a plain `number` _is_ an IEEE-754 double, exact only for
integers up to 2^53, so "use an integer" is itself a choice with limits rather
than an escape from the question.

### 2. Cash flow is not economic expense is not debt

A shared expense is **three distinct facts**, not one. If someone pays 120 for a
dinner split 4 ways:

| Fact                                     | Amount |
| ---------------------------------------- | ------ |
| Cash movement — money left their account | −120   |
| Economic expense — what they consumed    | −30    |
| Claim — what the others owe them         | +90    |

Two consequences that hold regardless of how any of this is stored:

- **A settlement is not income.** When the 90 comes back it cancels a debt; it
  must never inflate income or count as new earnings.
- **Cash movements and economic expense answer different questions and must not
  be substituted for one another.** Reporting "you spent 480 this month" from
  cash movements makes whoever pays for dinners look reckless and whoever never
  pays look frugal. Both figures are wrong and neither throws an error.

**Settled — [ADR-002](docs/adr/ADR-002-accounting-model.md) and
[ADR-011](docs/adr/ADR-011-operation-version-model.md)** for how the facts are
represented (operation, immutable version, effect with separate dimensions), and
**[ADR-013](docs/adr/ADR-013-persisted-vs-derived.md)** for which are stored and
which are derived: balances, debts, statistics, totals and both `Disponible`
figures are **derived from the effects of the current version**, and there is no
economic cache in v1. Physical names still belong to the migrations.

### 3. Idempotency

**Any monetary operation that can be retried must be idempotent.** Replaying it
must not produce a second record.

Quick entry can fire from a widget with no network and be retried, so this
starts as a client concern — but it is not only one. Recurring charges, imports,
backend-originated operations and future bank integrations all replay too, and
each needs an equivalent guarantee rather than the same mechanism.

Without this, the result is duplicate money in production with no clean way to
deduplicate afterwards.

**Settled for the client origin —
[ADR-010](docs/adr/ADR-010-client-operation-idempotency.md) and
[ADR-011](docs/adr/ADR-011-operation-version-model.md) §5.** A UUID generated and
persisted by the client before the first attempt, unique per
`(actor, client_operation_id)` **across every operation class**, compared
**only** on the server, and held by a separate command relation — not by the
operation, because one operation can be the result of several commands.

**Still open (ADR):** the mechanism for **recurring charges, imports and
backend-originated operations**. Each needs an equivalent guarantee rather than
the same mechanism, and none of them is decided.

### 4. Database authorization

RLS is Nomey's **primary row-level authorization mechanism**, and it is one
layer among several. Supabase's own hardening guidance is explicit that grants
and RLS are complementary: "Grants control whether a role can access an object.
RLS controls which rows the role can access. Use both controls for every
exposed object." Note also that **RLS does not apply to functions at all**.

The layers that together make up database authorization:

- **Exposed schema** — what the Data API can reach.
- **Grants** — explicit, minimal privileges per role; default grants reviewed
  rather than inherited.
- **RLS** — which rows, for a role that already has the grant.
- **Functions** — `EXECUTE` granted narrowly; every `SECURITY DEFINER` function
  reviewed as a privilege boundary, because it runs with **its owner's**
  privileges, so RLS is evaluated against that owner and not against the caller.
- **Key separation** — client versus backend credentials (see §7).

Rules:

- **No table is created without its RLS policy in the same migration.** A table
  exposed through the Data API without RLS is reachable by any role holding a
  matching grant.
- **Grants are set deliberately, not inherited.** RLS on a table with excessive
  grants still widens the surface.
- **Client-side filters are never security.** `.eq('user_id', me)` is an
  optimisation; the attacker simply omits it.
- **A policy must not depend on itself in a way that recurses.** A policy that
  queries the very table it protects is a design error, and relaxing the policy
  to "fix" it is worse than the bug.
- **Any `SECURITY DEFINER` function pins `search_path` explicitly** and is
  reviewed as a privilege boundary.
- **A `SECURITY DEFINER` owner that neither owns the table nor holds
  `BYPASSRLS` is still subject to RLS**, including on writes. **E16 measured
  it**, and it is what makes the authoritative writer of
  [ADR-009](docs/adr/ADR-009-authoritative-write-boundary.md) a second barrier
  rather than an escape hatch. Never assume a definer function is above RLS —
  check who owns it.

**Settled — [ADR-007](docs/adr/ADR-007-membership-rls.md).** The RLS of the
persistence schema is the row-level authority, evaluated under the real user's
identity through `security_invoker` views; membership is resolved by a reduced
`SECURITY DEFINER` helper that takes the scope and never an arbitrary user; and
**no membership claims go in the JWT**, because a claim in the token keeps
someone's access alive until it refreshes.

**Settled — [ADR-005](docs/adr/ADR-005-schema-topology.md).** There is a
dedicated schema for the exposed surface, and the accounting tables are not
reachable through it.

**Settled — [ADR-014](docs/adr/ADR-014-data-api-schema-exposure.md).** `public`
is **not** exposed either. The list is `["api", "graphql_public"]`, and
`extra_search_path` is unchanged — they are two different parameters. The
config change lands **in the same commit that creates the `api` schema**:
PostgREST fails to start if a listed schema does not exist — measured.

**What that measurement does not cover:** whether, from a clean clone, Supabase
applies the migration that creates `api` **before** PostgREST demands it. Same
commit is **necessary**; its **sufficiency at boot is unverified**, and
verifying it is an acceptance criterion of the first migration.

### 5. Participants without an account

Three invariants, all decided:

- **A participant can exist without a user account.** Someone may be added to a
  group and take part in expenses before ever installing Nomey.
- **Linking a participant to a real user later loses no history** — no expense,
  share, debt or record of what happened before the link.
- **Claiming a participant requires proof of authorization.** A name match, or
  an unverified email match, is **not** proof.

**Settled — [ADR-012](docs/adr/ADR-012-participant-identity.md).**

- The participant is **contextual per scope**, not global, and participants of
  different scopes are **never correlated automatically**. The reason is
  privacy: a global participant would force answering "is this the same Carlos?"
  before anyone had proved it.
- The link to an account lives in a **separate relation**, not as a nullable
  reference on the participant.
- **Effects always reference the participant, never the user.** This is what
  makes a later claim change no accounting fact at all.
- **Presence periods** are separate from user membership, and **claiming
  establishes identity, not access**.

**Still open (ADR), delegated to F10:** what constitutes proof — a single-use
invitation token, a verified email invitation issued by an existing member,
explicit approval by a member, or a combination; **revocation and unlink**; and
**duplicate handling and participant-to-participant merges**. The invariant is
the proof requirement, not the mechanism.

### 6. Internationalisation

Spanish and English from the start. Even before an i18n library exists:

- **Never hardcode `€`** or any currency symbol.
- **Never hardcode Spanish date formats.**
- Keep user-facing strings out of logic and components; they must be
  extractable.
- Separate the monetary **value** from its **formatting**.

### 7. Secrets and API keys

**The invariant:** a backend credential with elevated privileges is never
present in the client bundle. No exception, no variant, no "just for testing".

- `EXPO_PUBLIC_*` variables are **inlined into the app bundle** and readable by
  anyone who downloads the binary.
- Never commit `.env`.

**Which keys Nomey uses.** Supabase's current API keys: **publishable**
(`sb_publishable_…`) for the client, **secret** (`sb_secret_…`) for backend
components only — Edge Functions, servers, CI. The legacy `anon` /
`service_role` JWT keys are documented by Supabase as deprecated, so Nomey does
not start on them.

Legacy names, recorded only so older tutorials can be read: `anon` ~
publishable, `service_role` ~ secret.

That map is an orientation, **not an equivalence**. The new keys differ in
implementation and compatibility from the legacy ones, particularly around Edge
Functions and JWT verification. **Whenever a concrete integration depends on a
key's authentication behaviour, verify it against the current official docs
before implementing it.** How each future Edge Function authenticates is not
decided here.

### 8. Logging

Never log full transaction objects — amounts and descriptions end up in Sentry
and platform logs. Log IDs only.

---

## Architecture

```
src/
├── app/        # expo-router routes only. Thin files, composition only.
├── features/   # self-contained functional domains
├── domain/     # pure business rules. No React/Expo/Supabase/network.
├── lib/        # infrastructure: supabase, query, offline, format, env
├── ui/         # design system, domain-agnostic
└── types/      # cross-layer shared types
```

**Dependency direction is one-way:** `app/ → features/ → domain/ + lib/ + ui/`,
with `lib/` allowed to use `domain/` and `domain/` depending on nothing. Never
the reverse, never feature → feature, and `ui/` may not reach `lib/` either — a
component does not fetch its own data.

Enforced by ESLint (`import/no-restricted-paths`) against the **resolved
location** of each import, so writing `../lib/x` instead of `@/lib/x` does not
get around it. A violation fails lint; it is not a style opinion.

Each directory has a `README.md` stating its constraints. Read it before adding
files there.

**Never create a generic `utils/`.** It becomes a dumping ground. Code belongs
in `domain/` (business rules), `lib/` (infrastructure) or `ui/` (presentation).

**Before building any UI, read
[`docs/product/design-direction.md`](docs/product/design-direction.md).** It is
the single source of truth for Nomey's aesthetic — dark, minimal, premium, with
glassmorphism as the depth device and neumorphism only as a tactile hint — and
it binds every phase that builds UI, not just F4. Its accessibility rule is
binding: if an effect costs contrast, legibility, or the unambiguity of an
amount, a debt, a state or a destructive action, the effect goes. Changing that
direction is documented there, never introduced from a single screen.

---

## Conventions

- **Node 22.23.2**, pinned exactly in `.nvmrc`, which CI reads. React Native
  0.86 declares `^20.19.4 || ^22.13.0 || ^24.3.0 || >= 25.0.0`; Nomey narrows
  that to one version so local, CI and EAS run the same binary.
  `engines` (`>=22.13.0 <23`) **declares** the admissible range but does not
  enforce it: without `engine-strict`, npm treats a mismatch as an
  `EBADENGINE` warning and installs anyway. `engine-strict` is not enabled yet.
  Bumping the pinned version is a deliberate change to `.nvmrc`, not something
  to do in passing.
- **File names:** kebab-case (`shared-expense-card.tsx`).
- **Imports:** the `@/` alias maps to `src/`. Use relative paths inside a
  feature.
- **Language:** code, identifiers, comments and commit messages in **English**.
  Documentation under `/docs` in **Spanish**. UI strings are localised.
- **Commits:** Conventional Commits, imperative mood
  (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`).
- **Branches:** `feature/*`, `fix/*`, `chore/*` off `main`. Never commit
  directly to `main`.
- Prefer small files. If a file is doing two jobs, split it.

---

## Verification

There are no automatic edit hooks, by design — they make the loop noisy while
the project is starting. Instead, **after a meaningful unit of work**, run:

```bash
npm run verify
```

which runs typecheck → lint → format check. Run tests too once they exist
(`npm test`, from Phase 2 onward). GitHub Actions is the final gate on every
PR.

If you changed anything native or config-level, also confirm the app still
starts (`npx expo start`).

### Commands

| Command             | What it does                    |
| ------------------- | ------------------------------- |
| `npm ci`            | Install from the lockfile       |
| `npm start`         | Expo dev server                 |
| `npm run ios`       | Dev server, iOS                 |
| `npm run android`   | Dev server, Android             |
| `npm run typecheck` | `tsc --noEmit`                  |
| `npm run lint`      | `expo lint`                     |
| `npm run format`    | Prettier, write                 |
| `npm run verify`    | typecheck + lint + format check |

The Supabase CLI is the exception: it runs **from Ubuntu (WSL2)**, not Windows,
via `./scripts/supabase-cli.sh`, which pins its version in a single line. The
setup and the reason are in
[`docs/runbooks/local-setup.md`](docs/runbooks/local-setup.md).

---

## Do not

- Change the database from the Supabase dashboard. **Schema changes happen only
  through files in `supabase/migrations/`.**
- Run anything against production.
- Commit `.env`, keys, certificates or provisioning profiles.
- Edit `/ios` or `/android` while they are generated by CNG (both are
  git-ignored). If native code becomes necessary, that is an ADR decision
  first.
- Edit generated files by hand: `expo-env.d.ts`, `src/types/database.ts`.
- Add runtime dependencies without explicit approval. Every dependency is
  bundle weight, an upgrade liability and attack surface. When one is approved,
  add Expo-ecosystem packages with `npx expo install <pkg>`, which picks the
  version matching the installed SDK — a plain `npm install <pkg>` can pull one
  that does not fit SDK 57.
- Use `npm install` to prepare an existing checkout. Use `npm ci`: it installs
  exactly what the lockfile pins and fails if the lockfile has drifted.
- Run `npm install` or `npm ci` **from WSL** against this checkout. Windows and
  Ubuntu share one physical `node_modules` through `/mnt/c`, and it belongs to
  the Windows toolchain: installing from Linux swaps platform artefacts and
  breaks the other side silently. The Supabase CLI does not need it — see
  [`docs/runbooks/local-setup.md`](docs/runbooks/local-setup.md).
- Push or merge to `main` without being asked.

---

## Decisions live in ADRs

Architectural decisions are recorded in `docs/adr/` and are **immutable once
accepted**: superseding one means writing a new ADR, not editing the old.

Any change that contradicts an accepted ADR updates it **in the same PR**. Use
the `adr` skill to draft one.

---

## Project context

- **`docs/PROJECT_STATE.md` is current state, not history.** It says where Nomey
  is, never how it got there.
- **Obsolete information is replaced or deleted, never stacked underneath the
  new.** It must not grow by accumulation; the history lives in Git, the ADRs,
  the handoffs and the roadmap.
- **Update it only when the globally relevant state changes** — a phase opens or
  closes, a stable public surface changes, a cross-cutting invariant changes, an
  architectural decision with future impact is accepted, a deferred decision
  moves, or a global technical limitation appears or disappears. Not per task,
  commit, branch, PR, test or internal refactor.
- **Load further context on demand**, driven by the task at hand: the relevant
  ADR, migration, domain module, check or section — not whole families of
  documentation up front.
- **The full protocol is
  [`docs/runbooks/project-context.md`](docs/runbooks/project-context.md).**

---

## Current state

> **Start here: [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md).** It is the
> compressed state of the project — current phase, live architecture, the `api`
> surface, the invariants a future phase must not break, and what is deferred.
> This section keeps the detail that only matters while touching the data layer.

**Phases 0 through 5 are CLOSED.** Phase 3 (persistence and data boundary) closed
on 2026-08-27 and Phase 5 (identity and session) on 2026-08-28. **ADR-001 through
ADR-025 are accepted**; ADR-003 met its E11 gate against a real local Supabase
stack.

**Phase 6 is OPEN** — Modo Personal, the first showable milestone. It touches the
backend, the domain and the screens. Its state block by block, and the
obligations each block leaves the next, are in
[`docs/architecture/phase-6-handoff.md`](docs/architecture/phase-6-handoff.md).
What it inherits from Phase 5 is in
[`docs/architecture/phase-5-handoff.md`](docs/architecture/phase-5-handoff.md).

Two artefacts closed the phase and are worth knowing about:

- [`docs/architecture/model-coverage.md`](docs/architecture/model-coverage.md) —
  every concept of `data-model.md` mapped to persisted, derivable, projection,
  runtime, or **deferred with its reason and its destination**. Nothing is left
  in no-man's-land.
- [`scripts/http-boundary-check.sh`](scripts/http-boundary-check.sh) — the whole
  boundary over **HTTP with a real JWT**: Kong, GoTrue, PostgREST, `api`, the
  writer and RLS. It is the one thing no SQL check can prove, because every
  other check simulates identity with `set_config`. It is why the CI stack no
  longer excludes GoTrue.

**What exists now.** A reproducible local Supabase stack (`supabase/config.toml`)
and eleven reproducible probes that measured the decisions behind the schema
(`supabase/e11/` … `supabase/e21/`, **none of them a migration**). A pure
reference implementation of the financial domain in `src/domain/`, with shared
test vectors in `tests/vectors/` and a Vitest suite — 116 tests. **The
authoritative server write boundary will have to reproduce those vectors
exactly** (ADR-002 §7).

**What does not exist yet.** No screens with economic function, and no
provisioning for Groups — nothing creates a group, a participant, a
participant-account link or a presence period. The writer assumes those rows
exist because the phase that creates them is a later one, and the database checks
seed them as `postgres`.

**The Modo Personal has a route, and the app does not use it yet.**
`api.ensure_personal_scope` creates the scope and its membership under a third
role, `nomey_provisioner` — [ADR-019](docs/adr/ADR-019-personal-provisioning.md).
It is safe, idempotent and verified over HTTP with a real JWT, but **no client
code calls it**, so a freshly confirmed account still has no personal scope until
something does. Wiring it into the authenticated lifecycle is F6.E, and it comes
before Inicio consumes the scope.

**The Modo Personal can finally be read, and the unit is the operation.** F6.D
added `api.personal_operation` (one row per operation, current version),
`api.personal_operation_version` (the correction history), `api.personal_balance`
(the Disponible, derived and already aggregated) and
`api.observed_balance(uuid[])`. Four things to know before touching any of it.
**The observation leaves through a FUNCTION and never a view** — the ADR-023
guard still demands ZERO `api` views over `core.balance_observation`, so a new
guard bounds the single function that may read it rather than the old one being
relaxed. **The history cannot publish a signed amount**: a superseded version’s
effects live in `core.effect`, which no view may read, so it publishes the
DECLARED `original_amount` and nobody fabricates the sign with a `case`. **The
class whitelist bounds the LIST, never the BALANCE** — the Disponible derives
from every current effect, and from F9 the two need not agree. And **a page
costs three queries, not 1+N**: the list publishes `previous_version_id` and the
observation takes an array.
[ADR-025](docs/adr/ADR-025-personal-read-surface.md); falsifications, including
the one that did NOT falsify, in `supabase/checks/read-surface.sql`.

**The balance is serialized, observed and annullable.** F6.C added
`target_balance` — the client declares the balance it claims to hold and **the
server derives the delta under lock**, so no delta is ever computed on a
possibly stale read. Three things to know before touching any of it.
**The protocol now covers two dimensions under one ascending order**:
`sec.lock_debt_scopes` became `sec.lock_scopes`, and the **seven** classes that
produce a balance effect all participate — not just the adjustment, because
`core.balance_observation` turns every balance write into a read and a partial
serialization serializes nothing. **That observation is not a cache**: written
once under lock, per version and per scope, insert-only, and a catalogue guard
fails if any `api` view derives the `Disponible` from it. And **deleting a
movement is a version with no effects** — nothing is deleted, `current_version_id`
stays the only authority on what counts, and annulment is terminal in F6.
[ADR-022](docs/adr/ADR-022-balance-target-and-serialization.md),
[ADR-023](docs/adr/ADR-023-balance-observation.md) and
[ADR-024](docs/adr/ADR-024-annulment.md); races measured in `supabase/e22/`.

**A movement now means something, and `ingreso` finally has a route.** F6.B added
a mandatory free-text concept, a category that is always present with separate
expense and income catalogues, an effective time of day, and
`api.record_personal_income` — the eighth function, for a class the model has
carried since Phase 1 with nowhere to write it. Two things worth knowing before
touching any of it: **what every version has and what a class needs are kept
apart** — the time is a nullable column on the version, concept and category live
in `core.movement_detail`, present only where the fact exists, so **no class
invents a synthetic value** — and **a writer of one class can no longer correct an
operation of another**, guarded in `sec.persist_version`, which all eight pass
through. [ADR-020](docs/adr/ADR-020-version-content-and-time.md) and
[ADR-021](docs/adr/ADR-021-category-catalogue.md).

**Migrations have started.** `supabase/migrations/` holds sixteen. The first is the
**bootstrap of the data boundary** — the three schemas, explicit revokes and the
default-privilege sanitising — and nothing else. Rebuilding from zero is
verified, and so is ADR-014: `api` is served and `public`, `core` and `sec`
answer `406 PGRST106`.

> `supabase/e11`–`e21` were disposable evidence over toy models and **must never
> become a migration**. `supabase/migrations/` is real versioned state.
> `supabase/checks/bootstrap.sql` validates it against the live catalogue.

**The versioning spine is migrated too.** `core.operation`,
`core.operation_version`, `core.client_command` and `core.currency_definition`
exist with their lineage constraints, the deferred composite pointer, the
`nomey_writer` role, `sec.request_actor_id()`, and RLS from birth. CI rebuilds
every migration from zero and runs the SQL checks.

**Scope, participant, membership and effect are migrated too.** `core.scope`,
`core.participant`, `core.membership` and `core.effect` exist with the helper
`sec.is_member(uuid)` of ADR-007, RLS from birth, the client read path of
ADR-013 §10 and the writer's `WITH CHECK` measured in E20. Four points worth
knowing before touching them:

- **An effect's currency is the base currency of its scope, structurally.** A
  composite FK `(scope_id, currency_definition_id) → scope (id,
base_currency_definition_id)` enforces it, and the same FK makes the base
  currency unchangeable once effects exist — invariant 12, as structure rather
  than as validation.
- **The three participants an effect names belong to the effect's own scope**,
  also by composite FK. That is what makes ADR-012 §1's "contextual" structural.
- **`core.membership` is current authorization, never history.** The row exists
  ⇔ the membership is active. If historical membership is ever needed it gets
  modelled deliberately; do not reinterpret this relation.
- **`scope.kind` is a closed vocabulary** — `personal | group | couple`. A fourth
  scope type requires a deliberate migration, unlike `operation_class`, which is
  open on purpose.

**The participant-account link and the presence periods are migrated too.**
`core.participant_user_link` and `core.participant_period` exist, with
`btree_gist` in the `extensions` schema. Keep three things straight — collapsing
any two of them is the mistake ADR-012 exists to prevent:

| Relation                     | Question it answers                        |
| ---------------------------- | ------------------------------------------ |
| `core.membership`            | What may an account see or do **now**?     |
| `core.participant_user_link` | Which account is that contextual identity? |
| `core.participant_period`    | **When** was that participant eligible?    |

- **Periods are `date`-grained**, with `[valid_from, valid_until)` semantics and
  a GiST exclusion on overlaps. The grain follows its only consumer: eligibility
  is evaluated against an operation's `effective_date`, which is a `date`.
  A period may end exactly when the next one starts.
- **Nobody can write either relation yet** — not the client, not the writer.
  That is deliberate: creating a link needs proof of authorization, whose
  mechanism belongs to F10, and opening or closing periods belongs to
  participant lifecycle commands that do not exist. They are empty and stay
  empty until their command arrives.
- **Neither is readable by the client either.** The link would reveal which
  global account is behind a contextual identity, and the open delegation about
  which effects are "mine" (see the handoff, §11 ter) is what should decide that
  surface.
- **`btree_gist`'s production preflight is still open.** Supabase's public docs
  do not enumerate it, so availability on a target project is measured, not
  assumed. The runbook carries the query to run before any real deploy.

**The contextual split and the frozen conversion are migrated too, and with
them the persisted-fact inventory of ADR-013 §1 is complete.** `core.split`,
`core.split_participant` and `core.frozen_conversion` exist. Everything that ADR
declares authoritative-persisted now has a home; what remains in 3.C is derived
surface and the write boundary, not new facts.

- **The frozen rate is stored as `(coefficient, scale)`, not `numeric`** —
  [ADR-015](docs/adr/ADR-015-frozen-rate-physical-representation.md), which
  supersedes exactly that prescription of ADR-003 §4 and nothing else. `12` is
  the maximum scale, **not a fixed one**: magnitude and precision trade off
  against each other.
- **The converted amount is not persisted.** It is reproducible from the
  original amount, the coefficient, the scale and the target currency's scale,
  with a single rounding at the end. It is also already resolved in the effects.
- **`split_participant.resolved_amount` is not the same fact as
  `effect.economic_amount`.** They coincide for a group expense and diverge in
  the couple's final split, where resolved shares become _balance_ effects in
  two different personal scopes. ADR-013 §1 persists both on purpose.
- **The `ordinal` is the tie-break input**, not decoration. Together with the
  payer it is what makes the spare cent land on the same person on a replay.
- **"Every split has at least one participant" is NOT structural.** A header
  with no payer and no rows is physically insertable; the invariant belongs to
  the authoritative boundary, like "the predecessor is exactly the previous
  version". Do not add a trigger to fake it, and do not claim the tables
  guarantee `1..n`.

**Version lineage is only partly structural, by design.** The composite FKs
guarantee the predecessor and the pointer belong to the same operation; that the
predecessor is _exactly_ the previously current version — and therefore the
absence of branching — is reserved to the authoritative boundary by ADR-011 §11.
Do not describe the lineage as "linear" on the strength of the constraints
alone.

**The canonical projection and economic attribution are migrated too, and with
them `api` finally has a real client surface.** `core.current_effect` is the
canonical projection of ADR-013 §9 — the only relation allowed to depend
directly on `core.effect`, enforced by a catalogue check. On top of it,
`api.personal_effect` and `api.claimed_dimension()` answer **who an amount
belongs to**, per [ADR-016](docs/adr/ADR-016-economic-attribution.md).

- **Attribution is per dimension, never per row.** Balance and participant-less
  economic belong to the **owner** of the personal scope; economic with a
  participant and both sides of a debt belong to whoever is **linked** to that
  participant, with debtor negative and creditor positive.
- **`core.scope.owner_user_id` is durable ownership, not membership.**
  `kind = 'personal' ⇔ owner_user_id IS NOT NULL` plus a unique index. Using
  membership as ownership would erase history the moment someone leaves.
- **`participant_period` never filters at read time.** It validates eligibility
  when writing, against `operation_version.effective_date`. Neither does
  `linked_at`: filtering by it would erase exactly the history a claim exists to
  recover.
- **`api.claimed_dimension()` deliberately crosses RLS.** It is `SECURITY
DEFINER` owned by `postgres`, takes no parameters, and filters by link **in
  its own body** — measured: inside a definer, the canonical projection is not a
  privacy boundary. Its column list _is_ the privacy boundary; widening it is a
  privacy decision. `FORCE ROW LEVEL SECURITY` on `core.effect` would break it.
- **The two attribution routes are disjoint by construction**, so nothing is
  double counted. The check verifies it rather than trusting it.
- **`src/types/database.ts` is generated over `api`**, never hand-written. Every
  monetary field comes out as `string`.

**The authoritative writer is complete.** Seven functions — `record_adjustment`,
`record_personal_expense`, `record_external_transfer`,
`record_internal_transfer`, `record_group_expense`, `record_debt_settlement` and
`record_settlement_by_transfer` — are the only way anything gets written. They
are `SECURITY DEFINER` **owned by `nomey_writer`** — the opposite of
`api.claimed_dimension()`, and deliberately so: a read boundary must cross RLS,
a write boundary must stay under it (E16). Do not unify them.

- **One public function per operation class**, per ADR-009 §1 — whose own
  examples share an accounting class, which is what proves `operation_class` is
  the _type_ of operation (ADR-013 §2), not the accounting class of ADR-002 §3.
  They are different vocabularies in different columns; the fixtures that
  conflated them were corrected.
- **Create and correct share a function**, distinguished by `operation_id` +
  `expected_version_id` in the payload and by `command_type` for idempotency.
- **Claim the idempotency key before the CAS** (ADR-011 §13), and authorize
  after the claim (ADR-010 §5). A replay never re-derives, re-authorizes or
  creates a version.
- **The only permitted exception handler is the claim's `unique_violation`.**
  Any other turns a failure into a partial write.
- **Cross-currency is refused**, with `CURRENCY_CONVERSION_UNSUPPORTED` (422),
  until the FX resolution rule exists. `core.frozen_conversion` therefore has
  no write route, and the writer has no `INSERT` on it.
- **Parity with `src/domain/` is the shared vectors, not shared code**
  (ADR-009 §1). `scripts/vectors-prelude.sh` pipes `tests/vectors/*.json` into
  the checks, because psql runs inside the container and cannot read the
  checkout. **22 of 22** split vectors and **19 of 20** scenarios are
  reproduced; the one left out needs FX and is refused, not faked.

**The three classes that touch debt follow ADR-013 §11**, and five things about
them are easy to get wrong later:

- **The scopes are locked before the operation row**, and before the debt is
  read. That order is what keeps the global lock ordering identical across all
  seven functions, so no cycle is possible.
- **A correction locks the union** of the new intention's scopes and the scopes
  that carried debt in the current version. A partial serialization serializes
  nothing.
- **The lock needs two things, and they fail differently.** Measured against the
  real stack: with no `UPDATE` privilege, `SELECT … FOR UPDATE` errors with
  `42501`; with the privilege but no `UPDATE` policy, it returns **zero rows
  without erroring**. `GRANT UPDATE (base_currency_definition_id)` plus a policy
  `USING (true) WITH CHECK (false)` grants exactly "may lock" and no write at
  all — a real `UPDATE`, even to the same value, is refused.
- **The payer's cash scope and both ends of a settlement-by-transfer are
  derived** from `core.participant_user_link`, never taken from the payload.
  There is no other datum with which to check that a personal scope is the
  payer's, and accepting one blindly would let any member post a false cash
  charge in someone else's Modo Personal.
- **A correction may not leave any debt with a negative pending balance** —
  debt 5000, already settled 4000, corrected down to 3000 is refused. It is the
  same invariant `data-model.md` §3 already fixed, checked at a different
  moment, so it reuses `SETTLEMENT_EXCEEDS_DEBT` instead of minting a code.
  Checked after the locks, on corrections only, and it covers dropping someone
  from the split. It refuses and nothing else: no reverse debt, no automatic
  offset, no reopening, no closing states.
- **Who may correct is current membership, and nothing else** — not when they
  joined, not who authored it, not whether they were in that expense.
  `core.membership` is presence, not history, so its `created_at` is not a
  joining date. `participant_period` is eligibility to appear in an operation,
  never authorization.

**Concurrency is proven with real simultaneous sessions**, not simulated:
`scripts/writer-debt-concurrency.sh`, which CI runs last because it writes
committed rows and removes them again. Removing the lock reproduces exactly the
`−1000` overpay E15 measured.

Consult `docs/README.md` before assuming anything about scope or roadmap.
