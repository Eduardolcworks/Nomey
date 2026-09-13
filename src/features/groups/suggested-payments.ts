import type { ParticipantPresence } from './participant-presence';

/**
 * «PAGOS SUGERIDOS»: una propuesta para saldar el grupo. Pura, en unidades
 * menores y sobre UNA definición monetaria.
 *
 * ═══════════ QUÉ ES, Y QUÉ NO ═══════════
 *
 * Es una PROPUESTA de presentación: no se registra, no se envía al servidor,
 * no marca ninguna deuda como saldada y no toca ningún efecto. Por eso vive en
 * la feature y no en `domain/`: F01/ADR-001 no fija ningún algoritmo normativo de
 * minimización, y `src/domain/README.md` lo deja escrito a propósito. Poner
 * aquí una heurística no lo cambia; convertirla en un comando que registre
 * estos pagos sí exigiría decidirlo (los pares reales de deuda son otra cosa:
 * `api.group_pending_pair`, y una sugerencia puede conectar a dos personas sin
 * deuda directa entre ellas).
 *
 * ═══════════ DOS ALGORITMOS, Y CUÁL SE USA ═══════════
 *
 * Se elige por el número de personas CON SALDO distinto de cero, nunca por
 * miembros totales: quien está a cero no participa en ningún pago.
 *
 * **Hasta `EXACT_LIMIT` (14): el mínimo exacto.** El mínimo de pagos para
 * saldar n posiciones que suman cero es `n − k`, con k el máximo número de
 * grupos disjuntos que suman cero cada uno (cada grupo se salda por dentro con
 * `tamaño − 1` pagos). k se calcula por programación dinámica sobre máscaras
 * de bits: `best[m] = [suma(m) == 0] + max_{i ∈ m} best[m sin i]`. Cada
 * máscara se resuelve una vez a partir de sus n submáscaras inmediatas, así que
 * el coste es **O(n · 2^n)** en tiempo y **O(2^n)** en memoria — enumerar
 * subconjuntos no bastaría por sí solo; lo que lo hace tratable es que la
 * recurrencia sólo mira n vecinos por máscara. Con n = 14 son 16 384 máscaras
 * y ≈ 230 000 pasos; la medida real está en la prueba de rendimiento, no aquí.
 * Las sumas son ENTERAS de principio a fin, en un `BigInt64Array`: ningún
 * importe pasa por un número en coma flotante (AGENTS.md §1, F02/ADR-001). La
 * única cota es la del propio entero de 64 bits —la de `BIGINT` en la base—,
 * comprobada en `bigint` antes de escribir nada: si la suma de magnitudes no
 * cabe, se cae al voraz en vez de truncar.
 * La reconstrucción sigue la cadena de mejores elecciones y corta un grupo cada
 * vez que la máscara restante suma cero; cada grupo se salda con el voraz, que
 * sobre un grupo de suma cero produce exactamente `tamaño − 1` pagos.
 *
 * **Por encima: el voraz.** Quien MÁS debe paga a quien MÁS se le debe el
 * menor de los dos importes, y al menos uno queda a cero: como mucho `n − 1`
 * pagos. **No garantiza el mínimo** —contraejemplo: deudores 8, 7 y 5 frente a
 * acreedores 12 y 8 dan 4 pagos, y el mínimo son 3 (8→8, 7→12, 5→12)— y por
 * eso la pantalla no lo promete cuando es el voraz el que habla.
 *
 * ═══════════ LO QUE LOS DOS GARANTIZAN ═══════════
 *
 * - **Conservación exacta**: lo que cada persona paga o recibe, sumado, es
 *   exactamente su posición neta. Entero sobre entero; no hay redondeo.
 * - **Ningún pago a uno mismo, en cero o negativo**: deudores y acreedores
 *   son conjuntos disjuntos y cada pago es `min` de dos positivos.
 * - **Determinismo**: las posiciones se ordenan primero de forma canónica
 *   (magnitud descendente, identidad ascendente) y los empates de la
 *   programación dinámica se rompen por el índice más bajo, así que el orden
 *   de llegada de los saldos no cambia la propuesta.
 *
 * ═══════════ LOS INACTIVOS, Y LOS PARES REABIERTOS ═══════════
 *
 * Quien salió del grupo no se propone como pagador ni como cobrador «como si
 * siguiera activo», y tampoco se le excluye en silencio recalculando el resto:
 * quitarlo cambiaría la propuesta de los demás sin decirlo. **Con una
 * excepción, que no calcula esta pieza:** los pares que una anulación reabrió
 * con quien salió los publica el servidor (`api.group_reopened_pair`) y aquí
 * entran como propuestas fijas, marcadas `reopened`; sus importes se
 * descuentan de las posiciones antes de que el algoritmo mire el resto. Si
 * tras eso alguien inactivo sigue con saldo, no hay propuesta y se dice quién.
 */
