import {
  allocateByLargestRemainder,
  type CurrencyDefinition,
  money,
  participantId,
  type Share,
  type SplitMethod,
  splitExpense,
  fromMinorUnits,
  toMinorUnits,
} from '@/domain';
import type { CalendarDate } from '@/lib/format';
import { type AmountEntry, EMPTY_AMOUNT } from '@/ui/components/amount-entry';

import { activeByDefault, eligibleOn } from './participant-presence';
import type { GroupParticipant } from './participant-service';

/**
 * EL REPARTO DE UN GASTO COMPARTIDO, sin una sola vista por medio.
 *
 * Todo lo que decide cuánto le toca a cada quien vive aquí y es puro: se puede
 * probar con vectores en EUR, JPY y BHD sin montar una pantalla, y la pantalla
 * no puede llegar a una cuota distinta de la que esta función calcula.
 *
 * **La aritmética NO se escribe aquí.** El reparto lo hace `splitExpense`, de
 * `domain/split`, que es la implementación de referencia de F01/ADR-001 §5 con su
 * regla determinista de restos: mayor resto primero y, a igualdad, el pagador
 * antes que el resto en el orden estable guardado con la operación. Reescribirla
 * en el cliente sería una segunda autoridad contable con las mismas fórmulas y
 * distinta forma de fallar. Lo que este módulo hace es **decidir cuándo se le
 * puede llamar**: `splitExpense` lanza ante una entrada inválida, y una
 * excepción durante un render no es una forma de decir «faltan tres partes».
 *
 * ═══════════ NADA SE COMPLETA NI SE NORMALIZA EN SILENCIO ═══════════
 *
 * Un importe vacío no vale cero, unas partes a medio escribir no valen uno y
 * unos importes exactos que no suman el total no se ajustan por su cuenta. En
 * cualquiera de esos casos las cuotas salen `null` —que la pantalla pinta como
 * pendiente— y `Guardar` se queda apagado con el motivo escrito. `null` no es
 * cero: cero es una cuota calculada que existe, y las hay (0,01 € entre tres da
 * una de 0,01 y dos de 0).
 */

/**
 * QUÉ SE ESTÁ REGISTRANDO EN EL GRUPO, y por qué son exactamente dos.
 *
 * `transfer` es un PAGO ENTRE PARTICIPANTES para saldar lo que uno debe a otro:
 * reduce esa deuda por el importe pagado y nada más. No fija el saldo a cero, no
 * borra gastos y no cierra el grupo; un pago parcial deja el resto pendiente.
 *
 * **Y no es la transferencia del Modo Personal.** Aquélla mueve dinero entre
 * ámbitos de una misma persona (`record_internal_transfer`,
 * `record_external_transfer`); ésta cancela una deuda entre dos participantes de
 * un grupo, que es otra operación con otro contrato —`record_debt_settlement` y
 * `record_settlement_by_transfer`— y otros campos. Compartir el nombre no las
 * hace la misma cosa, y reutilizar una por la otra sería exactamente el error
 * que AGENTS.md §2 previene: una liquidación NO es un ingreso ni un gasto.
 *
 * **Sin `income`.** Un grupo no tiene ingresos: lo que vuelve al bolsillo cuando
 * te devuelven dinero cancela una deuda, no engorda lo ganado.
 */
export type GroupKind = 'expense' | 'transfer';

export const GROUP_KINDS: readonly GroupKind[] = ['expense', 'transfer'];

/** Cómo se reparte. Es el vocabulario de F01/ADR-001 §5, no una etiqueta de menú. */
export type SplitMode = 'equal' | 'shares' | 'amounts';

export const SPLIT_MODES: readonly SplitMode[] = ['equal', 'shares', 'amounts'];

/**
 * Lo que la persona lleva escrito, tal cual.
 *
 * Las partes y los importes se guardan **como texto y por participante**: es lo
 * que se teclea, y pasarlo a número en cada pulsación metería un `Number` en el
 * camino de un valor monetario justo donde F02/ADR-001 §1 dice que no. Van en un
 * mapa y no en una lista porque desmarcar a alguien no puede desplazar lo que
 * otro escribió.
 */
