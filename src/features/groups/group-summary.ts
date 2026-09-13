import type { GroupPosition } from './group-position';

/**
 * LAS TRES CIFRAS DE LA CABECERA DE UN GRUPO, y qué significa cada una.
 *
 * Son tres preguntas distintas sobre el mismo grupo, y confundir dos de ellas
 * es exactamente el defecto que `AGENTS.md` §2 existe para impedir: movimiento
 * de caja, gasto económico y deuda no se sustituyen entre sí.
 *
 *   ┌────────────────┬──────────────────────────────────────────────────────┐
 *   │ Posición       │ lo que me deben − lo que debo. Con signo.             │
 *   │ Tú gastaste    │ la suma de MIS PARTES de los gastos. Nunca lo que     │
 *   │                │ adelanté como pagador, ni lo que transferí, ni la     │
 *   │                │ posición neta.                                       │
 *   │ Total          │ la suma de los gastos REALES del grupo.               │
 *   └────────────────┴──────────────────────────────────────────────────────┘
 *
 * El ejemplo que las separa: pago 100 para cuatro a partes iguales. He pagado
 * 100, `Tú gastaste` son 25, el `Total` son 100 y mi posición es +75. Cuatro
 * números distintos del mismo hecho.
 *
 * **El `Total` no incluye liquidaciones ni devoluciones.** Una liquidación
 * cancela una deuda, no crea gasto — `AGENTS.md` §2 lo dice de la otra punta:
 * cobrar lo que te deben no es ingreso. Sumarla inflaría el total del viaje con
 * dinero que ya estaba contado. Tampoco entran las operaciones anuladas, cuyo
 * criterio fija el modelo de versiones: cuenta la versión vigente, y una
 * anulación es una versión sin efectos.
 */

/**
 * Una magnitud del grupo, o la imposibilidad de afirmarla.
 *
 * Sin signo por definición: `Tú gastaste` y `Total` son cuantías, no posiciones.
 * La única cifra con dirección es la posición, que tiene su propio tipo.
 */
export type GroupAmount =
  /** En unidad mínima de la divisa base del grupo. */
  | { readonly kind: 'amount'; readonly minor: bigint }
  /**
   * Hay algo que este cliente no sabe interpretar.
   *
   * **No es cero y no es «cargando».** Es la salida segura ante una versión
   * futura del ledger cuyos importes esta app no entienda: antes que afirmar que
   * el total es cero sobre un grupo que puede tener gastos, no se afirma nada.
   */
  | { readonly kind: 'unavailable' };

const UNAVAILABLE: GroupAmount = { kind: 'unavailable' };

/**
 * MIS PARTES DE LOS GASTOS DEL GRUPO: ninguna hoy, y por estructura.
 *
 * Misma ausencia comprobable que `GROUP_DEBT_AMOUNTS`: una parte sólo nace de
 * `record_group_expense`, esa función deriva las puntas de
 * `core.participant_user_link`, ese vínculo sólo existe para quien creó el
 * grupo, y esta fase no tiene ninguna ruta de cliente hacia ella. La colección
 * está vacía porque **no hay gastos**, no porque falte el dato.
 */
export const GROUP_EXPENSE_SHARES: readonly string[] = [];

/** Y los gastos del grupo, por el mismo motivo y con la misma prueba. */
export const GROUP_EXPENSE_TOTALS: readonly string[] = [];

/**
 * Suma una colección de importes exactos, o dice que no puede.
 *
 * Vacía es **cero de verdad**: la ausencia es real y afirmarla es correcto. Un
 * `null` es no interpretable. Y si UNO solo de los importes es ilegible, toda
 * la cifra lo es: un sumando que no se puede defender no se convierte en el
 * resto de la suma.
 */
export function groupAmount(amounts: readonly string[] | null | undefined): GroupAmount {
  if (amounts === null || amounts === undefined) return UNAVAILABLE;

  let total = 0n;
  for (const amount of amounts) {
    /*
     * `BigInt('')` y `BigInt('   ')` devuelven `0n` SIN lanzar: es «no hay
     * dato» colapsando a cero por otra puerta. Se descarta antes de convertir.
     */
    if (typeof amount !== 'string' || amount.trim() === '') return UNAVAILABLE;
    try {
      total += BigInt(amount);
    } catch {
      return UNAVAILABLE;
    }
  }

  return { kind: 'amount', minor: total };
}

/** Las tres cifras juntas, tal y como las consume la tarjeta. */
export type GroupSummary = {
  readonly position: GroupPosition;
  readonly youSpent: GroupAmount;
  readonly total: GroupAmount;
};

/**
 * Compone el resumen a partir de lo que hay.
 *
 * La posición llega ya resuelta desde la proyección —es la misma que pinta la
 * tarjeta de la lista, y no se recalcula aquí para que no puedan discrepar—; las
 * otras dos salen de sus colecciones. **Cuando llegue el motor de gastos, lo
 * único que cambia es quién pasa esas colecciones.**
 */
export function groupSummary(
  position: GroupPosition,
  shares: readonly string[] | null = GROUP_EXPENSE_SHARES,
  totals: readonly string[] | null = GROUP_EXPENSE_TOTALS,
): GroupSummary {
  return {
    position,
    youSpent: groupAmount(shares),
    total: groupAmount(totals),
  };
}

/**
 * UN MOVIMIENTO DEL GRUPO, tal y como lo pintará la lista.
 *
 * **Declarado y sin implementar, a propósito.** El modelo del gasto compartido
 * es de la tanda siguiente y no se inventa aquí; lo que este tipo fija es la
 * forma mínima que la lista necesita para existir sin rehacerse: qué se compró,
 * quién puso el dinero, cuánto y cuándo.
 *
 * `amountMinor` es el importe del gasto en unidad mínima de la divisa base del
 * grupo — **no** la parte de quien mira, que es otra cifra y tiene otro sitio.
 */
export type GroupMovement = {
  /** La operación, para abrir su detalle. Estable a través de correcciones. */
  readonly operationId: string;
  readonly concept: string;
  /** Quién puso el dinero, por su nombre en el grupo. */
  readonly payerName: string;
  readonly amountMinor: bigint;
  /** `YYYY-MM-DD`, la fecha de efecto de la versión vigente. */
  readonly effectiveDate: string;
};

/** Los movimientos que un grupo tiene hoy: ninguno, y por la misma estructura. */
export const GROUP_MOVEMENTS: readonly GroupMovement[] = [];

/*
 * ═══════════ AQUÍ VIVÍA EL MARCADOR DE SALDOS, Y SE HA RETIRADO ═══════════
 *
 * `GroupBalanceRow` y `GROUP_BALANCES` declaraban la forma de una deuda y una
 * colección vacía «por estructura», mientras nada sabía derivarlas. Ya no es
 * cierto: `api.group_balance` publica la posición neta de cada participante
 * sobre los efectos vigentes, y el tipo que la lista consume vive en
 * `group-service.ts` con el resto de lo que llega del servidor.
 *
 * Se retira en vez de quedarse al lado: dos formas de responder «cuánto debe
 * cada uno» son dos verdades que pueden discrepar.
 */
