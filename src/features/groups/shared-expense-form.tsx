import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { type CurrencyDefinition, currencyDefinition, money } from '@/domain';
import { type CategoryCatalogue, sharedCategories } from '@/lib/categories';
import { useCurrencies } from '@/lib/currency';
import {
  type CalendarDate,
  clockTimeOf,
  currencySymbol,
  dateAtClockTime,
  useFormat,
} from '@/lib/format';
import { type MessageKey, useTranslation } from '@/lib/i18n';
import {
  type AmountEntry,
  AmountSheet,
  amountValue,
  EmptyState,
  ThemedText,
} from '@/ui/components';
import { Spacing, Symbols } from '@/ui/theme';

import { ExpenseKindSelector } from './expense-kind-selector';
import { activeByDefault, eligibleOn, type GroupParticipant, listed } from './participant-service';
import { SharedExpenseDate, SharedExpenseFields } from './shared-expense-fields';
import {
  adjustShares,
  applyEligibility,
  buildGroupExpensePayload,
  computeSplit,
  equalizeAmounts,
  type GroupKind,
  initialDraft,
  presetToApply,
  seedAmountEntry,
  setMode,
  type SharedExpenseBlocker,
  type SharedExpenseDraft,
  setPayer,
  type SplitMode,
  toggleParticipant,
} from './shared-expense';
import { SplitParticipantsCard } from './split-participants-card';
import { useRecordExpense } from './use-record-expense';

/**
 * Lo que dice cada rechazo de la frontera. Sólo los que esta pantalla puede
 * provocar; cualquier otro cae en el mensaje genérico, que no inventa una causa.
 */
const REJECTION_KEY: Readonly<Record<string, MessageKey>> = {
  PARTICIPANT_NOT_ELIGIBLE: 'group.expenseNotEligible',
  DEPARTED_OBLIGATION_CHANGED: 'group.expenseDeparted',
  PARTICIPANT_RETIRED: 'group.expenseRetired',
  CATEGORY_NOT_SHAREABLE: 'group.expenseCategoryShared',
  CATEGORY_NOT_USABLE: 'group.expenseCategoryUnusable',
  SPLIT_EXACT_AMOUNTS_MISMATCH: 'group.expenseAmountsMismatch',
  VERSION_CONFLICT: 'group.expenseConflict',
  OPERATION_ANNULLED: 'group.expenseConflict',
  CURRENCY_CONVERSION_UNSUPPORTED: 'group.expenseCurrency',
  /*
   * F11: los tres rechazos de cambio, cada uno por su causa. Un gasto de grupo
   * no pasa por la cola durable, así que `FX_RATE_NOT_YET_AVAILABLE` tampoco
   * espera aquí a nada: se dice que el tipo de ese día aún no está publicado.
   */
  FX_CURRENCY_NOT_COVERED: 'group.expenseFxNotCovered',
  FX_CONVERSION_OUT_OF_RANGE: 'group.expenseFxOutOfRange',
  FX_RATE_NOT_YET_AVAILABLE: 'group.expenseFxPending',
};

/** Por qué no se puede guardar todavía, dicho en el idioma de quien mira. */
const BLOCKER_KEY = {
  categoryMissing: 'entry.categoryHint',
  noCategories: 'entry.categoriesOffline',
  categoryNotShared: 'group.expenseCategoryShared',
  transferNoRoute: 'group.transferNoRoute',
  noParticipants: 'group.expenseNoParticipants',
  payerUnknown: 'group.expensePayerUnknown',
  amountMissing: 'group.expenseAmountMissing',
  amountInvalid: 'group.expenseAmountInvalid',
  conceptMissing: 'group.expenseConceptMissing',
  sharesInvalid: 'group.expenseSharesInvalid',
  amountsMismatch: 'group.expenseAmountsMismatch',
  amountsIncomplete: 'group.expenseAmountsIncomplete',
  amountsZero: 'group.expenseAmountsZero',
} as const satisfies Record<SharedExpenseBlocker, string>;