export type SharedExpenseDraft = {
  readonly amount: string;
  readonly concept: string;
  /**
   * La categoría del gasto. `null` mientras no se elija.
   *
   * **No se siembra ninguna.** Igual que en el alta de un movimiento personal:
   * elegirla es parte de describir el gasto, y poner una por defecto la
   * convertiría en la que casi todo el mundo deja puesta.
   */
  readonly categoryId: string | null;
  readonly date: CalendarDate;
  /**
   * LA HORA EFECTIVA, `HH:MM` del reloj de pared, o `null` si no la hay.
   *
   * Un gasto NUEVO nace con la hora actual —como el movimiento personal— y se
   * puede consultar o cambiar. Un gasto HISTÓRICO sin hora se corrige con
   * `null`: conserva su ausencia, y nadie le inventa una (F06/ADR-002 §3). Por eso
   * el tipo admite `null` y el payload lo transmite tal cual.
   */
  readonly time: string | null;
  /**
   * Quién pagó. `null` mientras no se sepa.
   *
   * **No se rellena adivinando.** Ni por coincidencia de nombre —dos personas se
   * llaman igual y el parecido no es identidad— ni cogiendo al primero de la
   * lista. Hoy `api.group_participant` no publica el vínculo con la cuenta
   * (F03/ADR-009 §1), así que el cliente no sabe cuál de los participantes es quien
   * mira: mientras siga sin saberlo, esto arranca en `null` y se elige a mano.
   */
  readonly payerId: string | null;
  /** Quiénes participan del reparto, en el orden estable de la lista. */
  readonly selected: readonly string[];
  readonly mode: SplitMode;
  /** Partes enteras declaradas, por participante. Texto sin normalizar. */
  readonly weights: Readonly<Record<string, string>>;
  /**
   * Importes FIJADOS A MANO, por participante. Texto sin normalizar.
   *
   * **Estar en el mapa es estar fijado.** Quien participa y no figura aquí va
   * en AUTOMÁTICO: su cuota es el restante del total, repartido igualmente
   * entre los automáticos con la misma regla de restos, y se recalcula sola
   * cuando cambian el total, la selección o cualquier cuota fijada. La
   * distinción manual/automático es del formulario: al servidor viaja el
   * reparto exacto final, manual y automático ya resueltos, con el contrato
   * de siempre (`exact_amounts`). No hay un segundo modelo contable.
   */
  readonly amounts: Readonly<Record<string, string>>;
};

/** Por qué todavía no se puede guardar. `null` significa que sí se podría. */
export type SharedExpenseBlocker =
  /*
   * **`noRoute` ya no existe, y es la nota que cierra F9.B.** Estuvo aquí
   * mientras la frontera rechazaba cualquier gasto de grupo: nadie era elegible
   * —`api.create_group` no abría periodos de presencia—, el pagador no se podía
   * resolver y el contrato no admitía ni concepto ni categoría. Las tres cosas
   * se cerraron en `20260908120000_group_expense_flow.sql`, así que un gasto con
   * todo puesto **se guarda de verdad** y lo único que apaga `Guardar` es que
   * falte algo del formulario.
   *
   * Lo que la frontera siga rechazando —un grupo anterior a la migración, sin
   * presencias— llega como RESPUESTA, con su código y su motivo, y no como un
   * bloqueo declarado de antemano: el borrador se conserva y se puede reintentar.
   */
  | 'transferNoRoute'
  | 'noParticipants'
  | 'payerUnknown'
  | 'amountMissing'
  | 'amountInvalid'
  | 'conceptMissing'
  /** Hay catálogo y falta elegir. Distinto de no tener ninguno que ofrecer. */
  | 'categoryMissing'
  /**
   * Sin conexión y sin catálogo cacheado (F07/ADR-001 §16).
   *
   * No es lo mismo que `categoryMissing`: allí hay categorías y falta elegir
   * una, aquí **no hay ninguna que ofrecer**. Confundirlos diría «elige una
   * categoría» sobre un selector vacío.
   */
  | 'noCategories'
  /**
   * La elegida es PROPIA, y un gasto compartido sólo admite las de Nomey.
   *
   * Se pide elegir otra y **no se sustituye por ninguna en silencio**: la que
   * hay la eligió una persona a propósito, y cambiarla por su cuenta guardaría
   * un gasto clasificado en algo que nadie dijo. El servidor exige lo mismo
   * —`CATEGORY_NOT_SHAREABLE`—, así que esto adelanta el motivo, no lo inventa.
   */
  | 'categoryNotShared'
  | 'sharesInvalid'
  | 'amountsMismatch'
  /**
   * Una cuota fijada a mano está vacía o a medio escribir. No es un cero y
   * no cuadra nada mientras tanto: las automáticas quedan pendientes.
   */
  | 'amountsIncomplete'
  /**
   * El reparto deja a alguien en cero: una cuota fijada en cero, o un restante
   * que no llega a los automáticos. En `Cantidad` lo declarado es > 0 por
   * contrato —quien declara cero no participa—, así que se pide desmarcar.
   */
  | 'amountsZero';

/** Una fila del reparto ya resuelta, o pendiente de poder resolverse. */
export type Quota = {
  readonly participantId: string;
  /** Unidades menores de la divisa del grupo, o `null` si aún no se sabe. */
  readonly minor: bigint | null;
};

export type SplitOutcome = {
  readonly quotas: readonly Quota[];
  /** Lo que falta por asignar (positivo) o lo que sobra (negativo). */
  readonly difference: bigint | null;
  readonly blocker: SharedExpenseBlocker | null;
};

const POSITIVE_INTEGER = /^[0-9]+$/;

