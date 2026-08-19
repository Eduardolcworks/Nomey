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
- **Every amount carries its currency** (ISO 4217). There is no such thing as a
  bare amount. Nomey is multi-currency by design even while the UI shows one.
- **Decimal scale depends on the currency.** EUR has 2, JPY has 0. Never
  hardcode 2 decimals.
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

**Proposed, not yet binding — [ADR-003](docs/adr/ADR-003-money-representation.md),
status `Propuesto`.** It proposes integer minor units (`bigint` / `BIGINT`) for
amounts, a separate exact decimal for exchange rates, and strings at every JSON
boundary. **Do not treat it as settled while it stays `Propuesto`**, and do not
implement against it without saying that is what you are doing.

**The verification requirement stands and is now that ADR's acceptance gate.**
The ADR must verify **empirically** how each numeric type survives the trip
through PostgREST to the client — not from documentation, which does not specify
it — and it does not move to `Aceptado` until that test runs against real
Supabase. Note that in TypeScript a plain `number` _is_ an IEEE-754 double,
exact only for integers up to 2^53, so "use an integer" is itself a choice with
limits rather than an escape from the question.

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

**Open (data-model ADR, Phase 1):** how these facts are represented — one table
or several, which are stored and which derived, and what any of them are
called. Do not treat any particular schema as settled, and do not invent one.

### 3. Idempotency

**Any monetary operation that can be retried must be idempotent.** Replaying it
must not produce a second record.

Quick entry can fire from a widget with no network and be retried, so this
starts as a client concern — but it is not only one. Recurring charges, imports,
backend-originated operations and future bank integrations all replay too, and
each needs an equivalent guarantee rather than the same mechanism.

Without this, the result is duplicate money in production with no clean way to
deduplicate afterwards.

**Open (ADR):** the mechanism per origin. For client-originated writes a stable
client-generated identifier (working name `client_id`) is the obvious
candidate; other sources may need something else. Names, types and where
uniqueness is enforced are ADR territory. The requirement is not.

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
  reviewed as a privilege boundary, because it bypasses RLS by design.
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

**Open (ADR):** how membership checks are actually performed. A `SECURITY
DEFINER` helper is one option; Supabase also documents restructuring the policy
to avoid the join, and JWT claims are a third. They differ on performance, on
escalation surface, and on **permission freshness** — with claims in the token,
removing someone from a group does not take effect until their token refreshes,
which is a product decision wearing technical clothes. Also open: whether to
expose a dedicated API schema instead of `public`.

### 5. Participants without an account

Three invariants, all decided:

- **A participant can exist without a user account.** Someone may be added to a
  group and take part in expenses before ever installing Nomey.
- **Linking a participant to a real user later loses no history** — no expense,
  share, debt or record of what happened before the link.
- **Claiming a participant requires proof of authorization.** A name match, or
  an unverified email match, is **not** proof.

**Open (ADR):** every mechanism.

- Whether the link is a nullable user reference on the participant, a separate
  link table, or something else. A nullable reference is the obvious shape, not
  the only one; a link table carries the history of the link itself, which
  matters for merges.
- Whether shares and debts reference the participant directly. That is the
  natural way to satisfy invariant 2 and a **strong candidate**, but stability
  across the link event can be achieved in more than one way.
- What constitutes proof: a single-use invitation token, a verified email
  invitation issued by an existing member, explicit approval by a member, or a
  combination. The invariant is the proof requirement, not the mechanism.
- Duplicate handling and participant-to-participant merges.

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
- Push or merge to `main` without being asked.

---

## Decisions live in ADRs

Architectural decisions are recorded in `docs/adr/` and are **immutable once
accepted**: superseding one means writing a new ADR, not editing the old.

Any change that contradicts an accepted ADR updates it **in the same PR**. Use
the `adr` skill to draft one.

---

## Current state

The project is in **Phase 2** (money representation). Phases 0 (repository
foundation) and 1 (accounting model) are closed: ADR-002 is accepted, and
`docs/architecture/data-model.md` and `docs/product/glossary.md` exist. Phase 2
analysis is complete and ADR-003 is drafted in `Propuesto`, gated on an
empirical check that needs Supabase.

There is still no Supabase connection, no schema, no auth and no business logic
— that is deliberate, not an oversight. The visible app is an intentionally
blank screen.

Consult `docs/README.md` before assuming anything about scope or roadmap.
