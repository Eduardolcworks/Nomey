/**
 * AN INCIDENT IS A TERMINAL QUEUE ENTRY, READ OUT LOUD.
 *
 * ADR-028 §15 settled where these live: **the queue's own terminal state is the
 * durable source**, with no second store, no counter and no badge on the list —
 * the bell is the only entrance. So this module stores nothing. It turns an
 * entry the worker already parked into the two things a person needs: a
 * sentence about their money, and the choices they have.
 *
 * ═══ THE RULE THAT GOVERNS EVERY STRING BELOW ═══
 *
 * §15 is explicit that §11's taxonomy is internal and never reaches the screen.
 * Not one of its words: no queue, no key, no intention, no entry, no terminal
 * state, no `client_operation_id`, no boundary code, no SQL. What a person sees
 * is their expense and what happened to it. The three internal states map onto
 * **two** visible forms and never a third.
 *
 * ═══ THE TWO FORMS ═══
 *
 *   ordinary     `rejected` — the server proved it wrote nothing
 *                «Gasto de 12,00 € en Restauración no realizado.
 *                  ¿Quieres volver a intentarlo?»        [ Sí ]  [ No ]
 *
 *   exceptional  `review` and `conflict` — repeating it cannot simply work
 *                                                   [ Revisar ]  [ Descartar ]
 *
 * The affirmative label is `Sí` and not `Reintentar`
 * ([ADR-029](../../../docs/adr/ADR-029-incident-labels-and-review-destination.md)):
 * the sentence already asks a question, so the buttons answer it, and
 * "retry" belonged to the vocabulary §15 forbids while describing something the
 * app does not do — nothing is retried, a new intention is created.
 *
 * **The exceptional form never offers `Sí`.** For `review` the operation might
 * exist, and a new key over an operation that might exist is duplicated money.
 */

import { newQueueEntry, type QueueEntry } from '@/lib/offline/queue-entry';
import type { MessageKey } from '@/lib/i18n';

/** What the person is offered. The two forms, and nothing else. */
export type IncidentForm = 'ordinary' | 'exceptional';

/**
 * Where `Revisar` goes, per ADR-029 §2. One visible label, two destinations,
 * because the risk is opposite and the distinction stays internal.
 */
export type ReviewDestination =
  /** `conflict`: the boundary refused before writing, so a fresh sheet is safe. */
  | 'sheet'
  /** `review`: it might exist, so the person looks first. No key can be minted. */
  | 'movements';

export type Incident = {
  /** The entry that IS this incident. Never shown, never spoken. */
  readonly clientOperationId: string;
  readonly actorId: string;
  readonly form: IncidentForm;
  /** `null` for the ordinary form, which offers no review. */
  readonly reviewDestination: ReviewDestination | null;
  /** Everything the sentence needs, already separated from how it is said. */
  readonly kind: 'expense' | 'income';
  /** Minor units, as text. Formatted by the caller with the shared formatter. */
  readonly amountMinor: string;
  readonly currencyCode: string;
  readonly currencyScale: number;
  /** `null` for an income, which has no category (ADR-027). Never invented. */
  readonly categoryId: string | null;
  /** What the person wrote. Carried so `Revisar` can prefill without asking again. */
  readonly concept: string | null;
  /** The declared date, which survives every route: it is not the queue's order. */
  readonly effectiveDate: string;
  /** For sorting: oldest first, so the queue's own order is what is read. */
  readonly createdAt: string;
};

/**
 * The sentence for each situation. Resolved by the caller against the catalogue.
 *
 * **Two visible forms, three sentences, and that is not a contradiction.** §15
 * fixes the FORM — which buttons, and never a third pair — because the two
 * exceptional cases ask the same thing of a person: look, and decide. What it
 * does not do is force one wording onto both, and forcing it would make the app
 * say something false: after a currency change the boundary refused BEFORE
 * writing, so "we couldn't confirm whether it was recorded" is simply untrue.
 *
 * Measured on the device: the conflict incident read as an unknown result, which
 * is the one thing that case is not.
 */
type Group = {
  readonly expense: MessageKey;
  readonly income: MessageKey;
  /**
   * The income sentence when a concept exists.
   *
   * Two incomes of the same amount are otherwise indistinguishable — an income
   * carries no category (ADR-027), so the concept is the only thing that says
   * WHICH one this was. It is the frozen concept of the entry, never rebuilt.
   */
  readonly incomeNamed: MessageKey;
};

