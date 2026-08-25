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

## Current state

The project is in **Phase 3** (persistence and data boundary), inside **3.C**.
Phases 0, 1 and 2 are closed, and so are **3.A** and **3.B**. **ADR-002 through
ADR-014 are accepted**; ADR-003 met its E11 gate against a real local Supabase
stack.

**What exists now.** A reproducible local Supabase stack (`supabase/config.toml`)
and ten reproducible probes that measured the decisions of this phase
(`supabase/e11/` … `supabase/e20/`, **none of them a migration**). A pure
reference implementation of the financial domain in `src/domain/`, with shared
test vectors in `tests/vectors/` and a Vitest suite — 110 tests. **The
authoritative server write boundary will have to reproduce those vectors
exactly** (ADR-002 §7).

**What does not exist yet.** No domain table, no RLS policy, no authoritative
writer, no auth and no screens — that is deliberate, not an oversight. The
visible app is still an intentionally blank screen, and the rest of the physical
model of 3.C still lives in ADRs.

**Migrations have started.** `supabase/migrations/` exists and holds the
**bootstrap of the data boundary** — the three schemas, explicit revokes and the
default-privilege sanitising — and nothing else: no table, no view, no function,
no application role. Rebuilding from zero is verified, and so is ADR-014: `api`
is served and `public`, `core` and `sec` answer `406 PGRST106`.

> `supabase/e11`–`e20` were disposable evidence over toy models and **must never
> become a migration**. `supabase/migrations/` is real versioned state.
> `supabase/checks/bootstrap.sql` validates it against the live catalogue.

**Next up inside 3.C:** the accounting relations, their RLS and the
authoritative writer. See `docs/architecture/phase-3c-handoff.md` §13 bis.

Consult `docs/README.md` before assuming anything about scope or roadmap.
