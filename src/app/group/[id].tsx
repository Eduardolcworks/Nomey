import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, LayoutAnimation, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { currencyDefinition, money } from '@/domain';
import {
  allOf,
  fetchPendingPairs,
  FilterPanel,
  type GroupOperation,
  GroupBalanceRow,
  type GroupOrder,
  GroupIdentityBar,
  type GroupPayment,
  GroupPaymentRow,
  SuggestedPaymentsCard,
  type SuggestedPayment,
  GroupMovementRow,
  groupPosition,
  GroupSummaryCard,
  groupSummary,
  isUnrestricted,
  current,
  mergeTimeline,
  type MovementFilters,
  type PendingPair,
  OrderSelector,
  publishGroupRecorded,
  sameFilters,
  subscribeGroupRecorded,
  useAnnulExpense,
  useGroupMovements,
  useGroupNotices,
  useGroupParticipants,
  useGroups,
  useRecordPayment,
  useRetireParticipant,
  useAssociateParticipant,
} from '@/features/groups';
import { useEntryCategories, useIncidents } from '@/features/personal';
import { useSession } from '@/features/session';
import { AddBackdrop, AppTopBar, BlurTarget, DOCK, useAddBackdrop } from '@/features/shell';
import { indexCategories, sharedCategories } from '@/lib/categories';
import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import {
  EmptyState,
  ErrorState,
  GlassSurface,
  Icon,
  IconButton,
  LoadingState,
  OptionPills,
  ThemedView,
} from '@/ui/components';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

/**
 * DENTRO DE UN GRUPO. **Y funciona sin red.**
 *
 * La ruta es la identidad DEFINITIVA del ámbito, la misma que el cliente generó
 * antes del primer intento y que el servidor conserva como `scope_id`. Por eso
 * un grupo recién creado se puede abrir en el mismo fotograma, sin haber hablado
 * con nadie: la identidad no cambia al confirmarse, así que el enlace no se
 * rompe cuando llega la confirmación, y un grupo todavía en la cola tiene
 * contenido en vez de un hueco.
 *
 * **Lee de la misma proyección que la lista**, no de una consulta propia. Nombre,
 * emoji, participantes, divisa y posición son exactamente los que la tarjeta
 * enseña, y no pueden discrepar porque son el mismo dato.
 *
 * ═══════════ LOS GASTOS SON REALES; LOS SALDOS, TODAVÍA NO ═══════════
 *
 * **Movimientos lee del servidor.** `api.group_operation` publica una fila por
 * operación con su versión vigente, y `api.group_summary` agrega las tres cifras
 * **en SQL**: sumarlas aquí sobre la página traída daría un total que parece
 * correcto y deja de serlo en cuanto PostgREST corte en `max_rows`.
 *
 * **La lista no tiene respaldo sin conexión, y no es un descuido.** Un gasto
 * compartido no pasa por la cola durable —se escribe contra la frontera o no se
 * escribe—, así que no hay una segunda fuente que consultar: sin red se dice
 * que no se pudo leer, en vez de enseñar una lista vacía que parecería un grupo
 * sin gastos.
 *
 * **Saldos sigue sin listado**, y su vacío sigue siendo el de antes: el detalle
 * por persona necesita la deuda participante a participante, que es otra
 * superficie y no está en esta tanda. La posición NETA de quien mira sí es real
 * — sale del mismo agregado que las otras dos cifras.
 *
 * **Los TRES controles que siguen sin flujo —participantes, compartir y
 * editar— se montan como dibujo y no como botones**: sin `Pressable`, sin rol y
 * fuera del recorrido de un lector de pantalla. Antes de cerrar F9 tienen que
 * ser controles reales o no publicarse.
 */
type Tab = 'movements' | 'balances';

/**
 * A QUÉ ALTURA VA EL `+`, Y DE DÓNDE SALE ESA ALTURA.
 *
 * **Del dock de Inicio, no del ojo.** Allí el `+` no se coloca: lo empuja lo que
 * el dock apila debajo de él. Su contenedor va `bottom: 0` con
 * `paddingBottom: insets.bottom + DOCK.edge`, y encima de ese borde quedan la
 * fila de destinos (`DOCK.bar`) y el hueco que la separa de la acción
 * (`DOCK.gap`). Es decir, el centro del `+` de Inicio está, medido desde el
 * fondo de la pantalla, a:
 *
 *     insets.bottom + DOCK.edge + DOCK.bar + DOCK.gap + DOCK.add / 2
 *
 * Esta pantalla **no lleva dock** —añadirlo para alinear sería traer una barra
 * de navegación que aquí no navega—, así que reproduce exactamente esa pila
 * menos el propio botón: el borde inferior del `+` se pone a `DOCK.edge +
 * DOCK.bar + DOCK.gap` del área segura, y como el botón mide `DOCK.add` igual
 * que allí, los dos centros coinciden.
 *
 * **No es un desplazamiento fijo del Pixel_7**: son los tokens del dock, así que
 * si mañana cambia el alto de una píldora, las dos alturas cambian juntas.
 */
const ADD_BOTTOM = DOCK.edge + DOCK.bar + DOCK.gap;

