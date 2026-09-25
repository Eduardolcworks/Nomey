import { splitEvenly, toMinorUnits, tooSmallToSplit } from '@/domain';
import { type AmountEntry, amountValue } from '@/ui/components/amount-entry';

/**
 * LA TRANSFERENCIA DE GRUPO, EN EL CLIENTE (F12/ADR-007, F12.C3).
 *
 * **Una voluntad y ya está.** Quien la registra declara «he transferido X a
 * estas personas del grupo», y el efecto ocurre al confirmar el servidor. No
 * hay propuesta, ni aceptación, ni rechazo, ni caducidad: nada que esperar.
 *
 * **Es una operación DEL GRUPO, no una transferencia entre cuentas.** El
 * receptor autoritativo es el PARTICIPANTE, así que un fantasma —alguien sin
 * cuenta Nomey— recibe como cualquiera. Por eso aquí no hay ni un identificador
 * de usuario, ni un `@handle`, ni nada que se parezca a una cuenta.
 *
 * Lo único que este módulo calcula es el álgebra del par, que es pura y por
 * tanto comprobable sin renderizar nada. Lo demás —el reparto, la
 * elegibilidad, la deuda— lo decide el servidor.
 */

/** Positivo: quien pregunta DEBE. Negativo: le deben. Cero: en paz. */
export type PairStanding = 'owing' | 'owed' | 'settled';

/**
 * EL VEREDICTO DE UN POSIBLE DESTINATARIO.
 *
 * Tres palabras y ninguna explica por qué. `unavailable` cubre a quien salió,
 * a quien fue retirado, a un origen de fusión y a quien no tiene presencia
 * vigente; distinguirlos en la lista contaría algo de esas personas cada vez
 * que alguien la abriera.
 */
export const TRANSFER_STATES = ['ready', 'self', 'unavailable'] as const;
export type TransferState = (typeof TRANSFER_STATES)[number];

/**
 * UN POSIBLE DESTINATARIO, con el mismo veredicto que aplica el writer.
 *
 * **Vienen en el ORDEN CANÓNICO DE REPARTO** —el de entrada al grupo— y ese
 * orden se conserva tal cual: es lo que hace que la unidad menor que sobra se
 * muestre en la misma persona que la recibirá.
 */
export type TransferCandidate = {
  readonly participantId: string;
  readonly displayName: string;
  readonly state: TransferState;
  /** El neto del actor hacia esa persona, con signo. Informativo. */
  readonly netMinor: string;
};

/** Los que de verdad se pueden elegir, en el orden en que vienen. */
export function transferableCandidates(
  rows: readonly TransferCandidate[],
): readonly TransferCandidate[] {
  return rows.filter((one) => one.state === 'ready');
}

/** Lo que una transferencia le dio a UNA persona. */
export type GroupTransferShare = {
  readonly ordinal: number;
  readonly receiverParticipantId: string;
  readonly receiverDisplayName: string;
  readonly isReceiver: boolean;
  readonly amountMinor: string;
};

/**
 * UNA TRANSFERENCIA REGISTRADA: una intención, una fila.
 *
 * `versionId` viaja porque anular lo necesita — la frontera pide
 * `(operation_id, expected_version_id)`, igual que para un gasto o un pago.
 */
export type GroupTransferOperation = {
  readonly operationId: string;
  readonly versionId: string;
  readonly scopeId: string;
  readonly senderParticipantId: string;
  readonly senderDisplayName: string;
  readonly isSender: boolean;
  readonly totalMinor: string;
  readonly currencyDefinitionId: string;
  readonly effectiveDate: string;
  readonly effectiveTime: string | null;
  readonly concept: string | null;
  readonly createdAt: string;
  /** El reparto, en orden de ordinal (= orden canónico). */
  readonly shares: readonly GroupTransferShare[];
};

/**
 * `D_after = D − N` (F12/ADR-003 §9).
 *
 * El importe se aplica COMPLETO: sin `min(N, deuda)`, sin partir en dos y sin
 * tope. Es lo que hace que transferir 30 sobre una deuda de 20 INVIERTA la
 * relación en vez de «saldar y sobrar 10». Todo en unidades menores exactas.
 */