/**
 * LAS PARTES DE ALGUIEN, como número. Lo escrito si es un entero positivo;
 * una, si no hay nada o lo que hay no vale. Es lo que el control −/+ enseña.
 */
export function sharesOf(draft: SharedExpenseDraft, id: string): bigint {
  const raw = (draft.weights[id] ?? '').trim();
  if (!POSITIVE_INTEGER.test(raw)) return 1n;
  const value = BigInt(raw);
  return value >= 1n ? value : 1n;
}

/**
 * UNA PARTE MÁS O MENOS, sin teclado. El mínimo es UNA: quien participa tiene
 * al menos una parte, y para excluirlo está su tick, no un cero. No hay tope
 * por arriba porque el contrato (`SPLIT_SHARE_NOT_POSITIVE`) sólo fija el
 * suelo. Cada pulsación deja el borrador listo para `computeSplit`.
 */
export function adjustShares(
  draft: SharedExpenseDraft,
  id: string,
  delta: 1 | -1,
): SharedExpenseDraft {
  const next = sharesOf(draft, id) + BigInt(delta);
  if (next < 1n) return draft;
  return { ...draft, weights: { ...draft.weights, [id]: next.toString() } };
}

/**
 * «REPARTIR IGUALMENTE»: se liberan todas las cuotas fijadas y todo vuelve a
 * automático. Es lo único que deshace una cuota manual; vaciar un campo no
 * lo devuelve a automático, lo deja incompleto (`amountsIncomplete`).
 */
export function equalizeAmounts(draft: SharedExpenseDraft): SharedExpenseDraft {
  return { ...draft, amounts: {} };
}

/** Si la cuota de alguien está fijada a mano. */
export function isFixedAmount(draft: SharedExpenseDraft, id: string): boolean {
  return Object.prototype.hasOwnProperty.call(draft.amounts, id);
}

/** El borrador de partida: todos dentro, a partes iguales, sin pagador puesto. */
/**
 * EL BORRADOR DE UNA CORRECCIÓN: los valores VIGENTES del gasto.
 *
 * **Todo sale de lo DECLARADO, nada de las cuotas resueltas.** El método, las
 * partes y los importes exactos se leen de `core.split_participant` tal como
 * se escribieron; deducir «3 partes» dividiendo cuotas ya repartidas es una
 * inferencia, y con un resto asignado por el desempate de F01/ADR-001 §5 daría un
 * reparto que nadie escribió — y que al guardarse cambiaría el gasto sin que
 * nadie lo hubiera tocado.
 *
 * **El orden de los participantes es el `ordinal`**, que es intención y no
 * decoración: es el desempate que decide sobre quién cae el céntimo sobrante.
 * Reordenarlos movería ese céntimo.
 *
 * El importe llega en unidades menores y vuelve a texto para el campo, con la
 * escala de la divisa del grupo: nunca se presuponen dos decimales.
 */
export function draftOf(
  input: {
    readonly totalMinor: string;
    readonly concept: string;
    readonly categoryId: string | null;
    readonly effectiveDate: string;
    /** `HH:MM:SS` tal como lo publica la vista, o `null` si la versión no tiene hora. */
    readonly effectiveTime: string | null;
    readonly payerParticipantId: string | null;
    readonly splitMethod: string | null;
  },
  split: readonly {
    readonly participantId: string;
    readonly declaredWeight: string | null;
    readonly declaredAmount: string | null;
  }[],
  scale: number,
): SharedExpenseDraft {
  const mode: SplitMode =
    input.splitMethod === 'shares'
      ? 'shares'
      : input.splitMethod === 'exact_amounts'
        ? 'amounts'
        : 'equal';

  const weights: Record<string, string> = {};
  const amounts: Record<string, string> = {};
  for (const row of split) {
    if (row.declaredWeight !== null) weights[row.participantId] = row.declaredWeight;
    if (row.declaredAmount !== null) {
      amounts[row.participantId] = fromMinorUnits(BigInt(row.declaredAmount), scale);
    }
  }

  return {
    amount: fromMinorUnits(BigInt(input.totalMinor), scale),
    concept: input.concept,
    date: input.effectiveDate as CalendarDate,
    /* La hora EXISTENTE, recortada a minutos; nunca la de la edición. */
    time: input.effectiveTime === null ? null : input.effectiveTime.slice(0, 5),
    categoryId: input.categoryId,
    payerId: input.payerParticipantId,
    selected: split.map((row) => row.participantId),
    mode,
    weights,
    amounts,
  };
}

/**
 * SI HAY QUE SEMBRAR AHORA LA CATEGORÍA PREESTABLECIDA, y cuál.
 *
 * Pura, para poder afirmar las cinco situaciones sin renderer: perfil y
 * catálogo desde el principio; llegando después del primer render; elección
 * manual antes de terminar la carga; cambio de preferencia y gasto nuevo;
 * edición que conserva la categoría original.
 *
 * Devuelve la categoría a poner, o `null` si no toca: porque es una
 * corrección, porque ya se sembró una vez, porque la persona eligió a mano, o
 * porque el borrador ya lleva categoría. Nunca sobrescribe.
 */
