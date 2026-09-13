import type { TextColor } from '@/ui/theme';
import type { MessageKey } from '@/lib/i18n';

/**
 * LA POSICIÓN NETA DEL ACTOR EN UN GRUPO. Una sola cifra, con signo.
 *
 * ═══════════ QUÉ ES, Y QUÉ NO ES ═══════════
 *
 * La regla es exactamente una resta:
 *
 *     lo que los demás me deben  −  lo que yo debo a los demás
 *
 * De ahí que sea **una** posición y no dos columnas: la tarjeta no puede decir
 * «debes» y «te deben» a la vez, porque no son dos hechos sino los dos signos de
 * uno. El detalle por persona vive dentro del grupo, que es donde hay sitio para
 * decir a quién.
 *
 * **No entra ninguna deuda entre terceros.** Una deuda de Ana con Luis no toca
 * la posición de quien mira, y sumarla sería inventarle un saldo.
 *
 * ═══════════ CERO NO ES «NO SE SABE» ═══════════
 *
 * Misma distinción que `debt-display.ts` hace para Inicio, y por el mismo
 * motivo: «no debo nada» es un hecho sobre el dinero de alguien, «todavía no
 * tengo el dato» no lo es, y presentar el segundo como el primero afirma una
 * cifra contable que nadie ha derivado.
 *
 * Por eso hay dos estados y no uno con un cero por defecto.
 */
export type GroupPosition =
  /**
   * Se sabe. `minor` va **en unidad mínima de la divisa base del grupo** y con
   * signo, el mismo criterio que los efectos de deuda de `core`: positivo = te
   * deben, negativo = debes, cero = saldado.
   */
  | { readonly kind: 'net'; readonly minor: bigint }
  /**
   * El grupo tiene algo que este cliente no sabe interpretar.
   *
   * **No es «cargando» y no es cero.** Es la salida segura para una versión
   * futura del ledger cuyos importes esta app no entienda: antes que afirmar
   * «Saldado» sobre un grupo que puede tener movimientos, no se afirma nada.
   */
  | { readonly kind: 'unavailable' };

const UNAVAILABLE: GroupPosition = { kind: 'unavailable' };

/*
 * ══════════ AQUÍ VIVÍA `GROUP_DEBT_AMOUNTS`, Y SE HA RETIRADO ══════════
 *
 * Decía que un grupo no podía tener deudas todavía, y lo argumentaba: no había
 * ruta de cliente a `record_group_expense` ni a las liquidaciones. El
 * razonamiento era correcto **el día que se escribió**, y esa es justamente la
 * trampa de una constante que describe el estado del producto.
 *
 * F9 abrió esa ruta. Desde entonces cada tarjeta afirmaba «Saldado · 0,00»
 * sobre grupos con deuda viva, y lo hacía con la misma confianza con la que
 * antes decía la verdad: la ausencia había dejado de ser comprobable, pero el
 * código seguía comprobándola contra sí mismo.
 *
 * Lo que la sustituye no es otra constante sino una lectura —`net_position` de
 * `api.group_summary`— y el contrato de tres respuestas que ya estaba aquí
 * abajo: sin lectura, no disponible; con lectura y sin fila, cero de verdad.
 */

/**
 * Resuelve la posición a partir de los importes de deuda del actor en el grupo.
 *
 * `null` es «no interpretable» y no cero: es lo que devolvería una lectura que
 * el cliente no supo leer. Una colección **vacía** sí es cero de verdad, que es
 * la diferencia entre este contrato y un valor por defecto.
 *
 * Y si UNO solo de los importes es ilegible, toda la posición es no disponible:
 * una cifra que no se puede defender no se convierte en el resto de la suma.
 */
export function groupPosition(amounts: readonly string[] | null | undefined): GroupPosition {
  if (amounts === null || amounts === undefined) return UNAVAILABLE;

  let total = 0n;
  for (const amount of amounts) {
    /*
     * `BigInt('')` y `BigInt('   ')` devuelven `0n` SIN lanzar: es «no hay dato»
     * colapsando a cero por otra puerta. Se descarta antes de convertir.
     */
    if (typeof amount !== 'string' || amount.trim() === '') return UNAVAILABLE;
    try {
      total += BigInt(amount);
    } catch {
      return UNAVAILABLE;
    }
  }

  return { kind: 'net', minor: total };
}

/** Los tres estados que la tarjeta nombra, más el seguro. */
export type PositionState = 'owed' | 'owing' | 'settled' | 'unavailable';

export function positionState(position: GroupPosition): PositionState {
  if (position.kind === 'unavailable') return 'unavailable';
  if (position.minor > 0n) return 'owed';
  if (position.minor < 0n) return 'owing';
  return 'settled';
}

/**
 * EL COLOR DE CADA ESTADO. **Rojo si debes, verde si te deben, blanco si estás
 * en paz** — el mismo criterio que Inicio aplica a su bloque de Deudas.
 *
 * Está escrito aquí y no importado porque `features/` no importa `features/`, y
 * la regla es de tres líneas. Lo que impide que se separen no es el préstamo del
 * código sino una prueba que fija los tres tonos en los dos sitios.
 *
 * **Y el color nunca va solo**: la cifra lleva encima su etiqueta —«Debes»,
 * «Te deben», «Saldado»— y su signo, que es lo que exige `design-direction.md`
 * §8 para que el estado no dependa de distinguir dos tonos.
 */
export function positionTone(state: PositionState): TextColor {
  switch (state) {
    case 'owed':
      return 'positive';
    case 'owing':
      return 'negative';
    case 'settled':
      return 'text';
    case 'unavailable':
      return 'textDisabled';
  }
}

/** Cómo se llama cada estado en el catálogo. */
export function positionLabel(state: PositionState): MessageKey {
  switch (state) {
    case 'owed':
      return 'group.owedToYou';
    case 'owing':
      return 'group.youOwe';
    case 'settled':
      return 'group.settled';
    case 'unavailable':
      return 'group.positionUnknown';
  }
}

/**
 * EL IMPORTE QUE SE ENSEÑA, siempre sin signo.
 *
 * Quien dice la dirección es la etiqueta, no un menos delante de la cifra.
 * «Debes −12,00 €» son dos negaciones que se leen mal; «Debes 12,00 €» es lo que
 * alguien diría en voz alta.
 */
export function positionAmount(position: GroupPosition): bigint | null {
  if (position.kind === 'unavailable') return null;
  return position.minor < 0n ? -position.minor : position.minor;
}