export const INCIDENT_MESSAGE: {
  readonly ordinary: Group;
  readonly currencyMoved: Group;
  readonly unconfirmed: Group;
} = {
  ordinary: {
    expense: 'incident.expenseNotMade',
    income: 'incident.incomeNotMade',
    incomeNamed: 'incident.incomeNotMadeNamed',
  },
  currencyMoved: {
    expense: 'incident.expenseCurrencyMoved',
    income: 'incident.incomeCurrencyMoved',
    incomeNamed: 'incident.incomeCurrencyMovedNamed',
  },
  unconfirmed: {
    expense: 'incident.expenseUnconfirmed',
    income: 'incident.incomeUnconfirmed',
    incomeNamed: 'incident.incomeUnconfirmedNamed',
  },
};

/**
 * Which sentence this incident gets. The FORM stays one of two; the wording
 * follows what can honestly be said.
 */
export function incidentMessage(incident: Incident): MessageKey {
  const group =
    incident.form === 'ordinary'
      ? INCIDENT_MESSAGE.ordinary
      : incident.reviewDestination === 'sheet'
        ? INCIDENT_MESSAGE.currencyMoved
        : INCIDENT_MESSAGE.unconfirmed;

  if (incident.kind === 'expense') return group.expense;
  // An expense is told apart by its category; an income only by what was
  // written, so it gets the concept when there is one and no filler when not.
  return incident.concept === null ? group.income : group.incomeNamed;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The incident this entry is, or `null` if it is not one.
 *
 * Only a terminal entry is an incident. A transient failure or an ambiguous
 * answer is NOT one, and §15 puts that first because it is what gets confused:
 * without network, on a timeout, a 5xx, a 429 or a lost response the movement
 * stays projected, keeps its key and retries itself. Nothing is announced as
 * "not made" while its result is still unknown.
 */
export function incidentOf(entry: QueueEntry): Incident | null {
  const form: IncidentForm | null =
    entry.state === 'rejected'
      ? 'ordinary'
      : entry.state === 'review' || entry.state === 'conflict'
        ? 'exceptional'
        : null;
  if (form === null) return null;

  if (
    entry.commandType !== 'personal_expense.create' &&
    entry.commandType !== 'personal_income.create'
  ) {
    return null;
  }
  const kind = entry.commandType === 'personal_income.create' ? 'income' : 'expense';

  return {
    clientOperationId: entry.clientOperationId,
    actorId: entry.actorId,
    form,
    reviewDestination:
      form === 'ordinary' ? null : entry.state === 'conflict' ? 'sheet' : 'movements',
    kind,
    amountMinor: String(entry.payload.amount),
    currencyCode: entry.currency.code,
    currencyScale: entry.currency.scale,
    categoryId: kind === 'expense' ? text(entry.payload.category_id) : null,
    concept: text(entry.payload.concept),
    effectiveDate: String(entry.payload.effective_date),
    createdAt: entry.createdAt,
  };
}

/**
 * The incidents of these entries, oldest first.
 *
 * Deduplicated by construction: one entry is one incident, and the store keys
 * entries by `client_operation_id`, so no event, refresh or retry can produce a
 * second one for the same movement.
 */
export function incidentsOf(entries: readonly QueueEntry[]): Incident[] {
  return entries
    .map(incidentOf)
    .filter((incident): incident is Incident => incident !== null)
    .sort((a, b) =>
      a.createdAt === b.createdAt
        ? a.clientOperationId < b.clientOperationId
          ? -1
          : 1
        : a.createdAt < b.createdAt
          ? -1
          : 1,
    );
}

/**
 * THE REPLACEMENT A PRESS OF THE AFFIRMATIVE BUTTON CREATES.
 *
 * Everything economic is copied verbatim — amount, concept, kind, effective
 * date and time, category and monetary definition. Only the command's identity
 * changes, plus the state a freshly created entry has anyway. The key inside
 * the payload is rewritten too: the payload is what the boundary reads, and it
 * has to agree with the row.
 *
 * The creation instant is new because it is the FIFO position of a brand new intention,
 * never the effective date — that one lives inside the payload and is not
 * touched.
 *
 * Pure, and here rather than in the hook, so it can be exercised against a real
 * store without dragging React in.
 */
export function replacementFor(entry: QueueEntry, key: string, now: string): QueueEntry {
  return newQueueEntry({
    clientOperationId: key,
    actorId: entry.actorId,
    scopeId: entry.scopeId,
    commandType: entry.commandType,
    payload: { ...entry.payload, client_operation_id: key },
    currency: entry.currency,
    createdAt: now,
  });
}