export function presetToApply(args: {
  readonly editing: boolean;
  readonly presetCategoryId: string | null;
  readonly categoryId: string | null;
  readonly applied: boolean;
  readonly touched: boolean;
}): string | null {
  if (args.editing || args.applied || args.touched) return null;
  if (args.presetCategoryId === null || args.categoryId !== null) return null;
  return args.presetCategoryId;
}

/**
 * LA CIFRA VIGENTE, SEMBRADA EN LA MÁQUINA DE ENTRADA como precargada.
 *
 * `seeded: true` es el contrato de `amount-entry`: se ve en gris, sigue siendo
 * el valor del gasto mientras nadie la toque —guardar sólo concepto o
 * participantes la conserva—, y la PRIMERA cifra tecleada la sustituye en vez
 * de añadirse (35 → «1» → 1 → «2» → 12). Borrar y los decimales, a partir de
 * ahí, actúan sobre lo nuevo. Vacía o inválida después de tocar, sigue vacía o
 * inválida: no vuelve al original a escondidas ni deja guardar un cero.
 *
 * Es la misma máquina y el mismo contrato que corregir un movimiento personal.
 */
export function seedAmountEntry(amount: string | undefined): AmountEntry {
  if (amount === undefined || amount.trim() === '') return EMPTY_AMOUNT;
  const [whole = '', fraction = ''] = amount.split('.');
  if (whole === '') return EMPTY_AMOUNT;
  return { whole, fraction, inFraction: fraction !== '', seeded: true };
}

export function initialDraft(
  participants: readonly GroupParticipant[],
  date: CalendarDate,
  /** La hora actual, sembrada por quien conoce el reloj del aparato. */
  time: string,
  /**
   * La categoría PREESTABLECIDA del grupo, ya comprobada como utilizable, o
   * `null` («Todas»). Sólo siembra: el gasto guarda la suya y la persona la
   * cambia si quiere. Un borrador ya abierto no se toca por esta vía.
   */
  presetCategoryId: string | null = null,
): SharedExpenseDraft {
  return {
    amount: '',
    concept: '',
    date,
    time,
    categoryId: presetCategoryId,
    payerId: null,
    // Por defecto participan los ACTIVOS: es el caso corriente, y empezar
    // con la lista vacía obligaría a marcar a cinco personas para registrar
    // la cena que se acaban de repartir. Quien salió no se propone (F09/ADR-003
    // §5), aunque la fecha lo admita: se elige a mano.
    selected: participants.filter(activeByDefault).map((one) => one.participantId),
    mode: 'equal',
    weights: {},
    amounts: {},
  };
}

/**
 * ELEGIR PAGADOR **INCLUYE** AL PAGADOR EN EL REPARTO.
 *
 * `splitExpense` lo exige —`SPLIT_PAYER_NOT_PARTICIPANT`— y la regla es del
 * modelo, no de la pantalla: quien paga una cena también cena. Si estaba
 * desmarcado se vuelve a marcar y las cuotas se recalculan solas, porque salen
 * de `selected`.
 *
 * **Y vuelve a su sitio en el orden estable**, no al final: ese orden es el
 * desempate del céntimo sobrante (F01/ADR-001 §5, paso 5), así que cambiar de
 * pagador dos veces no puede dejar la lista en otro orden que el de la tarjeta.
 */
export function setPayer(
  draft: SharedExpenseDraft,
  payerId: string,
  order: readonly string[],
): SharedExpenseDraft {
  if (draft.selected.includes(payerId)) return { ...draft, payerId };

  const back = [...draft.selected, payerId];
  return seedShares({
    ...draft,
    payerId,
    selected: order.filter((one) => back.includes(one)),
  });
}

/**
 * CAMBIAR DE MÉTODO, con lo que ese método necesita para empezar.
 *
 * **`Por partes` arranca con una parte cada uno**, que es el reparto igualitario
 * escrito en el vocabulario del método: es lo que la persona espera ver al
 * entrar, y desde ahí sube la de quien cenó doble. Empezar con los campos
 * vacíos obligaba a teclear un `1` cinco veces para llegar a donde ya estaba.
 *
 * No es rellenar lo que alguien escribió: **sólo se siembra lo que falta**, así
 * que volver de `Cantidad` a `Por partes` conserva las partes de antes.
 *
 * **`Cantidad` NO se siembra**, y la asimetría es del contrato: una parte es una
 * proporción y uno es su neutro; un importe es dinero, y ponerlo por defecto
 * sería declarar por la persona cuánto le toca a cada quien.
 */
export function setMode(draft: SharedExpenseDraft, mode: SplitMode): SharedExpenseDraft {
  return seedShares({ ...draft, mode });
}