export type SuggestedPayment = {
  readonly from: string;
  readonly to: string;
  /** Unidades menores, estrictamente positivas. */
  readonly minor: bigint;
  /**
   * Un par REABIERTO con alguien que salió (F09/ADR-007 C6, excepción 2): no lo
   * calculó el algoritmo, lo publicó el servidor (`api.group_reopened_pair`)
   * como lo único que se puede saldar con esa persona, y sólo la parte activa
   * puede registrarlo. Ausente en las propuestas ordinarias.
   */
  readonly reopened?: true;
};

/** Un par reabierto tal como lo publica el servidor: deudor, acreedor, tope. */
export type ReopenedPair = {
  readonly debtorParticipantId: string;
  readonly creditorParticipantId: string;
  /** Unidades menores, en texto, siempre > 0. */
  readonly amountMinor: string;
};

export type Position = {
  readonly participantId: string;
  /** Unidades menores, con signo: negativo debe, positivo se le debe. */
  readonly minor: bigint;
};

/** Hasta cuántas personas con saldo se calcula el mínimo exacto. */
export const EXACT_LIMIT = 14;

/** Lo que cabe en un entero de 64 bits con signo: la cota de `BigInt64Array` y de `BIGINT`. */
const INT64_MAX = 2n ** 63n - 1n;

export type Proposal = {
  readonly payments: readonly SuggestedPayment[];
  /** Si el número de pagos es el mínimo demostrado, o sólo una propuesta. */
  readonly exact: boolean;
};

/** El resultado, ya interpretado para la pantalla. */
export type Suggestion =
  | { readonly kind: 'settled' }
  | {
      readonly kind: 'ready';
      readonly payments: readonly SuggestedPayment[];
      readonly exact: boolean;
    }
  /** Alguien inactivo tiene saldo pendiente: no se propone, y se dice quién. */
  | { readonly kind: 'inactive'; readonly participantIds: readonly string[] }
  /** Los saldos no cuadran o faltan datos: no se inventa ninguna compensación. */
  | { readonly kind: 'unavailable' };

/**
 * La propuesta sobre posiciones que SUMAN CERO: exacta hasta `EXACT_LIMIT`
 * personas con saldo, voraz por encima. Lanza si no suman cero, porque una
 * propuesta sobre saldos que no cuadran no es una propuesta.
 */
export function proposePayments(positions: readonly Position[]): Proposal {
  const pending = canonical(positions);
  if (pending.length <= EXACT_LIMIT) {
    const exact = optimalPayments(pending);
    if (exact !== null) return { payments: exact, exact: true };
  }
  return { payments: greedyPayments(pending), exact: false };
}

/**
 * EL VORAZ. Sobre posiciones que suman cero; como mucho `n − 1` pagos.
 */
