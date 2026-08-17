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

## Rules that matter most

These are the rules most likely to be violated by default. Breaking one of them
produces a bug that is silent, expensive, or both.

### 1. Money

- **Never use `float` for money.** Amounts are integers in the currency's
  minor unit.
- **Every amount carries its currency** (ISO 4217). There is no such thing as a
  bare amount. Nomey is multi-currency by design even while the UI shows one.
- **Decimal scale depends on the currency.** EUR has 2, JPY has 0. Never
  hardcode 2 decimals.
- **Remainder splitting is deterministic.** 100 between 3 is 33.33 / 33.33 /
  33.34, and which participant absorbs the extra minor unit follows a
  documented rule. If balances do not reconcile exactly, it is a bug.
- **Formatting is not domain logic.** `domain/` does arithmetic on
  `{ amountMinor, currency }`; `lib/format` turns that into a locale string.

### 2. Cash flow is not expense is not debt

A shared expense is **three distinct facts**, not one. If one person pays 120
for a dinner split 4 ways:

| Fact                     | Amount | Lives in                      |
| ------------------------ | ------ | ----------------------------- |
| Cash left their account  | −120   | `transactions`                |
| What they actually spent | −30    | their row in `expense_splits` |
| What they are owed       | +90    | derived from the other splits |

When the 90 comes back it is a `settlement`, **not income**: it cancels a debt.

> **Account balances are computed from `transactions`. Spending and income
> statistics are computed from `expense_splits`. Never the other way round.**

Summing `transactions` to report "you spent 480 this month" makes whoever pays
for dinners look reckless and whoever never pays look frugal. Both numbers are
wrong, neither throws an error.

### 3. Idempotency

Every transaction write carries a `client_id` (UUID) generated **on the
device**. Quick entry can fire from a widget with no network and be retried.
Without `client_id` the result is duplicate expenses in production with no
clean way to deduplicate afterwards.

### 4. Row Level Security

- **No table is created without its RLS policy in the same migration.** A table
  without RLS is a public table.
- **Client-side filters are never security.** `.eq('user_id', me)` is an
  optimisation; the attacker simply omits it.
- Group membership checks must go through a `SECURITY DEFINER` function with a
  fixed `search_path`, never a policy that queries the same table it protects
  (infinite recursion).
- Participants can exist **without a user account**. Splits and debts point at
  a participant, never directly at a user, so a later claim loses no history.
  Claiming a participant requires a **single-use invitation token** — never a
  name or email match, which is trivially exploitable.

### 5. Internationalisation

Spanish and English from the start. Even before an i18n library exists:

- **Never hardcode `€`** or any currency symbol.
- **Never hardcode Spanish date formats.**
- Keep user-facing strings out of logic and components; they must be
  extractable.
- Separate the monetary **value** from its **formatting**.

### 6. Secrets

- `EXPO_PUBLIC_*` variables are **inlined into the app bundle** and readable by
  anyone who downloads the binary. Fine for the Supabase URL and anon key.
- **The service role key must never reach the client, in any form.** It bypasses
  RLS entirely and would expose every user's financial data.
- Never commit `.env`.

### 7. Logging

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

**Dependency direction is one-way:** `app/ → features/ → domain/ + lib/ + ui/`.
Never the reverse, never feature → feature. Enforced by ESLint
(`no-restricted-imports`); a violation fails lint, it is not a style opinion.

Each directory has a `README.md` stating its constraints. Read it before adding
files there.

**Never create a generic `utils/`.** It becomes a dumping ground. Code belongs
in `domain/` (business rules), `lib/` (infrastructure) or `ui/` (presentation).

---

## Conventions

- **Node 22 LTS** (`>=22.13.0 <23`), pinned in `.nvmrc` and `engines`. React
  Native 0.86 declares `^20.19.4 || ^22.13.0 || ^24.3.0 || >= 25.0.0`; Nomey
  narrows that to the 22 LTS line to keep local, CI and EAS aligned.
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
  bundle weight, an upgrade liability and attack surface.
- Push or merge to `main` without being asked.

---

## Decisions live in ADRs

Architectural decisions are recorded in `docs/adr/` and are **immutable once
accepted**: superseding one means writing a new ADR, not editing the old.

Any change that contradicts an accepted ADR updates it **in the same PR**. Use
the `/adr` command to draft one.

---

## Current state

The project is at the end of **Phase 0** (repository foundation). There is no
Supabase connection, no schema, no auth and no business logic yet — that is
deliberate, not an oversight. The visible app is an intentionally blank screen.

Consult `docs/README.md` before assuming anything about scope or roadmap.