/**
 * AÑADIR UN GASTO COMPARTIDO. **La misma ventana de Inicio, con otro contenido.**
 *
 * `AmountSheet` es literalmente la composición que montan «Añadir movimiento»,
 * «Editar movimiento» y «Editar disponible»: la fila del importe con su
 * contrapeso y su control de moneda, el aviso, la pista, el error y el CTA
 * amarillo. No hay una segunda ventana con los mismos números — bajó a `ui/`
 * cuando esta pantalla la necesitó, precisamente para que no la hubiera.
 *
 * **Donde Inicio dice «Personal», aquí va el nombre del grupo.** Y es un rótulo,
 * no un selector: el ámbito lo fija la pantalla desde la que se abrió, así que
 * no hay nada que elegir. Un control ahí invitaría a mover un gasto de grupo a
 * otro, que es una operación distinta y no existe.
 *
 * **Esto es un GASTO compartido, y sólo eso.** No hay selector de clase: reusar
 * el formulario personal no habilita ingresos ni transferencias de grupo, que
 * son operaciones con su propio contrato y su propia frontera.
 *
 * ═══════════ POR QUÉ `GUARDAR` NO ENVÍA NADA TODAVÍA ═══════════
 *
 * Porque la frontera no lo admite, y está medido, no supuesto. `computeSplit`
 * devuelve `noRoute` cuando todo lo demás está bien, el CTA se queda apagado y
 * la pista dice por qué. Es exactamente lo que el Modo Personal hace con la
 * transferencia: ofrecer el control y no fabricar un guardado que la frontera
 * rechazaría. Las tres razones están escritas en `SharedExpenseBlocker`.
 */
/**
 * De un importe ya escrito al estado del teclado que lo produciría.
 *
 * Sin decimales la máquina se queda en la parte entera —donde estaría quien
 * acaba de teclear «25»—; con ellos, dentro de la fracción. Un texto vacío o sin
 * parte entera devuelve la máquina en blanco, que es lo que quiere un alta.
 */
