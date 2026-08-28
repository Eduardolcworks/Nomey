import { useMemo, useState } from 'react';
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
  usePersonalHome,
  usePersonalScope,
} from '@/features/personal';
import { useSession } from '@/features/session';
import { AppHeader, DOCK_HEIGHT } from '@/features/shell';
import { useTranslation } from '@/lib/i18n';
import {
  EmptyState,
  ErrorState,
  FadeEdge,
  LoadingState,
  Section,
  ThemedText,
  ThemedView,
} from '@/ui/components';
import { Spacing } from '@/ui/theme';

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
  const home = usePersonalHome(ready !== null, range);

  const greetingName = state.status === 'signed-in' ? state.identity.displayName : null;

  const notYet = () => {
    Alert.alert(t('home.soonTitle'), t('home.soonBody'), [{ text: t('action.understood') }]);
  };

  const premium = () => {
    Alert.alert(t('home.calendarLabel'), t('home.calendarPremium'), [
      { text: t('action.understood') },
    ]);
  };

  const toggleMovement = (id: string) => {
    setOpenMovement((current) => {
      const next = current === id ? null : id;
      // Las observaciones se piden aquí, la primera vez que alguien abre algo, y
      // para la PÁGINA ENTERA. Perezoso no es por fila.
      if (next !== null) home.ensureObservations();
      return next;
    });
  };

  const slices =
    home.statistics === null
      ? []
      : categorySlices(home.statistics.categories, home.statistics.expense_total);

  const income = operationsOfKind(home.operations, 'income');
  const expenses = operationsOfKind(home.operations, 'expense');

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <AppHeader greeting greetingName={greetingName} />

        {isResolving(scope.state) ? (
          <View style={styles.centre}>
            <LoadingState label={t('home.preparing')} fill />
          </View>
        ) : ready === null ? (
          <View style={styles.centre}>
            <ErrorState
              title={t('home.scopeErrorTitle')}
              description={t('home.scopeErrorBody')}
              retry={{ label: t('action.retry'), onPress: scope.retry }}
              fill
            />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={[
              styles.content,
              { paddingBottom: DOCK_HEIGHT + insets.bottom + Spacing.xl },
            ]}>
            <BalanceCard
              amount={home.balance?.amount ?? null}
              currencyCode={ready.currencyCode}
              currencyScale={ready.currencyScale}
              onAdjust={notYet}
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
                <View style={styles.flows}>
                  <FlowCard
                    kind="income"
                    total={home.statistics?.income_total ?? '0'}
                    currencyCode={ready.currencyCode}
                    currencyScale={ready.currencyScale}
                    count={income.length}
                    expanded={openFlow === 'income'}
                    /* Una sola abierta cada vez: dos listas largas a la vez
                       empujan el resto de la pantalla fuera de vista sin que
                       nada lo justifique. */
                    onToggle={() => setOpenFlow((c) => (c === 'income' ? null : 'income'))}>
                    <MovementGroup
                      operations={income}
                      home={home}
                      currencyCode={ready.currencyCode}
                      currencyScale={ready.currencyScale}
                      openMovement={openMovement}
                      onToggleMovement={toggleMovement}
                      onEdit={notYet}
                      onDelete={notYet}
                      emptyLabel={t('home.noIncome')}
                    />
                  </FlowCard>

                  <FlowCard
                    kind="expense"
                    total={home.statistics?.expense_total ?? '0'}
                    currencyCode={ready.currencyCode}
                    currencyScale={ready.currencyScale}
                    count={expenses.length}
                    expanded={openFlow === 'expense'}
                    onToggle={() => setOpenFlow((c) => (c === 'expense' ? null : 'expense'))}>
                    <MovementGroup
                      operations={expenses}
                      home={home}
                      currencyCode={ready.currencyCode}
                      currencyScale={ready.currencyScale}
                      openMovement={openMovement}
                      onToggleMovement={toggleMovement}
                      onEdit={notYet}
                      onDelete={notYet}
                      emptyLabel={t('home.noExpenses')}
                    />
                  </FlowCard>
                </View>

                <CategoryCard slices={slices} categories={home.categories} />

                <Section title={t('home.activity')}>
                  {home.operations.length === 0 ? (
                    <EmptyState
                      symbol="tray"
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
                          observation={home.observations.get(operation.operation_id)}
                          categories={home.categories}
                          currencyCode={ready.currencyCode}
                          currencyScale={ready.currencyScale}
                          expanded={openMovement === operation.operation_id}
                          onToggle={() => toggleMovement(operation.operation_id)}
                          onEdit={notYet}
                          onDelete={notYet}
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
          </ScrollView>
        )}

        {/* El contenido se desvanece bajo el dock en vez de cortarse. */}
        <FadeEdge height={DOCK_HEIGHT} bottom={0} />
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
  emptyLabel,
}: {
  operations: readonly PersonalOperation[];
  home: ReturnType<typeof usePersonalHome>;
  currencyCode: string;
  currencyScale: number;
  openMovement: string | null;
  onToggleMovement: (id: string) => void;
  onEdit: () => void;
  onDelete: () => void;
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
          observation={home.observations.get(operation.operation_id)}
          categories={home.categories}
          currencyCode={currencyCode}
          currencyScale={currencyScale}
          expanded={openMovement === operation.operation_id}
          onToggle={() => onToggleMovement(operation.operation_id)}
          onEdit={onEdit}
          onDelete={onDelete}
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
  content: {
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