export function netAfterTransfer(netMinor: string, amountMinor: string): string {
  return (BigInt(netMinor) - BigInt(amountMinor)).toString();
}

export function standingOf(netMinor: string): PairStanding {
  const net = BigInt(netMinor);
  if (net > 0n) return 'owing';
  if (net < 0n) return 'owed';
  return 'settled';
}

/** El importe sin signo: la dirección la dice la frase, nunca un signo. */
export function absoluteMinor(netMinor: string): string {
  const value = BigInt(netMinor);
  return (value < 0n ? -value : value).toString();
}

/**
 * ¿El importe supera una deuda QUE EXISTÍA?
 *
 * Sólo avisa cuando puede sorprender. Sin deuda previa, o con la deuda ya
 * invertida, cualquier importe la aumenta y el propio resultado lo dice; un
 * aviso ahí sería ruido.
 */
export function exceedsDebt(netMinor: string, amountMinor: string): boolean {
  const net = BigInt(netMinor);
  return net > 0n && BigInt(amountMinor) > net;
}

/**
 * ═══════════ QUÉ IMPIDE ENVIAR, Y EL REPARTO QUE SE VA A MANDAR ═══════════
 *
 * Una función pura, y no un encadenado de ternarios dentro del JSX, porque
 * **esta regla ya se rompió una vez en silencio**: la pantalla cerraba el paso
 * con `amountComplete`, que no significa «hay un importe» sino «los decimales
 * están TERMINADOS». Quien escribía `10` veía `10,00 €` —la cifra se pinta
 * con los céntimos completados— y el botón no se encendía nunca. Un fallo que
 * ninguna prueba podía ver mientras la condición viviera suelta en el render.
 *
 * **La regla, entera:**
 *
 *   · hay importe y es positivo;
 *   · hay al menos un destinatario marcado;
 *   · el importe alcanza para dar una unidad menor a cada uno.
 *
 * Y **nada más**. Ni cuenta, ni username, ni Modo Personal del receptor, ni
 * amistad, ni moneda de nadie: quién puede recibir lo decidió ya el servidor
 * al devolver la lista, y volver a juzgarlo aquí es exactamente lo que dejaba
 * fuera a un participante sin cuenta.
 *
 * El envío en vuelo NO entra aquí: es estado del comando, no de la intención,
 * y lo añade quien monta el botón.
 *
 * @param entry  lo que la persona lleva escrito en el teclado de importe
 * @param scale  la escala de la moneda del GRUPO (EUR 2, JPY 0)
 * @param count  cuántos destinatarios hay marcados
 */
export type TransferBlocker = 'amount' | 'recipients' | 'too-small';

export type TransferSubmission = {
  /** El total en unidades menores, o `null` si todavía no hay importe. */
  readonly totalMinor: bigint | null;
  /** El reparto, en el orden de la lista. `null` mientras algo lo impida. */
  readonly shares: readonly bigint[] | null;
  /** Lo primero que impide enviar, o `null` si nada lo impide. */
  readonly blocker: TransferBlocker | null;
};

export function transferSubmission(
  entry: AmountEntry,
  scale: number,
  count: number,
): TransferSubmission {
  /*
   * `toMinorUnits` ya rellena los decimales que falten —`10` con escala 2 son
   * 1000— y rehúsa lo que no es una cantidad. No hace falta exigir que los
   * céntimos estén tecleados, y exigirlo era el fallo.
   */
  const parsed = toMinorUnits(amountValue(entry), scale);
  const totalMinor = parsed === null || parsed <= 0n ? null : parsed;

  if (totalMinor === null) return { totalMinor: null, shares: null, blocker: 'amount' };
  if (count <= 0) return { totalMinor, shares: null, blocker: 'recipients' };
  if (tooSmallToSplit(totalMinor, count)) {
    return { totalMinor, shares: null, blocker: 'too-small' };
  }
  return { totalMinor, shares: splitEvenly(totalMinor, count), blocker: null };
}
