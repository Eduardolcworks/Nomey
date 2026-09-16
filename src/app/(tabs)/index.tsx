import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BalanceCard,
  CategoryCard,
  categorySlices,
  FlowCard,
  type DebtSnapshot,
  homeDebt,
  INITIAL_INTERVAL,
  IntervalSelector,
  type IntervalKind,
  isReconciled,
  isResolving,
  movementKind,
  type ExpenseLine,
  expenseLines,
  MovementRow,
  ShareRow,
  shareKey,
  type ProjectedOperation,
  readyScope,
  resolveInterval,
  todayInDeviceCalendar,
  useAnnulMovement,
  usePersonalHome,
  usePersonalScope,
  useProjectedHome,
} from '@/features/personal';
import {
  positionAcross,
  type ProjectedGroup,
  type ReopenedDebt,
  useGroups,
} from '@/features/groups';
import { GuestSignUp } from '@/features/auth';
import { isGuest, useSession } from '@/features/session';
import { DOCK_HEIGHT, HomeGreeting, useAddBackdrop, useScope } from '@/features/shell';
import { useTranslation } from '@/lib/i18n';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Section,
  ThemedText,
  ThemedView,
} from '@/ui/components';
import { Spacing, Symbols } from '@/ui/theme';

/**
 * Inicio: de quién es el dinero, cuánto queda, y qué ha pasado.
 *
 * **La ruta compone y no decide.** El ámbito lo asegura `usePersonalScope`, los
 * datos los trae `usePersonalHome`, y las cifras las deriva el servidor. Aquí
 * sólo se junta lo que ninguna feature puede juntar por su cuenta —la sesión y
 * el shell no pueden importarse entre sí— que es exactamente para lo que existe
 * una ruta.
 *
 * **Nada se pinta hasta que el Modo Personal está.** Es el cuarto requisito de
 * la obligación de F6.E, y el que evita el fallo silencioso: una pantalla que
 * asuma el ámbito antes de tiempo lee cero filas y enseña ceros creíbles sin que
 * nada falle. Por eso `isResolving` bloquea el contenido entero en vez de dejar
 * que cada tarjeta se las arregle.
 *
 * **Editar, eliminar y ajustar existen y todavía no hacen nada**, a propósito:
 * la escritura es de F6.F y no se adelanta sólo porque la pantalla ya dibuje
 * los botones. Lo que hoy responden es que aún no están, sin fingir lo
 * contrario.
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { state } = useSession();
  /* Una sesion anonima real (`is_anonymous`): Inicio es «Crea tu cuenta». */
  const guest = isGuest(state);
  const guestName = state.status === 'signed-in' ? state.identity.displayName : null;
  const guestPendingEmail = state.status === 'signed-in' ? state.identity.pendingEmail : null;
  const { scope: activeScope } = useScope();
  const router = useRouter();
  const backdrop = useAddBackdrop();

  /*
   * Personal y Pareja son DOS CONJUNTOS DE LIBROS, no dos filtros sobre uno.
   *
   * Hasta ahora la pantalla ignoraba el selector y pintaba el Modo Personal
   * bajo las dos etiquetas, que es el peor fallo posible de un selector de
   * ámbito: enseñaba cifras reales de un ámbito bajo el nombre de otro, sin que
   * nada fallara. `ScopeProvider` ya avisaba de ese riesgo por escrito.
   *
   * El Modo Pareja es de Duo Premium y no existe todavía, así que su contenido
   * queda VACÍO: no se reutiliza nada de Personal, no se inventa nada de
   * Pareja, y no se adelanta ninguna llamada a Premium que nadie ha decidido.
   */
  const personal = activeScope === 'personal';

  /*
   * La identidad va a los hooks porque la copia local del catálogo y el ámbito
   * de respaldo se guardan POR CUENTA (F07/ADR-001 §13, §16). La ruta es quien la
   * tiene: `features/` no puede importar `features/`, así que Inicio es el
   * único sitio que ve la sesión y el Modo Personal a la vez — el mismo motivo
   * por el que `ScopeProvider` recibe la identidad desde `app/_layout.tsx`.
   *
   * Sin sesión va cadena vacía, y nada se escribe ni se lee de la casilla de
   * nadie: un actor vacío guardaría en una que luego podría leer cualquiera.
   */
  const actorId = state.status === 'signed-in' ? state.identity.userId : '';

  const scope = usePersonalScope(actorId);
  const [interval, setIntervalKind] = useState<IntervalKind>(INITIAL_INTERVAL);
  const [openFlow, setOpenFlow] = useState<'income' | 'expense' | null>(null);
  const [openMovement, setOpenMovement] = useState<string | null>(null);

  /*
   * El intervalo se resuelve contra el calendario DEL DISPOSITIVO, no contra
   * UTC: `effective_date` no tiene zona y el par fecha+hora es un reloj de
   * pared local (F06/ADR-002 §3). Con UTC, después de las 22:00 en España un
   * movimiento de hoy dejaría de aparecer en `Día`, y no fallaría nada.
   */
  const today = todayInDeviceCalendar();
  const range = useMemo(() => resolveInterval(interval, today), [interval, today]);

  const ready = readyScope(scope.state);
  /*
   * Y con Pareja activo NO se consulta nada de Personal: el hook recibe `false`
   * y sus dos efectos salen antes de pedir nada. No es una optimización, es la
   * misma separación — un ámbito que no se está mirando no genera tráfico sobre
   * las finanzas de otro.
   *
   * `usePersonalScope` SÍ sigue montado, y es correcto: el provisioning asegura
   * el Modo Personal de la cuenta y no depende de qué pestaña se esté mirando.
   * Es idempotente por estado y corre una sola vez.
   */
  const home = usePersonalHome(ready !== null && personal, range, actorId);

  /*
   * LO QUE SE PINTA ES LA PROYECCIÓN, no el snapshot (F07/ADR-001 §8): el saldo,
   * los totales, el reparto y la lista salen de UNA función pura que suma al
   * snapshot del servidor las intenciones locales todavía no reconciliadas, con
   * las mismas funciones de dominio que reproduce la frontera. Un movimiento
   * recién guardado aparece aquí igual que uno confirmado, y la confirmación no
   * cambia ni un píxel. Las escrituras siguen leyendo `home`: ninguna cifra
   * proyectada alimenta un comando (§10).
   */
  const projected = useProjectedHome(home, ready, range, actorId);

  /*
   * ══════════ LAS DEUDAS DE INICIO SALEN DE LOS GRUPOS ══════════
   *
   * **Y por eso se leen AQUI y no dentro de Personal.** Una deuda del actor
   * no vive en su ambito personal: vive en el ambito de cada grupo, atribuida
   * por `core.participant_user_link`. `features/personal` no puede importar
   * `features/groups` —la frontera de `AGENTS.md` lo prohibe y con razon: no
   * son el mismo dominio—, asi que quien las junta es la ruta, que es el unico
   * sitio que ya conoce a los dos.
   *
   * **Es la MISMA lectura que pinta las tarjetas de Grupos**, no una segunda:
   * `net_position` de `api.group_summary`, la misma columna que el interior
   * del grupo enseña. Tres pantallas, un hecho. Con tres formulas distintas
   * habria tres saldos y ninguna forma de saber cual miente.
   */
  const groups = useGroups(actorId, state.status);

  useRefreshOnReturn(home.refresh);
  /*
   * **El mismo mecanismo de refresco que ya existia**, no uno nuevo: al volver
   * a Inicio y al recuperar foco. Sin esto, registrar un gasto compartido y
   * volver dejaria la deuda anterior en pantalla, que es una cifra caducada
   * presentada como actual.
   */
  useRefreshOnReturn(groups.refresh);

  const greetingName = state.status === 'signed-in' ? state.identity.displayName : null;

  const premium = () => {
    Alert.alert(t('home.calendarLabel'), t('home.calendarPremium'), [
      { text: t('action.understood') },
    ]);
  };

  /*
   * ELIMINAR UN MOVIMIENTO, de principio a fin y en un solo sitio.
   *
   *   fila (gesto o acción accesible)
   *     -> confirmación
   *       -> anulación canónica  (api.annul_operation, F06/ADR-006)
   *         -> refresco de Inicio
   *
   * **La ruta orquesta y no escribe**, igual que con «Añadir movimiento»: el
   * hook conoce el writer y la idempotencia, la fila conoce el gesto, y esto
   * junta las dos cosas con la confirmación en medio. La llamada RPC no está
   * enterrada en ningún componente visual.
   *
   * **Conservador a propósito, y es lo que se pidió.** La fila no desaparece
   * hasta que el servidor ha confirmado: nada de quitarla primero y devolverla
   * si falla. Con dinero, ver desaparecer un gasto que sigue existiendo es
   * peor que esperar medio segundo.
   */
  const annulling = useAnnulMovement();

  /*
   * LOS DOS BLOQUEOS TEMPORALES DE F07/ADR-001 §10, explicados y no mudos.
   *
   * Una fila que todavía no tiene versión vigente no puede corregirse ni
   * anularse —no hay CAS que enviar—, y mientras haya intenciones sin
   * reconciliar «Fijar el Disponible» declararía un saldo ambiguo. El control
   * sigue ahí y responde; lo que dice es que hay una espera y cuándo acaba.
   */
  const rowBlocked = () => {
    Alert.alert(t('home.rowBlockedTitle'), t('home.rowBlockedBody'), [
      { text: t('action.understood') },
    ]);
  };

  const deleteMovement = (operation: ProjectedOperation) => {
    if (!isReconciled(operation)) {
      rowBlocked();
      return;
    }
    Alert.alert(
      t('home.deleteMovement'),
      /* Un pago de grupo: se dice qué vuelve a estar pendiente (F09/ADR-007 C4). */
      t(
        operation.operation_class === 'group_payment'
          ? 'home.deletePaymentBody'
          : 'home.deleteMovementBody',
      ),
      [
        { text: t('action.cancel'), style: 'cancel' },
        {
          text: t('action.delete'),
          style: 'destructive',
          onPress: () => {
            void annulling.annul(operation).then((done) => {
              /*
               * **El refresco es lo único que hace desaparecer la fila.** No se
               * recalcula nada aquí: se vuelve a pedir todo a las superficies de
               * lectura, y el movimiento ya no sale porque su versión vigente es
               * una anulación sin efectos. Saldo, totales del intervalo y reparto
               * por categoría se rehacen con el mismo viaje.
               */
              if (done) {
                home.refresh();
                return;
              }

              /*
               * Y si falla, el movimiento sigue donde estaba y se dice en
               * castellano, no con el código de la frontera. Se puede reintentar
               * sin más: la clave de idempotencia es la misma, así que un
               * segundo intento del mismo comando no puede escribir dos veces.
               */
              Alert.alert(t('home.deleteFailedTitle'), t('home.deleteFailedBody'), [
                { text: t('action.understood') },
              ]);
            });
          },
        },
      ],
    );
  };

  /*
   * CORREGIR ESTE MOVIMIENTO. Ruta propia, lógica propia.
   *
   * **Y NO `/edit-balance`.** Aquella fue la prueba visual que sirvió para fijar
   * qué ventana queríamos; hacerla definitiva habría significado que corregir
   * un gasto fijara el saldo, que es otra cosa completamente distinta. La
   * ventana se comparte, la lógica no.
   *
   * **La identidad es `operation_id` + versión vigente**, y nada más: ni la
   * posición en la lista, ni el concepto, ni el importe, ni el signo. El par es
   * lo que el CAS del servidor comprueba antes de encadenar la corrección.
   *
   * Se manda `original_amount` y no `balance_amount`: el editor pide la magnitud
   * declarada, y el signo lo pone la clase. Todo viaja como TEXTO, así que
   * ningún `number` toca el dinero.
   */
  const editMovement = (operation: ProjectedOperation) => {
    if (!isReconciled(operation)) {
      rowBlocked();
      return;
    }
    backdrop.show();
    router.push({
      pathname: '/edit-movement',
      params: {
        operationId: operation.operation_id,
        versionId: operation.current_version_id,
        kind: operation.operation_class === 'personal_income' ? 'income' : 'expense',
        amount: operation.original_amount,
        // LA ESCALA VIAJA CON EL IMPORTE. Unas unidades minimas sin su escala no
        // son una cifra: 4280 es 42,80 con escala 2 y 4.280 con escala 0. Aqui
        // se conoce ya —el lapiz solo existe con el ambito resuelto—, asi que la
        // ventana no tiene que esperar a resolverlo otra vez para dibujarla.
        scale: String(ready?.currencyScale ?? 2),
        concept: operation.concept ?? '',
        categoryId: operation.category_id ?? '',
        date: operation.effective_date,
        // Sin hora registrada se deja vacía: un nulo NO significa medianoche
        // (F06/ADR-002 §3), y rellenarlo inventaría un hecho.
        time: operation.effective_time === null ? '' : operation.effective_time.slice(0, 5),
      },
    });
  };

  /*
   * FIJAR EL DISPONIBLE, que es lo contrario: declarar cuánto hay.
   *
   * **El fondo se enciende ANTES de navegar**, igual que el `+`: así el
   * desenfoque ya está puesto cuando la ventana empieza a subir, y no se ve un
   * fotograma de Inicio nítido detrás de ella. Se manda el Disponible actual en
   * unidades mínimas, tal cual llega de `api.personal_balance`; ninguna cifra se
   * recalcula aquí.
   *
   */
  const editBalance = () => {
    if (projected.unreconciled > 0) {
      Alert.alert(t('home.adjustBlockedTitle'), t('home.adjustBlockedBody'), [
        { text: t('action.understood') },
      ]);
      return;
    }
    backdrop.show();
    router.push({
      pathname: '/edit-balance',
      // El Disponible CONFIRMADO, nunca el proyectado (F07/ADR-001 §10). Con el
      // bloqueo de arriba los dos coinciden, y aun así se manda el del servidor.
      params: { current: home.balance?.amount ?? '' },
    });
  };

  const toggleMovement = (id: string) => {
    setOpenMovement((current) => {
      /*
       * **Ya no se piden las observaciones al desplegar.** El detalle dejó de
       * pintar el saldo observado —era una cifra que, desde que se puede
       * corregir desde aquí, describiría el saldo de HOY para un movimiento de
       * hace meses—, así que pedirlas sería tráfico para algo que nadie mira.
       *
       * Ni la superficie ni el hook se han tocado: `api.observed_balance` y
       * `home.ensureObservations` siguen ahí para cuando el historial tenga su
       * sitio propio.
       */
      return current === id ? null : id;
    });
  };

  const slices =
    projected.statistics === null
      ? []
      : categorySlices(projected.statistics.categories, projected.statistics.expense_total);

  /*
   * INGRESOS son ingresos: los PAGOS RECIBIDOS de un grupo (F09/ADR-007) no entran
   * ni en la lista ni en el total —una liquidación no es renta (AGENTS.md
   * §2)—; viven en Movimientos recientes como «Pago recibido», con su
   * contraparte, su orden y su anulación. El pago hecho tampoco es gasto.
   */
  const income = projected.operations.filter((op) => movementKind(op.operation_class) === 'income');
  /*
   * ═══════ EL DESPLEGABLE DE GASTOS EXPLICA SU TOTAL ═══════
   *
   * **La causa de que no cuadrara**: reutilizaba la lectura de Movimientos
   * recientes, que explica la CAJA. Un gasto compartido pagado por otro no
   * mueve mi caja y no salía; uno pagado por mí salía por lo que adelanté, no
   * por mi cuota. El total y el diagrama, en cambio, son la CUOTA ECONÓMICA
   * (`api.personal_statistics`), pague quien pague. Movimientos recientes no
   * cambia: sigue siendo caja, y mi pago de 20 sigue ahí como 20.
   *
   * El desglose son dos fuentes, y las dos son lecturas de las mismas
   * operaciones: los gastos personales de la proyección —con su fila local y
   * su reconciliación, como siempre— y MIS CUOTAS de gastos compartidos
   * (`home.shares`, de `api.personal_expense_share`: exactamente las filas que
   * el total suma, del mismo intervalo, cargadas en la misma ventana quieta).
   * Cada operación es su propia fila; se mezclan en el orden cronológico de la
   * lista. Ingresos, ajustes, liquidaciones y la fila de CAJA del compartido
   * quedan fuera: aquí la cifra es la cuota, una sola vez.
   */
  const personalExpenses = projected.operations.filter(
    (op) => movementKind(op.operation_class) === 'expense',
  );
  const expenses = expenseLines(personalExpenses, home.shares);

  /**
   * Una de las dos tarjetas de flujo, cerrada o abierta.
   *
   * Construye JSX, no es un componente: no tiene estado ni hooks propios, y
   * existe para que la fila de dos y la tarjeta a ancho completo se dibujen
   * desde la MISMA descripción. Escritas dos veces, la de abajo se quedaría
   * atrás en cuanto una de las dos formas cambiara.
   */
  const flowCard = (kind: 'income' | 'expense') => {
    const rows = kind === 'income' ? income : personalExpenses;
    // `null` cuando no hay estadísticas confirmadas: la tarjeta enseña el
    // marcador, no un cero ni una suma local (F07/ADR-001 §8).
    const total =
      projected.statistics === null
        ? null
        : kind === 'income'
          ? projected.statistics.income_total
          : projected.statistics.expense_total;

    return (
      <FlowCard
        key={kind}
        kind={kind}
        total={total}
        currencyCode={ready?.currencyCode ?? ''}
        currencyScale={ready?.currencyScale ?? 2}
        count={kind === 'income' ? rows.length : expenses.length}
        expanded={openFlow === kind}
        onToggle={() => setOpenFlow((current) => (current === kind ? null : kind))}>
        {kind === 'income' ? (
          <MovementGroup
            operations={rows}
            home={home}
            openMovement={openMovement}
            onToggleMovement={toggleMovement}
            onEdit={editMovement}
            onDelete={deleteMovement}
            deleting={annulling.pending}
            emptyLabel={t('home.noIncome')}
          />
        ) : (
          <ExpenseGroup
            lines={expenses}
            more={
              // Las personales llegan por páginas, las de Movimientos recientes:
              // si quedan, se dice aquí también y se cargan por la misma puerta.
              // Las cuotas vienen enteras, así que no cuentan como pendientes.
              projected.operations.length < projected.total
                ? { remaining: projected.total - projected.operations.length }
                : null
            }
            home={home}
            openMovement={openMovement}
            onToggleMovement={toggleMovement}
            onEdit={editMovement}
            onDelete={deleteMovement}
            deleting={annulling.pending}
            emptyLabel={t('home.noExpenses')}
          />
        )}
      </FlowCard>
    );
  };

  /*
   * EL SALUDO, DESCRITO UNA VEZ Y COLOCADO DONDE HAGA FALTA.
   *
   * **Es contenido, no barra.** En la rama con datos entra dentro del scroll y
   * sube con el saldo y con los movimientos. En las otras tres —Pareja,
   * provisionando, y el error de ámbito— no hay scroll del que formar parte,
   * así que se coloca directamente: su pertenencia sigue siendo la misma, lo
   * que falta ahí es el desplazamiento.
   *
   * Y no es una comodidad: con Pareja activo el selector es lo ÚNICO que
   * permite volver a Personal. Dejarlo sólo en la rama con datos cerraría la
   * puerta desde dentro.
   *
   * Es JSX, no un componente: no tiene estado ni hooks, y así hay UNA sola
   * descripción en vez de cuatro que puedan separarse. En ejecución sólo se
   * monta una, porque las ramas son excluyentes.
   */
  const greeting = <HomeGreeting name={greetingName} />;

  return (
    <ThemedView style={styles.screen}>
      {/*
       * LA BARRA SUPERIOR YA NO SE MONTA AQUÍ, y tampoco el inset superior.
       *
       * Vivía en esta pantalla «en las cuatro ramas», y era correcto mientras
       * la pantalla era la unidad de composición. Dejó de serlo al ver que
       * viajaba con la transición entre pestañas: una barra que identifica la
       * aplicación no puede deslizarse fuera de ella. Ahora la monta UNA vez el
       * layout de pestañas, por encima del navegador, y consume él el área
       * segura de arriba; esta pantalla sólo pide los laterales.
       */}
      <SafeAreaView style={styles.screen} edges={['left', 'right']}>
        {guest ? (
          /*
           * INVITADO: Inicio es «Crea tu cuenta» y nada mas. Sin login, sin
           * recuperar, sin «Entrar como invitado» (ya lo es), sin proveedores
           * (F8.B): la unica accion de cuenta es convertir ESTE usuario anonimo
           * en cuenta, con el mismo id (F05/ADR-003 §3). El Personal interno
           * existe igual; su UI llega cuando la cuenta exista.
           */
          <ScrollView
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={[
              styles.gate,
              { paddingBottom: DOCK_HEIGHT + insets.bottom + Spacing.xl },
            ]}>
            <GuestSignUp initialName={guestName} pendingEmail={guestPendingEmail} />
          </ScrollView>
        ) : !personal ? (
          <>
            {greeting}
            {/*
             * Pareja: por debajo del selector, nada. Ni contenido de Personal,
             * ni datos inventados, ni una llamada a Premium que nadie ha
             * diseñado.
             */}
            <View style={styles.centre} />
          </>
        ) : isResolving(scope.state) ? (
          <>
            {greeting}
            <View style={styles.centre}>
              <LoadingState label={t('home.preparing')} fill />
            </View>
          </>
        ) : ready === null ? (
          <>
            {greeting}
            <View style={styles.centre}>
              <ErrorState
                title={t('home.scopeErrorTitle')}
                description={t('home.scopeErrorBody')}
                retry={{ label: t('action.retry'), onPress: scope.retry }}
                fill
              />
            </View>
          </>
        ) : (
          <ScrollView
            /*
             * **El contenedor del scroll no pone márgenes propios.** El saludo
             * entra a ancho completo con los suyos —los mismos que traía cuando
             * vivía dentro de la cabecera— y el resto va dentro de `body`.
             * Puestos aquí, se sumarían a los del saludo y aparecería más
             * adentro de lo que está.
             */
            /*
             * **Sin barra de desplazamiento.** Es sólo el indicador: el gesto,
             * el rebote, la posición y lo que anuncia el lector de pantalla
             * siguen siendo los del `ScrollView` de siempre.
             *
             * Va en ESTE contenedor y en ninguno más. Inicio se lee como una
             * pila de tarjetas de cristal, y una barra sobre el canto derecho
             * las cruza; los demás desplazamientos de la app conservan el suyo.
             */
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: DOCK_HEIGHT + insets.bottom + Spacing.xl }}>
            {greeting}

            <View style={styles.body}>
              {/*
               * ═══ LA DEUDA SALE DE LOS GRUPOS, NO DEL SNAPSHOT PERSONAL ═══
               *
               * Aquí se leía `home.balance` y se pasaba una colección vacía
               * constante, así que la tarjeta decía `0,00 €` **siempre**: con
               * deudas y sin ellas. Era correcto mientras nada producía
               * dimensión de deuda; desde que hay gastos compartidos es una
               * cifra contable falsa que no falla por ningún sitio.
               *
               * Ahora el hecho es la posición neta del actor en TODOS sus
               * grupos, y las tres respuestas siguen separadas: cargando o sin
               * lectura es desconocido, sin grupos o compensado es un cero
               * CONOCIDO, y una posición real se pinta con su signo.
               */}
              <BalanceCard
                amount={projected.balance}
                currencyCode={ready.currencyCode}
                currencyScale={ready.currencyScale}
                debt={homeDebt(debtSnapshot(groups.groups, groups.reopened, groups.loading, ready))}
                onAdjust={editBalance}
              />

              <IntervalSelector value={interval} onChange={setIntervalKind} onCalendar={premium} />

              {/*
               * ═══ NO HAY CONEXIÓN, Y NO SE DICE ═══
               *
               * Aquí vivía una tarjeta de error —«No hemos podido cargar tus
               * movimientos», con su reintento— y **se ha retirado**. Su única
               * causa posible era que el servidor no respondiera: las tres
               * consultas de este bloque fallan por transporte o por respuesta
               * de la frontera, y ninguna de las dos es algo que la persona
               * pueda arreglar ni tenga que saber. Nomey sigue funcionando: se
               * guarda, se ve y se sincroniza sola cuando vuelve.
               *
               * Lo que queda en su lugar no es una cifra inventada. El saldo,
               * los totales y el reparto siguen siendo lo que se pueda
               * demostrar —el snapshot conservado, o `—` si no lo hay (F07/ADR-001
               * §8)— y las intenciones locales se pintan encima. La carga
               * inicial sigue teniendo su indicador, porque esperar y fallar no
               * son lo mismo.
               *
               * Esto NO tapa las otras dos cosas: un rechazo demostrado del
               * servidor sale por la campana, y un fallo de la base local deja
               * la hoja abierta con su mensaje.
               */}
              {home.status === 'loading' && projected.operations.length === 0 ? (
                <LoadingState label={t('home.loading')} />
              ) : (
                <>
                  {/*
                   * DOS FORMAS, UNA MISMA TARJETA.
                   *
                   * Cerradas comparten fila y media anchura cada una. Al abrir
                   * una, su pareja **deja de renderizarse** y la abierta pasa a
                   * ocupar el ancho entero: la lista de movimientos cae dentro de
                   * la propia tarjeta, con las filas a ancho útil completo, y lo
                   * que viene después baja solo.
                   *
                   * No es una tarjeta nueva ni una pantalla nueva: es la misma
                   * `FlowCard`, que deja de llevar `flex: 1` cuando está abierta.
                   * Mantener el mismo componente es lo que conserva el estado y
                   * lo que hace que cerrar devuelva exactamente la fila de dos.
                   *
                   * La exclusividad no la impone este layout: ya la garantiza
                   * `openFlow`, que es un único valor. Aquí sólo se dibuja.
                   */}
                  {openFlow === null ? (
                    <View style={styles.flows}>
                      {flowCard('income')}
                      {flowCard('expense')}
                    </View>
                  ) : (
                    flowCard(openFlow)
                  )}

                  <CategoryCard
                    slices={slices}
                    categories={home.categories}
                    unavailable={projected.statistics === null}
                  />

                  <Section title={t('home.activity')}>
                    {projected.operations.length === 0 ? (
                      /*
                       * «Todavía no hay movimientos» es una AFIRMACIÓN, y sólo
                       * se puede hacer con una base del servidor delante. Sin
                       * ella —arranque en frío sin red— la lista está vacía
                       * porque no se ha podido leer, no porque no haya nada, y
                       * decir lo segundo sería inventar. Se calla, sin avisos.
                       */
                      home.snapshot.intervalSeq === null ? null : (
                        <EmptyState
                          symbol={Symbols.empty}
                          title={t('home.activityEmpty')}
                          description={t('home.activityHint')}
                        />
                      )
                    ) : (
                      <View>
                        {projected.operations.map((operation) => (
                          <MovementRow
                            /*
                             * La clave de render es la de la proyección: una
                             * fila local se pinta con su clave de cliente y la
                             * del servidor que la sustituye la hereda, así que
                             * la confirmación no remonta nada (F07/ADR-001 §9).
                             */
                            key={operation.render_key}
                            operation={operation}
                            previous={versionOf(operation, home)}
                            categories={home.categories}
                            /*
                             * THE ROW'S CURRENCY, not the scope's. They coincide
                             * except when the base moved underneath an already
                             * captured entry (F02/ADR-001 §7, F07/ADR-001 §14): that row
                             * keeps its amount and its currency, and painting it
                             * with the new scale would reinterpret the amount.
                             */
                            currencyCode={operation.currency_code}
                            currencyScale={operation.currency_scale}
                            expanded={openMovement === operation.render_key}
                            onToggle={() => toggleMovement(operation.render_key)}
                            onEdit={() => {
                              editMovement(operation);
                            }}
                            onDelete={() => {
                              deleteMovement(operation);
                            }}
                            deleting={annulling.pending === operation.operation_id}
                          />
                        ))}

                        {projected.operations.length < projected.total ? (
                          <MoreRow
                            remaining={projected.total - projected.operations.length}
                            loading={home.loadingMore}
                            onPress={home.loadMore}
                          />
                        ) : null}
                      </View>
                    )}
                  </Section>
                </>
              )}
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

/** La versión anterior de una operación, ya resuelta por identificador. */
function versionOf(operation: ProjectedOperation, home: ReturnType<typeof usePersonalHome>) {
  return operation.previous_version_id === null
    ? undefined
    : home.versions.get(operation.previous_version_id);
}

function MovementGroup({
  operations,
  home,
  openMovement,
  onToggleMovement,
  onEdit,
  onDelete,
  deleting,
  emptyLabel,
}: {
  operations: readonly ProjectedOperation[];
  home: ReturnType<typeof usePersonalHome>;
  openMovement: string | null;
  onToggleMovement: (id: string) => void;
  /** Corrige esa operación: el writer necesita su id y su versión vigente. */
  onEdit: (operation: ProjectedOperation) => void;
  /** La operación entera: el writer necesita su id y su versión vigente. */
  onDelete: (operation: ProjectedOperation) => void;
  /** Cuál se está anulando ahora mismo, si alguna. */
  deleting: string | null;
  emptyLabel: string;
}) {
  if (operations.length === 0) {
    return (
      <ThemedText variant="bodySmall" themeColor="textTertiary" style={styles.empty}>
        {emptyLabel}
      </ThemedText>
    );
  }

  return (
    <View>
      {operations.map((operation) => (
        <MovementRow
          key={operation.render_key}
          operation={operation}
          previous={versionOf(operation, home)}
          categories={home.categories}
          currencyCode={operation.currency_code}
          currencyScale={operation.currency_scale}
          expanded={openMovement === operation.render_key}
          onToggle={() => onToggleMovement(operation.render_key)}
          onEdit={() => {
            onEdit(operation);
          }}
          onDelete={() => {
            onDelete(operation);
          }}
          deleting={deleting === operation.operation_id}
        />
      ))}
    </View>
  );
}

/**
 * EL DESGLOSE DE GASTOS: gastos personales y cuotas compartidas, mezclados en
 * el orden de la lista. Cada línea con su fila: la personal es la MISMA
 * `MovementRow` de Movimientos recientes —con editar, eliminar, proyección
 * local y reconciliación—; la cuota es `ShareRow`, que se lee y no se toca.
 * El estado de despliegue es el mismo de la pantalla: una fila abierta a la
 * vez, con claves que no pueden chocar (`shareKey` lleva prefijo).
 */
function ExpenseGroup({
  lines,
  more,
  home,
  openMovement,
  onToggleMovement,
  onEdit,
  onDelete,
  deleting,
  emptyLabel,
}: {
  lines: readonly ExpenseLine<ProjectedOperation>[];
  /** Operaciones del intervalo aún no cargadas, si las hay. */
  more: { readonly remaining: number } | null;
  home: ReturnType<typeof usePersonalHome>;
  openMovement: string | null;
  onToggleMovement: (id: string) => void;
  onEdit: (operation: ProjectedOperation) => void;
  onDelete: (operation: ProjectedOperation) => void;
  deleting: string | null;
  emptyLabel: string;
}) {
  if (lines.length === 0) {
    return (
      <ThemedText variant="bodySmall" themeColor="textTertiary" style={styles.empty}>
        {emptyLabel}
      </ThemedText>
    );
  }

  const row = (line: ExpenseLine<ProjectedOperation>) => {
    if (line.kind === 'personal') {
      const operation = line.operation;
      return (
        <MovementRow
          key={operation.render_key}
          operation={operation}
          previous={versionOf(operation, home)}
          categories={home.categories}
          currencyCode={operation.currency_code}
          currencyScale={operation.currency_scale}
          expanded={openMovement === operation.render_key}
          onToggle={() => onToggleMovement(operation.render_key)}
          onEdit={() => {
            onEdit(operation);
          }}
          onDelete={() => {
            onDelete(operation);
          }}
          deleting={deleting === operation.operation_id}
        />
      );
    }
    const key = shareKey(line.share);
    return (
      <ShareRow
        key={key}
        share={line.share}
        categories={home.categories}
        expanded={openMovement === key}
        onToggle={() => onToggleMovement(key)}
      />
    );
  };

  return (
    <View>
      {lines.map(row)}
      {more === null ? null : (
        <MoreRow remaining={more.remaining} loading={home.loadingMore} onPress={home.loadMore} />
      )}
    </View>
  );
}

/**
 * Cuántas quedan, dicho en voz alta.
 *
 * Una lista paginada que no dice que lo está invita a leerla como completa. Las
 * CIFRAS no dependen de esto —las agrega el servidor y son exactas— pero la
 * lista sí, y callarlo sería dejar creer otra cosa.
 */
function MoreRow({
  remaining,
  loading,
  onPress,
}: {
  remaining: number;
  loading: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();

  if (loading) return <LoadingState label={t('home.loading')} />;

  return (
    <EmptyState
      title={t('home.moreRemaining', { count: String(remaining) })}
      action={{ label: t('home.loadMore'), onPress }}
    />
  );
}

/**
 * Lo que se puede AFIRMAR sobre las deudas del actor, a partir de sus grupos.
 *
 * Vive en la ruta porque junta dos features que no se pueden importar entre
 * si, y es pura: recibe lo leido y devuelve el contrato que `homeDebt` sabe
 * resolver. No consulta nada.
 *
 * **Tres entradas producen desconocido, y ninguna produce cero por defecto:**
 * que el ambito personal aun no este resuelto —sin su definicion monetaria no
 * hay con que comparar—, que la lectura de grupos siga en su primer viaje, y
 * que `positionAcross` no pueda afirmar el agregado —una posicion sin leer, o
 * un grupo en otra divisa con saldo vivo—.
 *
 * Con las tres resueltas, el neto viaja como UN importe y no como la lista de
 * los grupos: `homeDebt` los sumaria igual, pero la compensacion ya la hizo
 * quien conoce las divisas, y volver a exponer los sumandos invitaria a
 * sumarlos otra vez sin ese filtro.
 */
function debtSnapshot(
  groups: readonly ProjectedGroup[],
  reopened: readonly ReopenedDebt[] | null,
  loading: boolean,
  ready: { readonly currencyDefinitionId: string } | null,
): DebtSnapshot {
  if (ready === null || loading || reopened === null) return { loaded: false };

  const net = positionAcross(groups, ready.currencyDefinitionId);
  if (net.kind === 'unavailable') return { loaded: false };

  /*
   * Y LA DEUDA REABIERTA de los grupos de los que ya no soy miembro (F09/ADR-007
   * C6): quien salio no tiene posicion por membresia, pero lo que su pago
   * anulado volvio a dejar pendiente es suyo y se suma aqui, con el mismo
   * filtro de divisa que las posiciones.
   */
  let total = net.minor;
  for (const one of reopened) {
    if (one.currencyDefinitionId === ready.currencyDefinitionId) {
      total += BigInt(one.amountMinor);
    } else if (BigInt(one.amountMinor) !== 0n) {
      return { loaded: false };
    }
  }

  return { loaded: true, amounts: [total.toString()] };
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  centre: {
    flex: 1,
    padding: Spacing.lg,
  },
  /* La puerta de acceso del invitado (preview): los margenes de AuthScreen, dentro de la pestana. */
  gate: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xxl,
    gap: Spacing.lg,
  },
  /**
   * El contenido de debajo del saludo.
   *
   * Lleva el relleno horizontal y la separación entre tarjetas que antes
   * estaban en el contenedor del scroll. Se mudaron aquí cuando el saludo pasó
   * a ser el primer hijo de ese contenedor: trae los suyos, y aplicados a los
   * dos se habría metido hacia dentro y la distancia hasta `Disponible` habría
   * crecido de `md` a `md + lg`.
   *
   * Cada capa pone su separación UNA vez: el relleno lateral y el hueco entre
   * tarjetas, aquí; la distancia hasta `Disponible`, el `paddingBottom` del
   * saludo; y la que hay entre la barra superior y el saludo, el `paddingBottom`
   * de la barra. Ninguna se compensa con un margen negativo.
   */
  body: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  flows: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  empty: {
    paddingVertical: Spacing.md,
    textAlign: 'center',
  },
});

/**
 * Vuelve a pedir los datos al REGRESAR a Inicio, y sólo al regresar.
 *
 * La ventana del `+` es otra ruta: cuando escribe un movimiento, la pantalla
 * que hay debajo no se entera de nada. Sin esto, alguien registraría un gasto,
 * volvería, y vería el saldo de antes — sin ningún error, que es la peor forma
 * de equivocarse con dinero.
 *
 * **No refresca al montar**, que es la trampa evidente de este patrón: el foco
 * llega la primera vez a la vez que la carga inicial, y refrescar ahí duplicaría
 * cada consulta del plan de `usePersonalHome`. Se guarda si ya se estuvo
 * enfocado, y sólo el segundo foco en adelante pide nada.
 */
function useRefreshOnReturn(refresh: () => void) {
  const focused = useIsFocused();
  const visitado = useRef(false);

  useEffect(() => {
    if (!focused) return;
    if (!visitado.current) {
      visitado.current = true;
      return;
    }
    refresh();
  }, [focused, refresh]);
}