/**
 * Una parte para quien participe y todavía no tenga ninguna. **Sólo en `shares`.**
 *
 * Lo usan las tres transiciones que pueden dejar a alguien dentro sin declarar:
 * cambiar de método, marcar a alguien y cambiar de pagador. Sin esto, marcar a
 * una quinta persona apagaba las cuotas de las otras cuatro — la suya faltaba, y
 * un reparto incompleto no es un reparto.
 */
function seedShares(draft: SharedExpenseDraft): SharedExpenseDraft {
  if (draft.mode !== 'shares') return draft;

  const weights = { ...draft.weights };
  for (const id of draft.selected) {
    if ((weights[id] ?? '').trim() === '') weights[id] = '1';
  }
  return { ...draft, weights };
}

/**
 * Marcar o desmarcar a alguien. **Al pagador no se le puede desmarcar.**
 *
 * Y no se le desmarca en silencio dejando el tick apagado: la fila lo dice, con
 * su motivo, para quien mira y para quien escucha. Desmarcar excluye del
 * REPARTO; no saca a nadie del grupo, que es otra operación y otra pantalla.
 */
export function toggleParticipant(
  draft: SharedExpenseDraft,
  id: string,
  order: readonly string[],
): SharedExpenseDraft {
  if (id === draft.payerId) return draft;

  if (draft.selected.includes(id)) {
    // En `Cantidad`, su cuota deja de contar: fijada o no, se suelta. Al
    // volver a marcarlo entra en automático, con el restante de entonces.
    const amounts = { ...draft.amounts };
    delete amounts[id];
    return { ...draft, amounts, selected: draft.selected.filter((one) => one !== id) };
  }

  // Se reinserta EN EL ORDEN ESTABLE de la lista, no al final: el orden de los
  // participantes es el desempate del resto (F01/ADR-001 §5, paso 5), así que
  // desmarcar y volver a marcar no puede mover el céntimo a otra persona.
  const back = [...draft.selected, id];
  return seedShares({ ...draft, selected: order.filter((one) => back.includes(one)) });
}

/**
 * REVALIDA LA SELECCIÓN CONTRA LA FECHA, sin inventarse ninguna presencia.
 *
 * F03/ADR-009 §7 evalúa la elegibilidad de un participante contra la fecha efectiva
 * de la operación, y quien la evalúa de verdad es la frontera. El cliente sólo
 * puede adelantarse si CONOCE los periodos, y hoy no los conoce: `core
 * .participant_period` no tiene ninguna fila y ninguna vista de `api` los
 * publica. Con `periods === null` —«no se sabe»— aquí no se descarta a nadie:
 * suponer que todo el mundo es elegible sería inventar la presencia que falta, y
 * descartarlos a todos sería inventar la contraria.
 *
 * En cuanto la elegibilidad se publique, esta función ya la aplica: cambiar la
 * fecha desmarca a quien no estuviera y recalcula. No hay nada más que cablear.
 */
export function applyEligibility(
  draft: SharedExpenseDraft,
  participants: readonly GroupParticipant[],
  date: CalendarDate,
): SharedExpenseDraft {
  const excluded = new Set(
    participants.filter((one) => !eligibleOn(one, date)).map((one) => one.participantId),
  );

  if (excluded.size === 0) return { ...draft, date };

  return {
    ...draft,
    date,
    payerId: draft.payerId !== null && excluded.has(draft.payerId) ? null : draft.payerId,
    selected: draft.selected.filter((one) => !excluded.has(one)),
  };
}

/**
 * LAS CUOTAS, y el motivo cuando todavía no las hay.
 *
 * Se llama en cada render con lo que haya escrito, así que su contrato es no
 * lanzar nunca: valida primero y sólo entonces delega en `splitExpense`.
 */