export function SharedExpenseForm({
  groupName,
  participants,
  currency,
  today,
  now,
  presetCategoryId,
  loading,
  categories,
  scopeId,
  currencyDefinitionId,
  declaredCurrency,
  onRecorded,
  initial,
  correction,
}: {
  readonly groupName: string;
  readonly participants: readonly GroupParticipant[];
  /** La divisa base del GRUPO. Todas las cuotas van en ella. */
  readonly currency: CurrencyDefinition;
  readonly today: CalendarDate;
  /**
   * LA HORA ACTUAL, `HH:MM` del reloj de pared, sembrada por la ruta como
   * `today`: el formulario no lee el reloj, recibe el instante. En una
   * corrección no se usa —manda la hora existente del borrador— y nunca se
   * sustituye por la hora de la edición.
   */
  readonly now: string;
  /**
   * La categoría PREESTABLECIDA del grupo, ya comprobada como utilizable por la
   * ruta, o `null` («Todas»). Sólo siembra un ALTA; una corrección conserva la
   * categoría del gasto y un borrador abierto no se toca.
   */
  readonly presetCategoryId: string | null;
  readonly loading: boolean;
  /** El catálogo real del actor, traído por la ruta. */
  readonly categories: CategoryCatalogue;
  /** El ámbito, para poder construir el payload de la frontera. */
  readonly scopeId: string;
  readonly currencyDefinitionId: string;
  /**
   * LA MONEDA DECLARADA de la operación que se corrige, ya resuelta, cuando no
   * es la del grupo (F11/ADR-003).
   *
   * Ausente en un alta y en una corrección en la moneda del grupo. La resuelve
   * la ruta contra el catálogo: sin su ESCALA no se puede ni leer el importe
   * guardado ni volver a escribirlo, y suponer dos decimales convertiría
   * 150 000 yenes en 1 500,00 de algo.
   */
  readonly declaredCurrency?: CurrencyDefinition;
  /** Qué hacer cuando el servidor confirma la escritura. */
  readonly onRecorded: () => void;
  /**
   * Con qué valores abre. Ausente en un alta: los pone `initialDraft`.
   *
   * En una corrección llegan ya leídos del servidor y **declarados**, nunca
   * deducidos de las cuotas resueltas.
   */
  readonly initial?: SharedExpenseDraft;
  /** Qué operación y versión se corrigen. Ausente en un alta. */
  readonly correction?: { readonly operationId: string; readonly expectedVersionId: string };
}) {
  const { t } = useTranslation();
  const format = useFormat();

  /*
   * EL IMPORTE VIVE EN SU PROPIA MÁQUINA, no en el borrador: `AmountEntry`
   * guarda la parte entera, la decimal y si el teclado está en una o en otra,
   * porque «10» y «10,» son estados distintos aunque valgan lo mismo.
   *
   * Por eso una corrección tiene que SEMBRARLA: pasar el borrador precargado y
   * dejar la máquina vacía enseñaba «0,00» sobre un gasto de 25 € — y al guardar
   * habría mandado ese cero. Medido en el emulador. El texto se parte por el
   * separador que `fromMinorUnits` produce, que es el punto.
   */
  const [entry, setEntry] = useState<AmountEntry>(() => seedAmountEntry(initial?.amount));
  const [draft, setDraft] = useState<SharedExpenseDraft>(
    () => initial ?? initialDraft(participants, today, now, presetCategoryId),
  );
  /*
   * ═══════ LA PREESTABLECIDA SE APLICA UNA VEZ, CUANDO SE PUEDE ═══════
   *
   * **El defecto que corrige.** El borrador se sembraba UNA vez, al montar, y
   * en ese instante el catálogo todavía no había llegado —`useEntryCategories`
   * arranca vacío y lee después—, así que la ruta no podía confirmar que la
   * preferencia fuera utilizable y sembraba `null`. El perfil SÍ traía la
   * categoría (medido: `default_category_id` correcto en la base y en la
   * lectura); lo que se perdía era el instante. Con la caché caliente
   * funcionaba a veces, que es lo peor que puede hacer un defecto.
   *
   * Dos estados, y ninguno es una ref leída en el render:
   * - `presetApplied`: ya se sembró una vez para ESTE borrador. Se aplica
   *   como mucho una vez; después el gasto es de la persona.
   * - `categoryTouched`: la persona eligió categoría a mano. Una elección
   *   manual manda aunque la preferencia llegue después.
   *
   * Se ajusta DURANTE el render, que es el patrón que React documenta para un
   * estado derivado de una entrada que cambia: vuelve a renderizar antes de
   * pintar, sin un fotograma con el icono equivocado ni un efecto que escriba
   * estado. Sólo en un ALTA (`initial` ausente): una corrección conserva la
   * categoría del gasto y nunca recibe la preferencia. Y sólo si el borrador
   * sigue sin categoría: nada de lo escrito se toca.
   */
  const [presetApplied, setPresetApplied] = useState(presetCategoryId !== null);
  const [categoryTouched, setCategoryTouched] = useState(false);
  const pending = presetToApply({
    editing: initial !== undefined,
    presetCategoryId,
    categoryId: draft.categoryId,
    applied: presetApplied,
    touched: categoryTouched,
  });
  if (pending !== null) {
    setPresetApplied(true);
    setDraft((previous) => ({ ...previous, categoryId: pending }));
  }
  const [picking, setPicking] = useState<'date' | 'time' | null>(null);
  const [kind, setKind] = useState<GroupKind>('expense');
  const writer = useRecordExpense();

  /*
   * QUIÉN ES QUIEN MIRA, por VÍNCULO y no por parecido.
   *
   * Sale de la lista de participantes, que es quien sabe de dónde vino cada uno.
   * Hoy sólo lo sabe de una creación que aún está en la cola de este aparato; la
   * lista remota no publica el vínculo, así que ahí nadie está marcado y esto es
   * `null`. Nunca se sustituye por una coincidencia de nombre ni por el primero.
   */
  const selfParticipantId = participants.find((one) => one.isSelf === true)?.participantId ?? null;

  /*
   * La lista puede llegar después —la remota tarda, la local no—, así que el
   * borrador se completa con quien aparezca y sin tocar lo ya elegido: sólo se
   * añaden los que no estaban. Rehacerlo entero borraría una selección hecha
   * mientras la consulta viajaba.
   */
  /*
   * LOS QUE SE LISTAN Y LOS QUE SE PROPONEN no son los mismos (F09/ADR-003 §5): un
   * retirado no se lista; un inactivo se lista, se puede elegir si la fecha lo
   * admite, y nunca se propone por defecto.
   */
  const shown = participants.filter(listed);
  const order = shown.map((one) => one.participantId);
  const proposed = shown.filter(activeByDefault).map((one) => one.participantId);
  const selected = draft.selected.length === 0 && !loading ? proposed : draft.selected;

  /*
   * ═══ EL PAGADOR POR DEFECTO ES QUIEN REGISTRA ═══
   *
   * Y sólo cuando se sabe quién es. Se resuelve al vuelo en vez de sembrarlo en
   * el borrador para que no se pise una elección hecha a mano: en cuanto alguien
   * toca el selector, `draft.payerId` deja de ser `null` y esto no vuelve a
   * mirar. Mientras la lista no diga quién es quien mira, queda sin resolver y se
   * elige a mano — que es lo único honesto que se puede hacer con un dato que no
   * se tiene.
   */
  const payerId = draft.payerId ?? selfParticipantId;

  /*
   * El importe vive en el editor y el borrador lo lee como texto canónico. Una
   * sola verdad: no hay un segundo importe guardado que pueda desincronizarse.
   */
  const current: SharedExpenseDraft = { ...draft, amount: amountValue(entry), selected, payerId };
  /*
   * EL CATÁLOGO QUE ESTA VENTANA OFRECE: sólo las categorías de Nomey.
   *
   * Se filtra aquí y no en quien lo carga, porque el catálogo es UNO y el alta
   * de un movimiento personal sigue ofreciendo las propias sin cambio alguno.
   * El servidor vuelve a exigir la misma condición, que es quien manda.
   */
  const shareable = sharedCategories(categories.rows);
  const categoryShareable =
    current.categoryId === null || shareable.some((row) => row.id === current.categoryId);

  /*
   * ═══════════ LA MONEDA DEL GASTO, QUE PUEDE NO SER LA DEL GRUPO ═══════════
   *
   * **Todo el reparto se calcula en ella, y eso es F11/ADR-003 y no una
   * comodidad**: lo declarado se valida en la moneda en la que la persona lo
   * escribió, y quien convierte el total y reparte después —una sola vez, y
   * siempre desde el importe original— es el servidor. Repartir aquí en la
   * moneda del grupo exigiría convertir en el cliente, que F11/ADR-001 §7
   * prohíbe.
   *
   * Arranca en la declarada de la operación que se corrige, si la hubo, y si no
   * en la del grupo. El catálogo sólo hace falta para CAMBIARLA.
   */
  const catalogue = useCurrencies(true);
  const options = catalogue.status === 'ready' ? catalogue.options : null;
  const [chosenId, setChosenId] = useState<string | null>(declaredCurrency?.id ?? null);
  const chosenOption = options?.find((one) => one.id === chosenId) ?? null;

  const declared: CurrencyDefinition =
    chosenOption !== null
      ? currencyDefinition({
          id: chosenOption.id,
          code: chosenOption.code,
          scale: chosenOption.scale,
        })
      : (declaredCurrency ?? currency);

  const outcome = computeSplit(current, declared, categories.unavailable, categoryShareable);

  const scale = declared.scale;
  const zero = format.number(0, { minimumFractionDigits: scale, maximumFractionDigits: scale });
  const cut = zero.search(/[^0-9]/);

  /*
   * LA CABECERA, IGUAL EN LOS DOS MODOS: clase y luego ámbito.
   *
   * El mismo orden que el alta de Inicio —selector de clase, después de dónde
   * sale el dinero— y el mismo rol tipográfico para el ámbito. Lo que cambia es
   * que aquí el ámbito es un nombre propio y no una palabra del catálogo.
   */
  const heading = (
    <>
      <ExpenseKindSelector value={kind} onChange={setKind} />
      <ThemedText variant="label" themeColor="textSecondary" style={styles.scope}>
        {groupName}
      </ThemedText>
    </>
  );

  /*
   * ═══ LIQUIDAR NO ES GASTAR, Y POR ESO NO REUTILIZA ESTE FORMULARIO ═══
   *
   * Una liquidación tiene deudor, acreedor e importe; no tiene pagador ni
   * reparto. Enseñar aquí el formulario de gasto con otra etiqueta sería
   * describir mal la operación, y rellenarlo no llevaría a ninguna parte: la
   * frontera existe —`api.record_debt_settlement`— pero no hay dónde leer las
   * deudas del grupo ni deudas que leer. Así que el modo dice qué hará y qué le
   * falta, y no pide nada que no pueda usar.
   */
  if (kind === 'transfer') {
    return (
      <View style={styles.transfer}>
        {heading}
        <EmptyState
          symbol={Symbols.transfer}
          title={t('group.transferTitle')}
          description={t(BLOCKER_KEY.transferNoRoute)}
        />
      </View>
    );
  }

  return (
    <>
      <AmountSheet
        header={heading}
        fields={
          <>
            <SharedExpenseFields
              draft={current}
              participants={shown.filter((one) => eligibleOn(one, current.date))}
              selfParticipantId={selfParticipantId}
              categories={shareable}
              onChangeConcept={(concept) => {
                setDraft((previous) => ({ ...previous, concept }));
              }}
              onChangeCategory={(categoryId) => {
                /* Elección manual: a partir de aquí la preferencia ya no manda. */
                setCategoryTouched(true);
                setDraft((previous) => ({ ...previous, categoryId }));
              }}
              onOpenDate={() => {
                setPicking('date');
              }}
              onChangePayer={(participantId) => {
                setDraft((previous) => setPayer({ ...previous, selected }, participantId, order));
              }}
              onChangeMode={(mode: SplitMode) => {
                // `Por partes` entra con una parte cada uno: es el reparto que ya
                // había, escrito en el vocabulario del método.
                setDraft((previous) => setMode({ ...previous, selected }, mode));
              }}
            />

            <SplitParticipantsCard
              participants={shown}
              draft={current}
              quotas={outcome.quotas}
              currency={declared}
              onToggle={(participantId) => {
                setDraft((previous) =>
                  toggleParticipant({ ...previous, selected }, participantId, order),
                );
              }}
              onAdjustShares={(participantId, delta) => {
                // Sin teclado: una parte más o menos, nunca por debajo de una.
                setDraft((previous) => adjustShares(previous, participantId, delta));
              }}
              onChangeAmount={(participantId, value) => {
                /*
                 * Escribir FIJA la cuota: entra en el mapa y deja de ser
                 * automática. Las demás automáticas se recalculan solas con el
                 * restante, porque salen del borrador en cada render; las
                 * fijadas no se tocan.
                 */
                setDraft((previous) => ({
                  ...previous,
                  amounts: { ...previous.amounts, [participantId]: value },
                }));
              }}
              onEqualize={() => {
                setDraft(equalizeAmounts);
              }}
            />

            {/*
             * CUÁNTO FALTA POR ASIGNAR, o cuánto sobra. Sólo en `Cantidad`, que
             * es el único método donde la persona puede no cuadrar: en los otros
             * dos el total lo reparte el dominio y siempre cuadra por
             * construcción. Y no se completa solo — decirlo es la alternativa a
             * corregirlo por su cuenta.
             */}
            {outcome.difference !== null && outcome.difference !== 0n ? (
              <ThemedText variant="caption" themeColor="negative" style={styles.note}>
                {outcome.difference > 0n
                  ? t('group.splitRemaining', {
                      amount: format.money(money(outcome.difference, declared)),
                    })
                  : t('group.splitOver', {
                      amount: format.money(money(-outcome.difference, declared)),
                    })}
              </ThemedText>
            ) : null}
          </>
        }
        entry={entry}
        onChangeEntry={setEntry}
        amountLabel={t('entry.amountLabel')}
        currency={{ code: declared.code, scale: declared.scale }}
        currencySymbol={currencySymbol(format.locale, declared.code, declared.scale)}
        decimalSeparator={cut === -1 ? '' : zero.slice(cut, cut + 1)}
        currencyLabel={t('group.expenseCurrencyPicked', { code: declared.code })}
        /* Sólo se ve si el catálogo no llegó: entonces no hay nada que elegir y
         * el gasto va en la del grupo, que es lo correcto. */
        currencyNote={t('group.expenseCurrencyUnavailable')}
        /*
         * El catálogo ENTERO, tenga o no cobertura de cambio esa moneda: qué
         * pares se pueden convertir un día dado lo decide la frontera
         * (F11/ADR-001 §6), y filtrarlo aquí sería fabricar esa regla en el
         * cliente.
         */
        currencyOptions={options}
        currencySelectedId={declared.id}
        onSelectCurrency={(option) => {
          setChosenId(option.id);
        }}
        hint={
          outcome.blocker !== null
            ? t(BLOCKER_KEY[outcome.blocker])
            : declared.id === currency.id
              ? null
              : /* Que se sepa ANTES de guardar que esto no queda en yenes. */
                t('group.expenseConverted', { code: currency.code })
        }
        /*
         * El motivo del RECHAZO, en castellano y sin cerrar la ventana: los
         * códigos de la frontera son contrato, no interfaz. Lo escrito sigue ahí
         * y se puede reintentar con la misma clave de comando.
         */
        error={
          writer.failure === null
            ? null
            : writer.failure === 'unreachable'
              ? t('group.expenseUnreachable')
              : t(REJECTION_KEY[writer.code ?? ''] ?? 'group.expenseRejected')
        }
        saveLabel={t('action.save')}
        /*
         * Apagado SIEMPRE, hoy: `computeSplit` no puede devolver `null` mientras
         * exista `noRoute`. No es una comprobación de más — es el punto exacto
         * en el que se encenderá cuando la frontera admita la escritura, y
         * quitarlo antes sería lo único que hace falta para fabricar un
         * guardado que no guarda.
         */
        saveDisabled={outcome.blocker !== null || writer.saving}
        saving={writer.saving}
        onSave={() => {
          /*
           * SE CIERRA SÓLO CON LA GARANTÍA. `record` devuelve `true` únicamente
           * cuando el servidor respondió que lo escribió; con cualquier otra cosa
           * la ventana se queda con el borrador entero y el motivo debajo.
           */
          void writer
            .record((clientOperationId) =>
              buildGroupExpensePayload(
                current,
                {
                  scopeId,
                  currencyDefinitionId: declared.id,
                  scale: declared.scale,
                  baseCurrencyDefinitionId: currencyDefinitionId,
                },
                clientOperationId,
                correction,
              ),
            )
            .then((ok) => {
              if (ok) onRecorded();
            });
        }}
      />

      <SharedExpenseDate
        visible={picking === 'date'}
        value={dateOf(current.date)}
        onSelect={(date) => {
          /*
           * CAMBIAR LA FECHA REVALIDA LA SELECCIÓN, sin inventar presencias.
           * Hoy `applyEligibility` no descarta a nadie porque nadie publica los
           * periodos; el día que lo hagan, esto ya los aplica.
           */
          setDraft((previous) =>
            applyEligibility({ ...previous, selected }, participants, calendarOf(date)),
          );
        }}
        /*
         * TRAS LA FECHA, LA HORA: el mismo control del sistema en modo hora.
         * Es como se consulta o se cambia —no hay un cuarto botón en la fila—
         * y encadena las dos hojas que ya existían. Un gasto histórico sin
         * hora abre el selector en la hora actual como punto de partida, pero
         * NO la escribe: sólo si la persona confirma pasa a tener hora.
         */
        onClose={() => {
          setPicking('time');
        }}
      />
      <SharedExpenseDate
        mode="time"
        visible={picking === 'time'}
        value={dateAtClockTime(current.time ?? now)}
        onSelect={(date) => {
          setDraft((previous) => ({ ...previous, time: clockTimeOf(date) }));
        }}
        onClose={() => {
          setPicking(null);
        }}
      />
    </>
  );
}

/**
 * `CalendarDate` ↔ `Date`, en el calendario del aparato.
 *
 * Local y no UTC: el par fecha+hora de una operación es un reloj de pared
 * (F06/ADR-002 §3), y tomarla en UTC pondría a media Europa una cena de las 22:30 al
 * día siguiente.
 */
function dateOf(value: CalendarDate): Date {
  const [year, month, day] = value.split('-');
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function calendarOf(value: Date): CalendarDate {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` as CalendarDate;
}

const styles = StyleSheet.create({
  scope: {
    textAlign: 'center',
  },
  /** El modo liquidación: la misma cabecera y una explicación, sin formulario. */
  transfer: {
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  note: {
    textAlign: 'center',
  },
});
