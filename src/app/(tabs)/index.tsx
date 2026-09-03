import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BalanceCard,
  CategoryCard,
  categorySlices,
  FlowCard,
  INITIAL_INTERVAL,
  IntervalSelector,
  type IntervalKind,
  isResolving,
  MovementRow,
  operationsOfKind,
  type PersonalOperation,
  readyScope,
  resolveInterval,
  todayInDeviceCalendar,
  useAnnulMovement,
  usePersonalHome,
  usePersonalScope,
} from '@/features/personal';
import { useSession } from '@/features/session';
import { AppTopBar, DOCK_HEIGHT, HomeGreeting, useAddBackdrop, useScope } from '@/features/shell';
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

  const scope = usePersonalScope();
  const [interval, setIntervalKind] = useState<IntervalKind>(INITIAL_INTERVAL);
  const [openFlow, setOpenFlow] = useState<'income' | 'expense' | null>(null);
  const [openMovement, setOpenMovement] = useState<string | null>(null);

  /*
   * El intervalo se resuelve contra el calendario DEL DISPOSITIVO, no contra
   * UTC: `effective_date` no tiene zona y el par fecha+hora es un reloj de
   * pared local (ADR-020 §3). Con UTC, después de las 22:00 en España un
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
  const home = usePersonalHome(ready !== null && personal, range);

  useRefreshOnReturn(home.refresh);

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
   *       -> anulación canónica  (api.annul_operation, ADR-024)
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

  const deleteMovement = (operation: PersonalOperation) => {
    Alert.alert(t('home.deleteMovement'), t('home.deleteMovementBody'), [
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
    ]);
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
  const editMovement = (operation: PersonalOperation) => {
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
        // (ADR-020 §3), y rellenarlo inventaría un hecho.
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
    backdrop.show();
    router.push({
      pathname: '/edit-balance',
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
    home.statistics === null
      ? []
      : categorySlices(home.statistics.categories, home.statistics.expense_total);

  const income = operationsOfKind(home.operations, 'income');
  const expenses = operationsOfKind(home.operations, 'expense');

  /**
   * Una de las dos tarjetas de flujo, cerrada o abierta.
   *
   * Construye JSX, no es un componente: no tiene estado ni hooks propios, y
   * existe para que la fila de dos y la tarjeta a ancho completo se dibujen
   * desde la MISMA descripción. Escritas dos veces, la de abajo se quedaría
   * atrás en cuanto una de las dos formas cambiara.
   */
  const flowCard = (kind: 'income' | 'expense') => {
    const rows = kind === 'income' ? income : expenses;
    const total =
      (kind === 'income' ? home.statistics?.income_total : home.statistics?.expense_total) ?? '0';

    return (
      <FlowCard
        key={kind}
        kind={kind}
        total={total}
        currencyCode={ready?.currencyCode ?? ''}
        currencyScale={ready?.currencyScale ?? 2}
        count={rows.length}
        expanded={openFlow === kind}
        onToggle={() => setOpenFlow((current) => (current === kind ? null : kind))}>
        <MovementGroup
          operations={rows}
          home={home}
          currencyCode={ready?.currencyCode ?? ''}
          currencyScale={ready?.currencyScale ?? 2}
          openMovement={openMovement}
          onToggleMovement={toggleMovement}
          onEdit={editMovement}
          onDelete={deleteMovement}
          deleting={annulling.pending}
          emptyLabel={t(kind === 'income' ? 'home.noIncome' : 'home.noExpenses')}
        />
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
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        {/*
         * LA BARRA SUPERIOR, FUERA DEL SCROLL Y EN LAS CUATRO RAMAS.
         *
         * Es lo único de arriba que no se mueve. Va aquí y no dentro de cada
         * rama porque no depende de ninguna: identifica la aplicación, y eso no
         * cambia porque el ámbito esté provisionándose o haya fallado.
         */}
        <AppTopBar />

        {!personal ? (
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
              <BalanceCard
                amount={home.balance?.amount ?? null}
                currencyCode={ready.currencyCode}
                currencyScale={ready.currencyScale}
                onAdjust={editBalance}
              />

              <IntervalSelector value={interval} onChange={setIntervalKind} onCalendar={premium} />

              {home.status === 'error' ? (
                <ErrorState
                  title={t('home.dataErrorTitle')}
                  description={t('home.dataErrorBody')}
                  retry={{ label: t('action.retry'), onPress: home.refresh }}
                />
              ) : home.status === 'loading' ? (
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

                  <CategoryCard slices={slices} categories={home.categories} />

                  <Section title={t('home.activity')}>
                    {home.operations.length === 0 ? (
                      <EmptyState
                        symbol={Symbols.empty}
                        title={t('home.activityEmpty')}
                        description={t('home.activityHint')}
                      />
                    ) : (
                      <View>
                        {home.operations.map((operation) => (
                          <MovementRow
                            key={operation.operation_id}
                            operation={operation}
                            previous={versionOf(operation, home)}
                            categories={home.categories}
                            currencyCode={ready.currencyCode}
                            currencyScale={ready.currencyScale}
                            expanded={openMovement === operation.operation_id}
                            onToggle={() => toggleMovement(operation.operation_id)}
                            onEdit={() => {
                              editMovement(operation);
                            }}
                            onDelete={() => {
                              deleteMovement(operation);
                            }}
                            deleting={annulling.pending === operation.operation_id}
                          />
                        ))}

                        {home.operations.length < home.total ? (
                          <MoreRow
                            remaining={home.total - home.operations.length}
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
function versionOf(operation: PersonalOperation, home: ReturnType<typeof usePersonalHome>) {
  return operation.previous_version_id === null
    ? undefined
    : home.versions.get(operation.previous_version_id);
}

function MovementGroup({
  operations,
  home,
  currencyCode,
  currencyScale,
  openMovement,
  onToggleMovement,
  onEdit,
  onDelete,
  deleting,
  emptyLabel,
}: {
  operations: readonly PersonalOperation[];
  home: ReturnType<typeof usePersonalHome>;
  currencyCode: string;
  currencyScale: number;
  openMovement: string | null;
  onToggleMovement: (id: string) => void;
  /** Corrige esa operación: el writer necesita su id y su versión vigente. */
  onEdit: (operation: PersonalOperation) => void;
  /** La operación entera: el writer necesita su id y su versión vigente. */
  onDelete: (operation: PersonalOperation) => void;
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
          key={operation.operation_id}
          operation={operation}
          previous={versionOf(operation, home)}
          categories={home.categories}
          currencyCode={currencyCode}
          currencyScale={currencyScale}
          expanded={openMovement === operation.operation_id}
          onToggle={() => onToggleMovement(operation.operation_id)}
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  centre: {
    flex: 1,
    padding: Spacing.lg,
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