export function computeSplit(
  draft: SharedExpenseDraft,
  currency: CurrencyDefinition,
  /** Si no hay catálogo que ofrecer. Por defecto lo hay, como antes de F9. */
  categoriesUnavailable = false,
  /**
   * Si la categoría del borrador es de las que un gasto compartido admite.
   *
   * Lo decide quien tiene el catálogo delante —`isSharedCategory`—, no este
   * módulo: aquí sólo se sabe la identidad elegida, y resolverla contra las
   * filas exigiría que el modelo del reparto conociera el catálogo.
   */
  categoryShareable = true,
): SplitOutcome {
  const pending = draft.selected.map((id) => ({ participantId: id, minor: null }));

  /*
   * ═══ EL CERO DE PARTIDA NO ES UN ERROR, Y POR ESO SE DISTINGUE ═══
   *
   * Con el formulario recién abierto no falta ningún dato: **todavía no se ha
   * escrito el importe**, y repartir cero entre quien sea da cero a cada uno. Eso
   * es una cuota real de la divisa del grupo, no un hueco, así que se enseña como
   * la cifra que es y no como un guion.
   *
   * **Y sólo eso.** Un importe inválido, unas partes a medio escribir o unos
   * importes que no cuadran NO salen en cero: ahí sí falta algo o hay algo mal, y
   * pintar un cero convertiría un error en una cifra de aspecto válido. Esos
   * siguen devolviendo `null`, que la pantalla pinta pendiente.
   *
   * Va ANTES que el pagador a propósito: al abrir la ventana tampoco hay pagador
   * elegido, y la presentación inicial es la de un formulario en blanco, no la de
   * un formulario con un problema.
   */
  if (draft.amount.trim() === '') {
    return {
      quotas: draft.selected.map((id) => ({ participantId: id, minor: 0n })),
      difference: null,
      blocker: 'amountMissing',
    };
  }

  if (draft.selected.length === 0) {
    return { quotas: pending, difference: null, blocker: 'noParticipants' };
  }
  if (draft.payerId === null || !draft.selected.includes(draft.payerId)) {
    return { quotas: pending, difference: null, blocker: 'payerUnknown' };
  }
  const total = toMinorUnits(draft.amount, currency.scale);
  if (total === null || total <= 0n) {
    return { quotas: pending, difference: null, blocker: 'amountInvalid' };
  }

  const method = buildMethod(draft, currency.scale, total);
  if (method === null) {
    // Sólo `amounts` puede fallar cuadrando: en `shares` lo que falta son
    // partes, y ahí no hay diferencia monetaria que enseñar.
    if (draft.mode === 'amounts') {
      const resolution = resolveAmounts(draft, currency.scale, total);
      return {
        // Se pintan LOS IMPORTES QUE LA PERSONA FIJÓ y los automáticos que se
        // pudieron calcular, no unos corregidos: es lo que hace legible «te
        // faltan 2,50». Lo que no se puede resolver sale pendiente, no en cero.
        quotas: draft.selected.map((id) => ({
          participantId: id,
          minor: resolution.resolved.get(id) ?? null,
        })),
        difference: resolution.difference,
        blocker: resolution.blocker ?? 'amountsMismatch',
      };
    }
    return { quotas: pending, difference: null, blocker: 'sharesInvalid' };
  }

  const shares: readonly Share[] = splitExpense({
    total: money(total, currency),
    participants: draft.selected.map((id) => participantId(id)),
    payer: participantId(draft.payerId),
    method,
  });

  return {
    quotas: shares.map((share) => ({
      participantId: share.participant as string,
      minor: share.amount.minor,
    })),
    difference: 0n,
    blocker: concept(draft) ?? category(draft, categoriesUnavailable, categoryShareable),
  };
}

/**
 * El concepto se exige igual que en un movimiento personal, **aunque hoy no
 * viaje**: es el dato que dice qué se gastó, y un formulario que lo pide y luego
 * lo da por opcional enseña a no rellenarlo. Que la frontera todavía no lo
 * admita es un bloqueo suyo —`noRoute`—, no una razón para dejar de pedirlo.
 */
function concept(draft: SharedExpenseDraft): SharedExpenseBlocker | null {
  return draft.concept.trim() === '' ? 'conceptMissing' : null;
}

/**
 * La categoría se exige igual que en un movimiento personal, **aunque hoy no
 * viaje**: describe en qué se gastó, y un formulario que la pide y luego la da
 * por opcional enseña a no rellenarla. Que la frontera todavía no la admita es
 * un bloqueo suyo —`noRoute`—, no una razón para dejar de pedirla.
 *
 * Sin catálogo que ofrecer el motivo es OTRO, y se dice aparte: pedir que se
 * elija sobre un menú vacío no ayuda a nadie.
 */
function category(
  draft: SharedExpenseDraft,
  categoriesUnavailable: boolean,
  categoryShareable: boolean,
): SharedExpenseBlocker | null {
  if (categoriesUnavailable) return 'noCategories';
  if (draft.categoryId === null) return 'categoryMissing';
  // Elegida, pero propia: se pide otra. Nunca se cambia por una parecida.
  return categoryShareable ? null : 'categoryNotShared';
}

/**
 * El método de F01/ADR-001 §5 ya validado, o `null` si lo declarado no vale.
 *
 * **Valida TODO lo que `splitExpense` exige, incluida la suma.** No es una
 * comprobación repetida por si acaso: el contrato de `computeSplit` es no
 * lanzar, y `splitExpense` lanza `SPLIT_EXACT_AMOUNTS_MISMATCH` cuando los
 * importes declarados no dan el total. Dejar esa validación sólo al dominio
 * convertía «te sobran tres euros» en una excepción durante el render — lo
 * reprodujo la prueba de 9 + 3 + 1 sobre un total de 10.
 */