export function greedyPayments(positions: readonly Position[]): readonly SuggestedPayment[] {
  const pending = canonical(positions);

  let debtors = pending
    .filter((one) => one.minor < 0n)
    .map((one) => ({ id: one.participantId, left: -one.minor }));
  let creditors = pending
    .filter((one) => one.minor > 0n)
    .map((one) => ({ id: one.participantId, left: one.minor }));

  const payments: SuggestedPayment[] = [];
  while (debtors.length > 0 && creditors.length > 0) {
    debtors = debtors.sort(byLeftThenId);
    creditors = creditors.sort(byLeftThenId);
    const debtor = debtors[0] as { id: string; left: bigint };
    const creditor = creditors[0] as { id: string; left: bigint };

    const amount = debtor.left < creditor.left ? debtor.left : creditor.left;
    payments.push({ from: debtor.id, to: creditor.id, minor: amount });

    debtor.left -= amount;
    creditor.left -= amount;
    debtors = debtors.filter((one) => one.left > 0n);
    creditors = creditors.filter((one) => one.left > 0n);
  }

  return payments;
}

/**
 * EL MÍNIMO EXACTO, o `null` si las sumas no caben en un entero de 64 bits
 * (más de 2^63 − 1 unidades menores de magnitud total: cada saldo ya es un
 * `BIGINT` en la base, y catorce sumados podrían en teoría desbordarlo; si
 * ocurriera se cae al voraz, que no tiene cota, en vez de truncar).
 *
 * **Sin coma flotante.** Toda suma parcial es un entero de magnitud menor o
 * igual que la suma de magnitudes, así que si ésta cabe en 64 bits, cabe cada
 * una: la cota se calcula en `bigint` ANTES de que ningún valor entre en el
 * array, y dentro del array sólo hay `bigint`.
 *
 * Sobre posiciones que suman cero; los ceros se apartan y el orden se
 * canoniza aquí mismo, así que llamarla directamente da lo mismo que pasar por
 * `proposePayments`.
 */
export function optimalPayments(input: readonly Position[]): readonly SuggestedPayment[] | null {
  const positions = canonical(input);
  const n = positions.length;
  if (n === 0) return [];
  if (n > EXACT_LIMIT) return null;

  let magnitude = 0n;
  for (const one of positions) magnitude += one.minor < 0n ? -one.minor : one.minor;
  if (magnitude > INT64_MAX) return null;

  const size = 1 << n;
  const value = positions.map((one) => one.minor);

  // suma[m]: la suma de las posiciones de la máscara; best[m]: cuántos grupos
  // de suma cero caben como mucho en una partición de la máscara; pick[m]: qué
  // elemento se quitó para llegar a best[m] (el índice más bajo entre empates).
  const sum = new BigInt64Array(size);
  const best = new Uint8Array(size);
  const pick = new Int8Array(size);
  for (let mask = 1; mask < size; mask += 1) {
    const low = mask & -mask;
    const index = 31 - Math.clz32(low);
    sum[mask] = (sum[mask ^ low] as bigint) + (value[index] as bigint);

    let top = -1;
    let chosen = -1;
    for (let i = 0; i < n; i += 1) {
      if ((mask & (1 << i)) === 0) continue;
      const candidate = best[mask ^ (1 << i)] as number;
      if (candidate > top) {
        top = candidate;
        chosen = i;
      }
    }
    best[mask] = top + (sum[mask] === 0n ? 1 : 0);
    pick[mask] = chosen;
  }

  // Reconstrucción: se sigue la cadena de elecciones y se corta un grupo cada
  // vez que lo que queda suma cero. La máscara completa suma cero, así que el
  // primer grupo empieza ahí; cada grupo cerrado suma cero por construcción.
  const groups: Position[][] = [];
  let current: Position[] = [];
  let mask = size - 1;
  while (mask !== 0) {
    if (sum[mask] === 0n && current.length > 0) {
      groups.push(current);
      current = [];
    }
    const index = pick[mask] as number;
    current.push(positions[index] as Position);
    mask ^= 1 << index;
  }
  if (current.length > 0) groups.push(current);

  // Cada grupo suma cero: el voraz lo salda con exactamente `tamaño − 1` pagos.
  return groups.flatMap((group) => greedyPayments(group));
}