export default function GroupScreen() {
  const { t } = useTranslation();
  const format = useFormat();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const backdrop = useAddBackdrop();
  /*
   * Lo que hay que desenfocar cuando se abre la ventana: esta pantalla entera.
   * Android no desenfoca «lo de detrás» por composición — dibuja a partir de una
   * vista concreta— y la de las pestañas queda tapada por ésta.
   */
  const blurTarget = useRef<View | null>(null);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state: session } = useSession();
  const actorId = session.status === 'signed-in' ? session.identity.userId : '';

  const { groups } = useGroups(actorId, session.status);
  const incidents = useIncidents(actorId);
  /* Los avisos de grupo sin leer: el mismo hook y el mismo estado que la barra de las pestañas. */
  const notices = useGroupNotices(actorId);
  const group = groups.find((one) => one.scopeId === id);

  /*
   * EL ORDEN DE LA LISTA. Vive aquí, así que sobrevive a cambiar de pestaña
   * —ir a Saldos y volver conserva lo elegido— y se pierde al salir del grupo:
   * es una vista de ESTA visita, no una preferencia de la aplicación. Cada
   * entrada al grupo empieza por el gasto más reciente, que es lo que alguien
   * busca al abrirlo.
   */
  const [order, setOrder] = useState<GroupOrder>('dateDesc');

  /*
   * ═══════════ DOS ESTADOS DE FILTRO, Y NO UNO ═══════════
   *
   * `applied` es lo que la lista está enseñando; `draft` es lo que hay tocado
   * dentro del panel y todavía sin confirmar. Separarlos es lo que permite
   * abrir, toquetear y arrepentirse sin haber cambiado nada — y lo que evita
   * una consulta por cada fotograma mientras se arrastra la barra.
   *
   * **Empiezan sin restricción en cada entrada al grupo** y duran lo que dure
   * la visita: son una vista de ESTE rato, no una preferencia de la
   * aplicación, y esta tanda no añade persistencia.
   */
  const [applied, setApplied] = useState<MovementFilters>(allOf);
  const [draft, setDraft] = useState<MovementFilters>(allOf);
  const [panelOpen, setPanelOpen] = useState(false);

  /*
   * ═══════ EL GESTO DE VOLVER, APAGADO SÓLO MIENTRAS EL PANEL ESTÁ ABIERTO ═══════
   *
   * Arrastrar el extremo izquierdo de la barra de importes hacia la derecha es,
   * para iOS, un deslizamiento desde el borde: el reconocedor de retroceso de
   * la pila —nativo, de `react-native-screens`— se lo llevaba y la pantalla
   * empezaba a volver a Grupos con la barra a medias. Ese reconocedor **no
   * participa en el sistema de responders de JavaScript**: a la barra le llega
   * un `onResponderTerminate` y no hay nada que pueda contestar para quedárselo.
   *
   * La API de la pila no permite delimitar el gesto a un área: `gestureEnabled`
   * es de la RUTA entera. Así que se aplica la alternativa acotada: se apaga
   * **sólo mientras el panel de filtros está abierto** y se restaura al
   * cerrarlo. Fuera del panel, volver deslizando sigue funcionando igual; la
   * flecha de volver funciona siempre, porque no es un gesto.
   *
   * Un efecto y no una opción estática porque el estado cambia en vivo, y la
   * navegación tiene que enterarse en cada cambio.
   */
  const navigation = useNavigation();
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !panelOpen });
  }, [navigation, panelOpen]);

  const movements = useGroupMovements(id ?? '', session.status, order, applied);
  const participants = useGroupParticipants(id ?? '', actorId, session.status);

  /*
   * EL MAYOR GASTO DEL GRUPO, del conjunto completo y antes de filtrar ni
   * paginar. `null` mientras no se ha podido leer: la barra se apaga en vez
   * de fingir un tope de cero, que afirmaría que el mayor gasto vale nada.
   */
  const maxMinor = useMemo(() => {
    const raw = movements.totals?.maxTotalMinor;
    if (raw === null || raw === undefined || raw.trim() === '') return null;
    try {
      return BigInt(raw);
    } catch {
      return null;
    }
  }, [movements.totals?.maxTotalMinor]);

  /*
   * ¿LO APLICADO DEJA ALGO FUERA? Se pregunta por el EFECTO y no por si
   * alguien tocó algo: mover un extremo y devolverlo a su sitio no esconde
   * ningún gasto, así que el embudo no debe decir que sí.
   */
  const appliedFull = isUnrestricted(applied, maxMinor);

  /* Y ¿hay algo que confirmar? El borrador comparado con lo aplicado. */
  const pendingEdit = panelOpen && !sameFilters(draft, applied);

  /*
   * QUÉ FILA ESTÁ ABIERTA. Una sola, como en Inicio: abrir otra cierra la
   * anterior. Vive aquí y no en la fila para que eso sea posible sin que las
   * filas se hablen entre ellas.
   */
  const [openRow, setOpenRow] = useState<string | null>(null);
  const writer = useAnnulExpense();

  /*
   * Y SE CIERRA CUANDO SE ESCRIBE EN EL GRUPO. El desplegable enseña el detalle
   * de una versión; guardar una corrección la sustituye, y dejarlo abierto
   * sería mostrar el detalle viejo hasta que la relectura lo pise. Es el
   * mismo aviso que dispara esa relectura —el alta, la corrección y la
   * anulación pasan por él—, así que no hay una segunda forma de enterarse.
   */
  useEffect(
    () =>
      subscribeGroupRecorded((changed) => {
        if (changed === id) setOpenRow(null);
      }),
    [id],
  );

  /*
   * LOS NOMBRES DE LOS PARTICIPANTES, por su identidad contextual. La fila
   * necesita el del pagador; resolverlo con un mapa evita recorrer la lista
   * una vez por gasto.
   */
  /*
   * EL NOMBRE ACTUAL, también en el histórico (F09/ADR-009): un origen asociado a
   * otra identidad se nombra como su destino en repartos, gastos, pagos y
   * avisos. Los ids no cambian —los hechos siguen nombrando a quien figuraba—
   * y «Declarado por» sigue siendo la autoría real.
   */
  const participantNames = useMemo(() => {
    const own = new Map(
      participants.participants.map((one) => [one.participantId, one.displayName] as const),
    );
    return new Map(
      participants.participants.map(
        (one) =>
          [
            one.participantId,
            (one.mergedInto === null ? undefined : own.get(one.mergedInto)) ?? one.displayName,
          ] as const,
      ),
    );
  }, [participants.participants]);
  /* Y su presencia, para decir «Inactivo» en Saldos y ofrecer «Saldado». */
  const presenceOf = useMemo(
    () => new Map(participants.participants.map((one) => [one.participantId, one.presence])),
    [participants.participants],
  );
  /* Quién tiene cuenta, por la lectura real (`is_linked`): nunca por nombre ni presencia. */
  const linkedOf = useMemo(
    () => new Map(participants.participants.map((one) => [one.participantId, one.isLinked])),
    [participants.participants],
  );
  /* Y quién tiene historial (`has_history`): decide «Eliminar» o «Retirar». */
  const historyOf = useMemo(
    () => new Map(participants.participants.map((one) => [one.participantId, one.hasHistory])),
    [participants.participants],
  );
  /* La misma consulta como función estable, para que la propuesta no se rehaga por render. */
  const presenceLookup = useCallback(
    (participantId: string) => presenceOf.get(participantId) ?? null,
    [presenceOf],
  );
  /* Los del presente: retirados y salidos con cuenta conservan el nombre, nada más. */
  const listedCount = participants.participants.filter(current).length;
  /*
   * LA CRONOLOGÍA DE MOVIMIENTOS: gastos (ya filtrados y ordenados por el
   * servidor) y pagos registrados, mezclados en el orden elegido. Vacía
   * mientras los gastos no han llegado: sin ellos no hay lista que afirmar.
   */
  const timeline = useMemo(
    () =>
      movements.operations === null
        ? []
        : mergeTimeline(movements.operations, movements.payments ?? [], order),
    [movements.operations, movements.payments, order],
  );

  /*
   * ═══════ «SALDADO» SOBRE UNA PROPUESTA: registrar el pago (F09/ADR-007) ═══════
   *
   * La confirmación dice quién paga a quién y cuánto, y lo confirmado viaja
   * con la foto de netos que la pantalla enseñaba (`expected_positions`): si
   * bajo el cerrojo son otros, el servidor responde caducado, se relee y se
   * vuelve a proponer. El servidor descompone el pago sobre las obligaciones
   * vigentes y mueve la caja de los dos Personales; aquí no se calcula nada.
   *
   * «Saldado» sobre quien salió (`settle_participant`, F09/ADR-003 §4) ya no se
   * ofrece: con la regla de salida sin pendientes no hay a quién ofrecérselo.
   */
  const payment = useRecordPayment();
  const askPay = (proposal: SuggestedPayment) => {
    const balances = movements.balances;
    if (balances === null || group === undefined) return;
    const currency = currencyDefinition({
      id: group.currencyDefinitionId,
      code: group.currencyCode,
      scale: group.currencyScale,
    });
    const from = participantNames.get(proposal.from) ?? t('group.suggestSomeone');
    const to = participantNames.get(proposal.to) ?? t('group.suggestSomeone');
    const amount = format.money(money(proposal.minor, currency));
    Alert.alert(t('group.payTitle'), t('group.payBody', { from, to, amount }), [
      { text: t('action.cancel'), style: 'cancel' },
      {
        text: t('group.settleConfirm'),
        onPress: () => {
          void payment
            .record({
              scopeId: group.scopeId,
              currencyDefinitionId: group.currencyDefinitionId,
              payerParticipantId: proposal.from,
              receiverParticipantId: proposal.to,
              amountMinor: proposal.minor,
              balances,
            })
            .then((outcome) => {
              /*
               * Escrito o caducado, se relee: el pago cambia los saldos, la
               * propuesta y la caja de los dos Personales; y una foto vieja
               * sólo se arregla leyendo la nueva. El motivo es el de ESTE
               * intento (la promesa), no `payment.failure`, que aquí vale lo
               * de antes de pulsar.
               */
              if (outcome === 'recorded') {
                publishGroupRecorded(group.scopeId);
                return;
              }
              if (outcome === 'stale') {
                publishGroupRecorded(group.scopeId);
                Alert.alert(t('group.payStaleTitle'), t('group.payStale'), [
                  { text: t('action.close') },
                ]);
                return;
              }
              /*
               * «No se ha registrado nada» sólo cuando el servidor lo dijo (un
               * rechazo deshace la transacción entera). Sin respuesta no se
               * sabe: la clave se conserva y el reintento la reconcilia.
               */
              Alert.alert(
                t('group.payFailedTitle'),
                outcome === 'notApplicable'
                  ? t('group.payNotApplicable')
                  : outcome === 'offline'
                    ? t('group.payOffline')
                    : t('group.payFailed'),
                [{ text: t('action.close') }],
              );
            });
        },
      },
    ]);
  };

  /*
   * ═══════ ELIMINAR O RETIRAR A UN PARTICIPANTE SIN CUENTA ═══════
   *
   * Ampliación explícita de F09/ADR-003 §6 (migración `20260912140000`): la misma
   * retirada que «Saldado», sobre un participante ACTIVO declarado por su
   * nombre y SIN cuenta. La palabra la decide el historial: «Eliminar» si
   * ningún efecto lo nombra, «Retirar» si sí; por debajo nada se borra. Si
   * tiene pendientes por pares —neto cero incluido—, la confirmación los
   * detalla y dice que se resolverán sin mover dinero en Personal, como con
   * «Saldado»; pulsar «Eliminar» nunca cancela una deuda en silencio, porque
   * el servidor exige los pares que se enseñaron (SETTLEMENT_STALE si no). Y
   * comprueba bajo bloqueo que sigue sin cuenta: una reclamación concurrente
   * responde PARTICIPANT_LINKED y no se retira nada.
   */
  const retirement = useRetireParticipant();
  const askRetire = (participantId: string, displayName: string, hasHistory: boolean) => {
    void fetchPendingPairs(id ?? '', participantId)
      .then((pairs) => {
        showRetire(participantId, displayName, hasHistory, pairs);
      })
      .catch(() => {
        Alert.alert(t('group.retireFailedTitle'), t('group.retireFailed'), [
          { text: t('action.close') },
        ]);
      });
  };
  const showRetire = (
    participantId: string,
    displayName: string,
    hasHistory: boolean,
    pairs: readonly PendingPair[],
  ) => {
    const currency = currencyDefinition({
      id: group?.currencyDefinitionId ?? '',
      code: group?.currencyCode ?? '',
      scale: group?.currencyScale ?? 2,
    });
    const remove = !hasHistory && pairs.length === 0;
    const body =
      pairs.length === 0
        ? t(remove ? 'group.removeBody' : 'group.retireBody')
        : `${pairs
            .map((pair) =>
              t('group.settlePair', {
                debtor: participantNames.get(pair.debtorParticipantId) ?? '?',
                creditor: participantNames.get(pair.creditorParticipantId) ?? '?',
                amount: format.money(money(BigInt(pair.amountMinor), currency)),
              }),
            )
            .join('\n')}\n\n${t('group.retirePairsBody')}\n\n${t('group.retireBody')}`;
    Alert.alert(
      t(remove ? 'group.removeTitle' : 'group.retireTitle', { name: displayName }),
      body,
      [
        { text: t('action.cancel'), style: 'cancel' },
        {
          text: t(remove ? 'group.removeConfirm' : 'group.retireConfirm'),
          style: 'destructive',
          onPress: () => {
            void retirement.settle({ scopeId: id ?? '', participantId, pairs }).then((outcome) => {
              if (outcome === 'settled') return;
              if (outcome === 'stale') {
                Alert.alert(t('group.settleStaleTitle'), t('group.settleStale'), [
                  { text: t('action.close') },
                  {
                    text: t('action.retry'),
                    onPress: () => {
                      askRetire(participantId, displayName, hasHistory);
                    },
                  },
                ]);
                return;
              }
              if (outcome === 'linked') {
                Alert.alert(t('group.retireLinkedTitle'), t('group.retireLinked'), [
                  { text: t('action.close') },
                ]);
                return;
              }
              Alert.alert(t('group.retireFailedTitle'), t('group.retireFailed'), [
                { text: t('action.close') },
              ]);
            });
          },
        },
      ],
    );
  };

  /*
   * ═══════ «ME EQUIVOQUÉ DE PARTICIPANTE»: deshacer la propia reclamación ═══════
   *
   * F09/ADR-006. Sólo sobre la fila propia cuyo vínculo procede de una
   * reclamación. Se confirma antes; el servidor decide bajo el cerrojo: si hay
   * dinero registrado en el Personal como ese participante, lo rehúsa y dice
   * QUÉ lo impide (gastos pagados como él, transferencias), sin prometer un
   * camino. Al deshacerse, el grupo deja de llegar por RLS: se abandona la
   * pantalla y, si la invitación con la que se entró sigue en memoria, se
   * vuelve a «¿Quién eres?» por el mismo camino que un enlace pulsado; si no,
   * se pide una nueva. Lo hecho no se revierte por eso.
   */
  /*
   * ═══════ «ASOCIAR A MI CUENTA» (F09/ADR-009) ═══════
   *
   * Sobre un participante sin cuenta, activo y no asociado, cuando yo tengo
   * identidad en el grupo. La confirmación dice lo que se asume —sus gastos,
   * pagos y pendientes— y que no se deshace. Al confirmarse, participantes,
   * saldos, movimientos, Personal y Deudas se releen por el canal de
   * cualquier escritura del grupo; el servidor decide bajo el cerrojo.
   */
  const associating = useAssociateParticipant();
  const askAssociate = (participantId: string, displayName: string) => {
    Alert.alert(
      t('group.associateTitle', { name: displayName }),
      t('group.associateBody', { name: displayName, group: group?.displayName ?? '' }),
      [
        { text: t('action.cancel'), style: 'cancel' },
        {
          text: t('group.associateConfirm'),
          onPress: () => {
            void associating.associate({ scopeId: id ?? '', participantId }).then((outcome) => {
              if (outcome.kind === 'done') {
                participants.refresh();
                movements.retry();
                return;
              }
              if (outcome.kind === 'taken') {
                Alert.alert(t('group.associateTakenTitle'), t('group.associateTaken'), [
                  { text: t('action.close'), onPress: () => participants.refresh() },
                ]);
                return;
              }
              Alert.alert(t('group.associateFailedTitle'), t('group.associateFailed'), [
                { text: t('action.close') },
              ]);
            });
          },
        },
      ],
    );
  };
  /**
   * ELIMINAR, con la confirmación de Inicio y su misma disciplina.
   *
   * **Se pregunta ANTES y se anula después**, y la fila no se quita de la lista
   * hasta que el servidor lo ha confirmado: nada de retirarla primero y
   * devolverla si falla. Lo que la retira es la relectura.
   *
   * **Anular no borra nada** (F06/ADR-006): escribe una versión sin efectos, y
   * `current_version_id` sigue siendo la única autoridad sobre qué cuenta.
   */
  const askDelete = (operation: GroupOperation) => {
    Alert.alert(t('group.deleteExpense'), t('group.deleteExpenseBody'), [
      { text: t('action.cancel'), style: 'cancel' },
      {
        text: t('action.delete'),
        style: 'destructive',
        onPress: () => {
          void writer.annul(operation).then((done: boolean) => {
            if (done) {
              /*
               * Y se relee TODO lo que esa anulación puede haber movido: la
               * lista, las tres cifras y el Disponible de quien pagó, cuyo
               * efecto de caja desaparece con ella. El mismo canal que usa el
               * alta, así que no hay una segunda forma de invalidar.
               */
              publishGroupRecorded(id ?? '');
              setOpenRow(null);
              return;
            }
            /*
             * Cada rechazo con su causa (nunca todos a «vuelve a intentarlo»):
             * la deuda ya saldada, la obligación de quien salió (F09/ADR-008) o
             * un retirado (F09/ADR-003 §6); el resto, el genérico.
             */
            Alert.alert(
              t('group.deleteFailedTitle'),
              writer.code === 'SETTLEMENT_EXCEEDS_DEBT'
                ? t('group.deleteSettled')
                : writer.code === 'DEPARTED_OBLIGATION_CHANGED'
                  ? t('group.deleteDeparted')
                  : writer.code === 'PARTICIPANT_RETIRED'
                    ? t('group.deleteRetired')
                    : t('group.deleteFailedBody'),
              [{ text: t('action.close') }],
            );
          });
        },
      },
    ]);
  };

  /**
   * ELIMINAR UN PAGO: la misma anulación autoritativa (F06/ADR-006), con la
   * autorización de F09/ADR-007 C4 en el servidor —las dos partes, tengan o no
   * membresía—. Sobre un pago ajeno la frontera responde `NOT_AUTHORIZED` y
   * se dice; la deuda que el pago cerró reaparece en Saldos al releer.
   */
  const askDeletePayment = (transfer: GroupPayment) => {
    Alert.alert(t('group.deletePayment'), t('group.deletePaymentBody'), [
      { text: t('action.cancel'), style: 'cancel' },
      {
        text: t('action.delete'),
        style: 'destructive',
        onPress: () => {
          void writer.annul(transfer).then((done: boolean) => {
            if (done) {
              publishGroupRecorded(id ?? '');
              setOpenRow(null);
              return;
            }
            Alert.alert(
              t('group.deleteFailedTitle'),
              writer.code === 'NOT_AUTHORIZED'
                ? t('group.deletePaymentNotParty')
                : t('group.deleteFailedBody'),
              [{ text: t('action.close') }],
            );
          });
        },
      },
    ]);
  };

  /*
   * EL CATÁLOGO DE CATEGORÍAS, montado por la RUTA. `useEntryCategories` vive en
   * la otra feature y `features/groups` no puede leer de ella; una ruta sí. Es
   * el mismo catálogo que usa la ventana de añadir gasto, y por la misma razón:
   * el nombre de la categoría **no se copia dentro del gasto**, se resuelve
   * contra `api.category` para que renombrarla alcance al histórico (F06/ADR-003).
   */
  const categories = useEntryCategories(actorId);
  const categoryIndex = indexCategories(categories.rows);
  /* El filtro ofrece lo mismo que un gasto compartido admite: de sistema. */
  const shareable = sharedCategories(categories.rows);

  /*
   * La pestaña vive aquí, así que sobrevive a cambiar de pestaña y se pierde al
   * salir del grupo — que es lo correcto: es una vista de ESTE grupo, no una
   * preferencia de la aplicación. Cambiarla no remonta la pantalla: sólo cambia
   * qué se pinta debajo del selector.
   */
  const [tab, setTab] = useState<Tab>('movements');

  /* Volver a Grupos, y sólo a Grupos: nunca reabriendo el selector del `+`. */
  const back = () => {
    router.back();
  };

  return (
    <>
      {/*
       * EL FONDO DESENFOCADO VIVE AQUÍ, y tiene que vivir aquí.
       *
       * `AddBackdrop` ya existía, pero montado en `(tabs)/_layout.tsx`: encender
       * la señal desde esta pantalla ponía el fondo **dentro del árbol de las
       * pestañas**, que esta ruta cubre por completo — el desenfoque se dibujaba
       * detrás de una pantalla opaca y no se veía nada. Medido: la ventana abría
       * con el grupo nítido detrás.
       *
       * Así que esta pantalla monta su propia pareja, exactamente como el árbol
       * de las pestañas monta la suya: **el objetivo envuelve lo que hay que
       * emborronar y el fondo es su hermano**, porque una vista no puede ser su
       * propio objetivo. Sin objetivo, el método de Android avisa y degrada a
       * `none`, que es oscurecer y no desenfocar.
       *
       * Mismo mecanismo y mismos parámetros: `Scrim` con su intensidad por
       * defecto, la de las ventanas de Personal. Nada de esto toca el fondo del
       * dock ni ninguna otra superficie.
       */}
      <View
        style={styles.screen}
        importantForAccessibility={backdrop.visible ? 'no-hide-descendants' : 'auto'}>
        <BlurTarget target={blurTarget}>
          <ThemedView style={styles.screen}>
            <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
              {/*
               * La barra compartida, idéntica a la de Inicio y Grupos: el
               * punto es el MISMO hecho que allí —incidencias no vistas o
               * avisos de grupo sin leer—, leído por el mismo hook. Entrar o
               * salir de un grupo no lo apaga: lo apaga la campana.
               */}
              <AppTopBar alerts={incidents.unseen > 0 || notices.unread > 0} />

              {group === undefined ? (
                /*
                 * Sin grupo no se inventa uno. Pasa si el enlace llega de fuera, si la
                 * cuenta cambió, o si el grupo es de otra persona: la RLS no lo
                 * devuelve y la cola local tampoco lo tiene.
                 */
                <ScrollView contentContainerStyle={styles.body}>
                  <EmptyState
                    symbol={Symbols.groups}
                    title={t('group.unknown')}
                    description={t('group.unknownHint')}
                  />
                </ScrollView>
              ) : (
                <>
                  {/*
                   * EL CONTADOR ES DE PARTICIPANTES, no de membresías: sale de
                   * `useGroupParticipants`, que publica el contrato vigente
                   * —`api.group_participant`, o la creación local si el grupo
                   * aún no ha viajado— y se refresca tras cada edición por el
                   * mismo mecanismo. Mientras carga y no hay nada, `null`: el
                   * icono solo, sin un cero que afirme algo.
                   *
                   * EL LÁPIZ abre el editor, apilado como la ventana del gasto.
                   * Sin fila autoritativa (`pending`) no se ofrece: no hay
                   * testigo que declarar ni servidor que confirme.
                   */}
                  <GroupIdentityBar
                    emoji={group.emoji}
                    name={group.displayName}
                    participantCount={
                      participants.loading && participants.participants.length === 0
                        ? null
                        : listedCount
                    }
                    onBack={back}
                    onShare={
                      group.pending
                        ? undefined
                        : () => {
                            backdrop.show();
                            router.push({
                              pathname: '/share-group',
                              params: { id: group.scopeId },
                            });
                          }
                    }
                    onEdit={
                      group.pending
                        ? undefined
                        : () => {
                            backdrop.show();
                            router.push({ pathname: '/edit-group', params: { id: group.scopeId } });
                          }
                    }
                  />

                  <ScrollView
                    contentContainerStyle={[
                      styles.body,
                      { paddingBottom: DOCK.add + insets.bottom + Spacing.xl },
                    ]}>
                    {/*
                     * LAS TRES CIFRAS, YA REALES, y cada una por su contrato.
                     *
                     * `groupSummary` suma colecciones de importes exactos y
                     * devuelve «no interpretable» ante cualquiera que no sepa
                     * leer, así que un agregado ilegible NO se convierte en un
                     * cero. Sin resumen leído todavía se pasa `null`, que es
                     * exactamente «no se sabe» — y nunca cero, que es una
                     * afirmación sobre el dinero de alguien.
                     *
                     * **La posición ya no sale de la proyección de la lista**:
                     * aquella la derivaba de una colección vacía por estructura,
                     * y desde que hay gastos esa colección dejó de estar vacía.
                     * Las tres vienen ahora del MISMO agregado, así que no
                     * pueden discrepar entre ellas.
                     */}
                    <GroupSummaryCard
                      summary={groupSummary(
                        movements.totals === null
                          ? { kind: 'unavailable' }
                          : groupPosition([movements.totals.netPositionMinor]),
                        movements.totals === null ? null : [movements.totals.yourShareMinor],
                        movements.totals === null ? null : [movements.totals.totalMinor],
                      )}
                      currency={currencyDefinition({
                        id: group.currencyDefinitionId,
                        code: group.currencyCode,
                        scale: group.currencyScale,
                      })}
                    />

                    <OptionPills
                      options={[
                        { key: 'movements', label: t('group.tabMovements') },
                        { key: 'balances', label: t('group.tabBalances') },
                      ]}
                      value={tab}
                      onChange={setTab}
                    />

                    {/*
                     * Los dos vacíos, y ninguno inventa nada. El listado real llegará
                     * con el motor de gastos y consumirá los contratos ya tipados
                     * —`GroupMovement` y `GroupBalanceRow`—, cuyas colecciones están
                     * vacías porque el grupo no tiene operaciones, no porque falte el
                     * dato.
                     */}
                    {tab === 'movements' ? (
                      <>
                        {/*
                         * LOS DOS CONTROLES DE LA LISTA, y son DOS porque son
                         * dos preguntas: filtrar quita filas, ordenar sólo las
                         * recoloca. Van encima del listado y también sobre su
                         * vacío — esconderlos cuando no hay gastos los haría
                         * aparecer y desaparecer solos.
                         *
                         * El círculo es el de siempre: 44 pt, el material de
                         * control y el radio completo. Ni un token nuevo.
                         */}
                        <View style={styles.controls}>
                          <IconButton
                            /*
                             * EL EMBUDO SE VUELVE TICK EN CUANTO SE TOCA ALGO.
                             * Con el borrador igual a lo aplicado no hay nada
                             * que confirmar, así que sigue siendo un embudo y
                             * cierra conservando lo puesto; en cuanto difieren,
                             * pulsarlo APLICA. El nombre accesible cambia con
                             * él: un icono que cambia de forma sin cambiar de
                             * nombre no le dice nada a quien no lo ve.
                             */
                            name={pendingEdit ? Symbols.confirm : Symbols.filter}
                            /* Con contenedor, como el de ordenar: los dos son
                             * el mismo control y tienen que leerse igual. */
                            filled
                            label={
                              pendingEdit
                                ? t('group.filterApply')
                                : panelOpen
                                  ? t('group.filterClose')
                                  : appliedFull
                                    ? t('group.filterTitle')
                                    : t('group.filterActive')
                            }
                            /*
                             * Amarillo cuando hay algo que confirmar y cuando
                             * lo aplicado deja gastos fuera. Apagado si la
                             * selección equivale a enseñarlo todo.
                             */
                            colour={pendingEdit || !appliedFull ? theme.accent : undefined}
                            selected={panelOpen}
                            onPress={() => {
                              /* Suave y sin remontar: lo único que cambia es
                               * la altura de una tarjeta del propio scroll. */
                              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                              if (!panelOpen) {
                                /* Abrir RECUPERA lo aplicado: el panel enseña
                                 * lo que la lista tiene puesto, no lo último
                                 * que alguien dejó a medias. */
                                setDraft(applied);
                                setPanelOpen(true);
                                return;
                              }
                              if (pendingEdit) setApplied(draft);
                              setPanelOpen(false);
                            }}
                          />

                          {/*
                           * Y ordenar, que abre DIRECTAMENTE su menú del
                           * sistema: no hay panel que desplegar porque no hay
                           * nada que confirmar. Ordenar no toca los filtros.
                           */}
                          <OrderSelector value={order} onChange={setOrder} />
                        </View>

                        {panelOpen ? (
                          <FilterPanel
                            draft={draft}
                            onChange={setDraft}
                            maxMinor={maxMinor}
                            currency={currencyDefinition({
                              id: group.currencyDefinitionId,
                              code: group.currencyCode,
                              scale: group.currencyScale,
                            })}
                            categories={shareable}
                            participants={participants.participants}
                            restricted={!appliedFull}
                          />
                        ) : null}

                        {movements.operations === null ? (
                          movements.failed ? (
                            <ErrorState
                              title={t('group.movementsFailed')}
                              description={t('group.movementsFailedHint')}
                              retry={{ label: t('action.retry'), onPress: movements.retry }}
                            />
                          ) : (
                            <LoadingState label={t('group.movementsLoading')} />
                          )
                        ) : timeline.length === 0 ? (
                          /*
                           * TRES ESTADOS Y NO DOS. «Este grupo no tiene
                           * movimientos» y «ninguno coincide con el filtro»
                           * son cosas distintas, y decir la primera sobre la
                           * segunda haría creer que el grupo está vacío. Lo
                           * que las separa es `expenseCount`, que el resumen
                           * publica SIN filtrar; el tercero —no se pudo leer—
                           * es el bloque de error de arriba.
                           */
                          (movements.totals?.expenseCount ?? 0) > 0 ? (
                            <EmptyState
                              symbol={Symbols.search}
                              title={t('group.noMatches')}
                              description={t('group.noMatchesHint')}
                            />
                          ) : (
                            <EmptyState
                              symbol={Symbols.empty}
                              title={t('group.noMovements')}
                              description={t('group.noMovementsHint')}
                            />
                          )
                        ) : (
                          /*
                           * UNA SOLA CRONOLOGÍA (`mergeTimeline`): gastos y pagos
                           * registrados («Saldado», F09/ADR-007) en el orden
                           * elegido, por la fecha y la hora reales de cada
                           * operación y con el desempate estable; nunca
                           * agrupados por tipo. Los pagos siguen FUERA de los
                           * filtros —categoría, pagador e importe hablan de un
                           * gasto— y el anulado se lista con su marca.
                           */
                          <View>
                            {timeline.map((entry) => {
                              return entry.kind === 'payment' ? (
                                <GroupPaymentRow
                                  key={entry.payment.operationId}
                                  payment={entry.payment}
                                  participants={participantNames}
                                  me={
                                    movements.balances?.find((row) => row.isSelf)?.participantId ??
                                    null
                                  }
                                  expanded={openRow === entry.payment.operationId}
                                  deleting={writer.pending === entry.payment.operationId}
                                  onToggle={() => {
                                    LayoutAnimation.configureNext(
                                      LayoutAnimation.Presets.easeInEaseOut,
                                    );
                                    setOpenRow((open) =>
                                      open === entry.payment.operationId
                                        ? null
                                        : entry.payment.operationId,
                                    );
                                  }}
                                  onDelete={() => {
                                    askDeletePayment(entry.payment);
                                  }}
                                  currency={currencyDefinition({
                                    id: group.currencyDefinitionId,
                                    code: group.currencyCode,
                                    scale: group.currencyScale,
                                  })}
                                />
                              ) : (
                                <GroupMovementRow
                                  key={entry.operation.operationId}
                                  operation={entry.operation}
                                  categories={categoryIndex}
                                  participants={participantNames}
                                  expanded={openRow === entry.operation.operationId}
                                  deleting={writer.pending === entry.operation.operationId}
                                  onToggle={() => {
                                    /* Suave y sin remontar la lista: lo único que
                                     * cambia es el alto de una fila. */
                                    LayoutAnimation.configureNext(
                                      LayoutAnimation.Presets.easeInEaseOut,
                                    );
                                    setOpenRow((open) =>
                                      open === entry.operation.operationId
                                        ? null
                                        : entry.operation.operationId,
                                    );
                                  }}
                                  onEdit={() => {
                                    /*
                                     * LA MISMA VENTANA DEL ALTA, con la operación
                                     * que corrige. No es otra pantalla ni otro
                                     * formulario: lo que cambia es que llega
                                     * precargada y que al guardar manda
                                     * `expected_version_id`.
                                     */
                                    backdrop.show();
                                    router.push({
                                      pathname: '/group-expense',
                                      params: {
                                        groupId: group.scopeId,
                                        operationId: entry.operation.operationId,
                                      },
                                    });
                                  }}
                                  onDelete={() => {
                                    askDelete(entry.operation);
                                  }}
                                  currency={currencyDefinition({
                                    id: group.currencyDefinitionId,
                                    code: group.currencyCode,
                                    scale: group.currencyScale,
                                  })}
                                />
                              );
                            })}
                          </View>
                        )}
                      </>
                    ) : movements.balances === null ? (
                      /* Cargando y error se dicen distinto de «todo a cero». */
                      movements.failed ? (
                        <ErrorState
                          title={t('group.movementsFailed')}
                          description={t('group.movementsFailedHint')}
                          retry={{ label: t('action.retry'), onPress: movements.retry }}
                        />
                      ) : (
                        <LoadingState label={t('group.movementsLoading')} />
                      )
                    ) : movements.balances.length === 0 ? (
                      <EmptyState
                        symbol={Symbols.confirm}
                        title={t('group.allSettled')}
                        description={t('group.allSettledHint')}
                      />
                    ) : (
                      /*
                       * SALDOS NO SE FILTRA. Los filtros de Movimientos acotan qué
                       * gastos se ven, no quién debe cuánto: una posición acotada
                       * por un intervalo de importe no sería la de nadie.
                       */
                      <View>
                        {movements.balances.map((balance) => {
                          const presence = presenceOf.get(balance.participantId) ?? null;
                          const inactive = presence !== null && !presence.isActive;
                          return (
                            <GroupBalanceRow
                              key={balance.participantId}
                              balance={balance}
                              currency={currencyDefinition({
                                id: group.currencyDefinitionId,
                                code: group.currencyCode,
                                scale: group.currencyScale,
                              })}
                              inactive={inactive}
                              linked={linkedOf.get(balance.participantId) === true}
                              /*
                               * El menú al tocar: sobre un participante sin
                               * cuenta y activo («Eliminar»/«Retirar», por la
                               * lectura real), y sobre la fila PROPIA cuando el
                               * vínculo procede de una reclamación («Me
                               * equivoqué», F09/ADR-006). Inactivos y las cuentas de
                               * otros no lo llevan.
                               */
                              menu={
                                linkedOf.get(balance.participantId) === false &&
                                !inactive &&
                                !retirement.settling
                                  ? [
                                      /*
                                       * «Asociar a mi cuenta» sólo con identidad
                                       * propia en el grupo (F09/ADR-009): sin ella no
                                       * hay a qué asociar, y el servidor lo rehúsa.
                                       */
                                      ...((movements.balances ?? []).some((one) => one.isSelf) &&
                                      !associating.busy
                                        ? [
                                            {
                                              id: 'associate',
                                              title: t('group.associate'),
                                              icon: Symbols.person,
                                            },
                                          ]
                                        : []),
                                      {
                                        id: 'retire',
                                        title: t(
                                          historyOf.get(balance.participantId) === true
                                            ? 'group.retireParticipant'
                                            : 'group.removeParticipant',
                                        ),
                                        icon: Symbols.delete,
                                        destructive: true,
                                      },
                                    ]
                                  : /*
                                     * La fila PROPIA no tiene menu: la identidad en el grupo es
                                     * permanente (F10/ADR-002) y salir es «Salir del grupo».
                                     */
                                    undefined
                              }
                              onMenuSelect={(action) => {
                                if (action === 'associate') {
                                  askAssociate(balance.participantId, balance.displayName);
                                }
                                if (action === 'retire') {
                                  askRetire(
                                    balance.participantId,
                                    balance.displayName,
                                    historyOf.get(balance.participantId) === true,
                                  );
                                }
                              }}
                            />
                          );
                        })}

                        {/*
                         * «PAGOS SUGERIDOS», bajo la lista y de los MISMOS saldos:
                         * el conjunto entero, sin filtros, releído con cada escritura.
                         * «Saldado» sobre una propuesta mía registra ese pago.
                         */}
                        <SuggestedPaymentsCard
                          balances={movements.balances}
                          presenceOf={presenceLookup}
                          reopened={movements.reopened ?? []}
                          onSettle={askPay}
                          /*
                           * Al menos una parte con cuenta (20260913130000): la
                           * caja va sólo al Personal que existe, y quien declara
                           * es esa parte. Entre dos sin cuenta no hay quien declare.
                           */
                          canSettle={(proposal) =>
                            linkedOf.get(proposal.from) === true ||
                            linkedOf.get(proposal.to) === true
                          }
                          settling={payment.recording}
                          currency={currencyDefinition({
                            id: group.currencyDefinitionId,
                            code: group.currencyCode,
                            scale: group.currencyScale,
                          })}
                        />
                      </View>
                    )}
                  </ScrollView>

                  {/*
                   * EL `+`, YA COMO CONTROL: abre la ventana de añadir gasto compartido.
                   *
                   * **Su propia ruta, y no `/add`.** Aquélla es el alta del Modo
                   * Personal —selector de clase, categoría, ámbito personal y una cola
                   * de `personal_expense.create`—; abrirla desde un grupo habría
                   * arrancado el flujo de Personal con otro rótulo.
                   *
                   * **El fondo se desenfoca igual que en Inicio**, y lo enciende quien
                   * abre: la ruta lo apaga sola al desmontarse, de modo que el gesto del
                   * sistema y el Atrás de hardware quedan cubiertos por la misma
                   * limpieza.
                   *
                   * El material es el del dock y sin su halo, que es lo que ya estaba
                   * validado; lo que cambia es que ahora recibe el toque y se anuncia.
                   */}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('group.expenseTitle')}
                    onPress={() => {
                      backdrop.show();
                      router.push({
                        pathname: '/group-expense',
                        params: { groupId: group.scopeId },
                      });
                    }}
                    style={[styles.action, { bottom: ADD_BOTTOM + insets.bottom }]}>
                    {({ pressed }) => (
                      <GlassSurface
                        level="action"
                        /* El mismo hundido que el del dock al pulsarlo. */
                        depth={pressed ? 'pressed' : 'flat'}
                        radius={Radius.full}
                        /* Sin halo exterior: aquí no hay fondo negro que lo justifique. */
                        lens="inner"
                        nativeEffect={false}
                        style={styles.add}>
                        <Icon name={Symbols.add} size={28} colour={theme.accent} />
                      </GlassSurface>
                    )}
                  </Pressable>
                </>
              )}
            </SafeAreaView>
          </ThemedView>
        </BlurTarget>
      </View>

      {/* Y el fondo DESPUÉS del objetivo: lo cubre y lo desenfoca entero. */}
      <AddBackdrop target={blurTarget} />
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  body: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  /** Los dos círculos, pegados a la izquierda. */
  controls: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  action: {
    position: 'absolute',
    alignSelf: 'center',
  },
  add: {
    width: DOCK.add,
    height: DOCK.add,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