function buildMethod(draft: SharedExpenseDraft, scale: number, total: bigint): SplitMethod | null {
  if (draft.mode === 'equal') return { kind: 'equal' };

  if (draft.mode === 'shares') {
    const weights: bigint[] = [];
    for (const id of draft.selected) {
      const raw = (draft.weights[id] ?? '').trim();
      // Enteras y estrictamente positivas: es lo que `splitExpense` exige de lo
      // DECLARADO, frente a lo calculado, que sí puede salir cero.
      if (!POSITIVE_INTEGER.test(raw)) return null;
      const weight = BigInt(raw);
      if (weight <= 0n) return null;
      weights.push(weight);
    }
    return { kind: 'shares', weights };
  }

  const resolution = resolveAmounts(draft, scale, total);
  if (resolution.blocker !== null) return null;

  const amounts: bigint[] = [];
  for (const id of draft.selected) {
    const minor = resolution.resolved.get(id);
    if (minor === undefined || minor === null) return null;
    amounts.push(minor);
  }
  return { kind: 'exact_amounts', amounts };
}

/**
 * EL REPARTO DE `Cantidad` YA RESUELTO: lo fijado a mano tal cual, y el
 * restante repartido igualmente entre los automáticos.
 *
 * **La aritmética del restante es la de F01/ADR-001 §5**, por `allocateBy
 * LargestRemainder`: mayor resto primero y, a igualdad, el pagador antes que
 * el resto en el orden estable. 30 entre tres automáticos son 10/10/10; con
 * uno fijado en 20, el restante 10 se parte 5/5; fijado otro en 7, quedan 3
 * para el último. 10 entre tres son 3,34/3,33/3,33 y nunca tres de 3,33.
 *
 * **Nada se corrige en silencio.** Una cuota fijada vacía o a medio escribir
 * deja todo pendiente (`amountsIncomplete`); si las fijadas superan el total,
 * se conservan tal cual, la diferencia sale negativa y los automáticos quedan
 * pendientes (`amountsMismatch`), nunca negativos; si el restante no llega a
 * dar más de cero a cada automático, o alguien fijó cero, el reparto deja a
 * alguien en cero y se dice (`amountsZero`), porque el contrato exige > 0.
 * Con todo fijado, se exige que sumen el total, como siempre.
 */
export type AmountsResolution = {
  /** Por participante seleccionado; `null` es pendiente, nunca cero. */
  readonly resolved: ReadonlyMap<string, bigint | null>;
  /** Quiénes van en automático, en el orden estable. */
  readonly automatic: readonly string[];
  /** Lo que falta por asignar (positivo) o sobra (negativo), si se sabe. */
  readonly difference: bigint | null;
  readonly blocker: 'amountsIncomplete' | 'amountsMismatch' | 'amountsZero' | null;
};

export function resolveAmounts(
  draft: SharedExpenseDraft,
  scale: number,
  total: bigint,
): AmountsResolution {
  const resolved = new Map<string, bigint | null>();
  const automatic: string[] = [];
  let incomplete = false;
  let manualSum = 0n;
  let zero = false;

  for (const id of draft.selected) {
    if (!isFixedAmount(draft, id)) {
      automatic.push(id);
      resolved.set(id, null);
      continue;
    }
    const raw = (draft.amounts[id] ?? '').trim();
    const minor = raw === '' ? null : toMinorUnits(raw, scale);
    resolved.set(id, minor);
    if (minor === null) {
      incomplete = true;
      continue;
    }
    manualSum += minor;
    if (minor <= 0n) zero = true;
  }

  if (incomplete) return { resolved, automatic, difference: null, blocker: 'amountsIncomplete' };

  const remainder = total - manualSum;

  if (automatic.length === 0) {
    return {
      resolved,
      automatic,
      difference: remainder,
      blocker: zero ? 'amountsZero' : remainder !== 0n ? 'amountsMismatch' : null,
    };
  }

  if (remainder < 0n) {
    // Las fijadas se pasan: se conservan, se enseña el exceso y nadie recibe
    // una cuota negativa.
    return { resolved, automatic, difference: remainder, blocker: 'amountsMismatch' };
  }

  const shares =
    remainder === 0n
      ? automatic.map(() => 0n)
      : allocateByLargestRemainder(
          remainder,
          automatic.map(() => 1n),
          automatic.map((id, index) => (id === draft.payerId ? -1 : index)),
        );
  shares.forEach((minor, index) => {
    resolved.set(automatic[index] as string, minor);
    if (minor <= 0n) zero = true;
  });

  return { resolved, automatic, difference: 0n, blocker: zero ? 'amountsZero' : null };
}

/**
 * EL PAYLOAD DE LA FRONTERA, con la forma exacta que admite su contrato.
 *
 * `api.record_group_expense` acepta —y sólo acepta— estos campos. El importe y
 * las entradas del método salen como **texto**: el `bigint` no cruza JSON, que
 * es lo que F03/ADR-005 §1 exige de todo lo monetario.
 *
 * **El cliente manda la INTENCIÓN, no el resultado.** No viajan las cuotas ni
 * los efectos: los deriva el servidor con la misma regla de restos. La
 * previsualización de la pantalla no es una segunda autoridad contable.
 */