/**
 * Las posiciones sin ceros y en orden canónico —magnitud descendente,
 * identidad ascendente—, comprobando que suman cero. Es lo que hace que el
 * orden de llegada no cambie la propuesta.
 */
function canonical(positions: readonly Position[]): Position[] {
  let sum = 0n;
  for (const one of positions) sum += one.minor;
  if (sum !== 0n) {
    throw new Error(`SUGGESTION_UNBALANCED: las posiciones suman ${sum.toString()}`);
  }
  return positions
    .filter((one) => one.minor !== 0n)
    .sort((a, b) => {
      const ma = a.minor < 0n ? -a.minor : a.minor;
      const mb = b.minor < 0n ? -b.minor : b.minor;
      if (ma !== mb) return ma > mb ? -1 : 1;
      return a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0;
    });
}

function byLeftThenId(a: { id: string; left: bigint }, b: { id: string; left: bigint }): number {
  if (a.left !== b.left) return a.left > b.left ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * La propuesta para la pantalla, con lo que la pantalla sabe: los saldos tal
 * como los publica el servidor (texto, con signo) y la presencia de cada uno.
 */
export function suggestionOf(
  balances: readonly { readonly participantId: string; readonly netMinor: string }[],
  presenceOf: (participantId: string) => ParticipantPresence | null,
  reopened: readonly ReopenedPair[] = [],
): Suggestion {
  const positions: Position[] = [];
  for (const row of balances) {
    const minor = parseMinor(row.netMinor);
    if (minor === null) return { kind: 'unavailable' };
    positions.push({ participantId: row.participantId, minor });
  }

  /*
   * LOS PARES REABIERTOS, PRIMERO. Cada uno es una propuesta fija —deudor paga
   * al acreedor el tope publicado— y se descuenta de las dos posiciones para
   * que el algoritmo no lo vuelva a proponer ni cuente al inactivo por ello.
   * Un par ilegible invalida la propuesta entera: nada se inventa.
   */
  const fixed: SuggestedPayment[] = [];
  const adjusted = new Map(positions.map((one) => [one.participantId, one.minor]));
  for (const pair of reopened) {
    const minor = parseMinor(pair.amountMinor);
    if (minor === null || minor <= 0n) return { kind: 'unavailable' };
    if (!adjusted.has(pair.debtorParticipantId) || !adjusted.has(pair.creditorParticipantId)) {
      return { kind: 'unavailable' };
    }
    fixed.push({
      from: pair.debtorParticipantId,
      to: pair.creditorParticipantId,
      minor,
      reopened: true,
    });
    adjusted.set(pair.debtorParticipantId, (adjusted.get(pair.debtorParticipantId) ?? 0n) + minor);
    adjusted.set(
      pair.creditorParticipantId,
      (adjusted.get(pair.creditorParticipantId) ?? 0n) - minor,
    );
  }
  const remaining: Position[] = positions.map((one) => ({
    participantId: one.participantId,
    minor: adjusted.get(one.participantId) ?? one.minor,
  }));

  const pending = remaining.filter((one) => one.minor !== 0n);
  if (pending.length === 0) {
    return fixed.length === 0
      ? { kind: 'settled' }
      : { kind: 'ready', payments: fixed, exact: true };
  }

  // Quien salió con saldo pendiente bloquea la propuesta entera, y se nombra.
  const inactive = pending
    .filter((one) => {
      const presence = presenceOf(one.participantId);
      return presence !== null && !presence.isActive;
    })
    .map((one) => one.participantId);
  if (inactive.length > 0) return { kind: 'inactive', participantIds: inactive };

  try {
    const proposal = proposePayments(remaining);
    return { kind: 'ready', payments: [...fixed, ...proposal.payments], exact: proposal.exact };
  } catch {
    return { kind: 'unavailable' };
  }
}

const SIGNED_INTEGER = /^-?[0-9]+$/;

function parseMinor(text: string): bigint | null {
  return SIGNED_INTEGER.test(text) ? BigInt(text) : null;
}