export type GroupExpensePayload = {
  readonly client_operation_id: string;
  readonly command_contract_version: 1;
  /**
   * LOS DOS CAMPOS QUE CONVIERTEN UN ALTA EN UNA CORRECCIÓN.
   *
   * La frontera es la MISMA función: `api.record_group_expense` distingue las
   * dos por la presencia de este par (F03/ADR-006 §1). No hay un segundo gasto ni
   * un `update` sobre hechos inmutables — lo que se escribe es otra versión de
   * la misma operación, y la anterior queda como historia.
   *
   * `expected_version_id` es el CAS de F03/ADR-008 §13: si alguien corrigió el
   * gasto entre que se cargó y se guarda, el servidor lo rechaza en vez de
   * pisar un cambio que no se vio.
   */
  readonly operation_id?: string;
  readonly expected_version_id?: string;
  readonly scope_id: string;
  /** La moneda DECLARADA del gasto: desde F11.D puede no ser la del grupo. */
  readonly currency_definition_id: string;
  /**
   * LA BASE QUE SE ASUMIÓ AL CAPTURAR (F11/ADR-001 §10), y sólo cuando la
   * moneda del gasto NO es la base del grupo.
   *
   * Sin ella el servidor tomaría la moneda declarada como base asumida y
   * rechazaría el gasto con `CURRENCY_CONVERSION_UNSUPPORTED`. Con ella
   * compara bajo el cerrojo contra la base vigente del grupo y decide él si
   * hereda el tipo congelado o resuelve uno nuevo.
   *
   * **Ausente cuando el gasto va en la moneda del grupo**, a propósito: ese
   * payload es exactamente el de antes de F11, así que su intención canónica
   * —y con ella su idempotencia— no cambia.
   */
  readonly expected_base_currency_definition_id?: string;
  readonly total: string;
  readonly effective_date: string;
  /** `HH:MM`, o `null` para conservar la ausencia de un gasto histórico. */
  readonly effective_time: string | null;
  readonly concept: string;
  readonly category_id: string;
  readonly payer_participant_id: string;
  readonly participants: readonly string[];
  readonly split_method:
    | { readonly kind: 'equal' }
    | { readonly kind: 'shares'; readonly weights: readonly string[] }
    | { readonly kind: 'exact_amounts'; readonly amounts: readonly string[] };
};

/**
 * El payload de un borrador, o `null` si todavía no se puede enviar.
 *
 * **Se construye desde lo mismo que calcula la vista previa**, así que no puede
 * describir un gasto distinto del que se está viendo: el método sale de
 * `buildMethod`, que es el que valida, y el orden de `participants` es el orden
 * estable que decide el céntimo sobrante.
 */
export function buildGroupExpensePayload(
  draft: SharedExpenseDraft,
  scope: {
    readonly scopeId: string;
    /** La moneda DECLARADA del gasto, que es en la que está escrito el importe. */
    readonly currencyDefinitionId: string;
    readonly scale: number;
    /**
     * La base del GRUPO, cuando la moneda declarada no lo es. El reparto sigue
     * calculándose en la moneda declarada —F11/ADR-003: lo declarado se valida
     * donde se escribió— y quien convierte y reparte después es el servidor.
     */
    readonly baseCurrencyDefinitionId?: string;
  },
  clientOperationId: string,
  /** Qué operación y versión se corrigen. Ausente en un alta. */
  correction?: { readonly operationId: string; readonly expectedVersionId: string },
): GroupExpensePayload | null {
  if (draft.payerId === null || draft.categoryId === null) return null;
  if (draft.concept.trim() === '') return null;

  const total = toMinorUnits(draft.amount, scope.scale);
  if (total === null || total <= 0n) return null;

  const method = buildMethod(draft, scope.scale, total);
  if (method === null) return null;

  return {
    client_operation_id: clientOperationId,
    command_contract_version: 1,
    ...(correction === undefined
      ? {}
      : {
          operation_id: correction.operationId,
          expected_version_id: correction.expectedVersionId,
        }),
    scope_id: scope.scopeId,
    currency_definition_id: scope.currencyDefinitionId,
    ...(scope.baseCurrencyDefinitionId === undefined ||
    scope.baseCurrencyDefinitionId === scope.currencyDefinitionId
      ? {}
      : { expected_base_currency_definition_id: scope.baseCurrencyDefinitionId }),
    total: total.toString(),
    effective_date: draft.date,
    effective_time: draft.time,
    concept: draft.concept.trim(),
    category_id: draft.categoryId,
    payer_participant_id: draft.payerId,
    participants: [...draft.selected],
    split_method:
      method.kind === 'equal'
        ? { kind: 'equal' }
        : method.kind === 'shares'
          ? { kind: 'shares', weights: method.weights.map((one) => one.toString()) }
          : { kind: 'exact_amounts', amounts: method.amounts.map((one) => one.toString()) },
  };
}
