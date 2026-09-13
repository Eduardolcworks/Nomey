import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { currencyDefinition, money } from '@/domain';
import { GroupCard, useGroups, useLeaveGroup } from '@/features/groups';
import { useSession } from '@/features/session';
import { DOCK_HEIGHT, ScreenTitle, useAddBackdrop } from '@/features/shell';
import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { EmptyState, LongPressMenu, SwipeToDelete, ThemedText, ThemedView } from '@/ui/components';
import { Spacing, Symbols } from '@/ui/theme';

/**
 * Grupos: el segundo mundo raíz, y ahora con sus grupos de verdad.
 *
 * **La lista sale de la proyección, no de una consulta.** Un grupo creado sin
 * red aparece aquí en el mismo fotograma, y cuando el servidor lo confirma no
 * cambia nada visible: la identidad es la misma antes y después, así que la
 * tarjeta no salta ni se duplica (F07/ADR-001 §8).
 *
 * **«Crear grupo» es la acción del estado vacío, no el `+` flotante.** El `+`
 * añade un movimiento a donde estás; no crea el sitio. Crear un grupo sale del
 * selector del `+` de esta pestaña, que es donde vive esa decisión.
 */
export default function GroupsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  /*
   * La campana ya no se lee aquí: la cabecera —y con ella su indicador— la
   * monta el layout de pestañas una sola vez, por encima del navegador. Es lo
   * que hace que sea idéntica en los dos destinos sin tener que mantenerla en
   * dos sitios.
   */
  const { state } = useSession();
  const actorId = state.status === 'signed-in' ? state.identity.userId : '';

  const { groups, loading, stale, refresh } = useGroups(actorId, state.status);
  const backdrop = useAddBackdrop();
  const leaving = useLeaveGroup();
  const format = useFormat();

  /*
   * ═══════ SALIR DEL GRUPO: la confirmación dice las cuatro cosas ═══════
   *
   * **Sólo se sale a cero** (F09/ADR-007 C5): con pares por pagar o por cobrar el
   * servidor responde `LEAVE_BLOCKED_DEBT` bajo el cerrojo, y aquí se dice y
   * se lleva a Pagos sugeridos del grupo, donde se registran los pagos. La
   * confirmación no presenta la salida como pago ni como condonación: dice qué
   * deja de verse, qué se conserva y qué conservan los demás. Al confirmarse,
   * el grupo desaparece de la lista porque la RLS deja de devolverlo, no
   * porque el cliente lo esconda.
   */
  /*
   * EL MOTIVO EXACTO. Se sale a NETO cero (F09/ADR-007 C8): se dice cuánto queda
   * por pagar o por cobrar —«Te queda por pagar 3,00 €»— y la acción es ir al
   * grupo, donde Pagos sugeridos lo reparte. Sin lectura del neto (bloqueo
   * tardío sin poder releer), el texto genérico.
   */
  const leaveBlocked = (scopeId: string, net: bigint | null) => {
    const group = groups.find((one) => one.scopeId === scopeId);
    const currency =
      group === undefined
        ? null
        : currencyDefinition({
            id: group.currencyDefinitionId,
            code: group.currencyCode,
            scale: group.currencyScale,
          });
    const magnitude = net === null ? null : net < 0n ? -net : net;
    const amount =
      magnitude === null
        ? null
        : currency === null
          ? magnitude.toString()
          : format.money(money(magnitude, currency));
    const line =
      net === null || amount === null || net === 0n
        ? ''
        : net < 0n
          ? t('groups.leaveBlockedOwe', { amount })
          : t('groups.leaveBlockedOwed', { amount });
    Alert.alert(
      t('groups.leaveBlockedTitle'),
      line === '' ? t('groups.leaveBlocked') : `${line}\n\n${t('groups.leaveBlocked')}`,
      [
        { text: t('action.close'), style: 'cancel' },
        {
          text: t('groups.leaveBlockedGo'),
          onPress: () => {
            router.push({ pathname: '/group/[id]', params: { id: scopeId } });
          },
        },
      ],
    );
  };
  const askLeave = (scopeId: string, displayName: string) => {
    /*
     * PRIMERO se mira si se puede. Con neto distinto de cero se dice directamente
     * —sin preguntar «¿salir?» para negarlo después—; sin ellos, o sin poder
     * leerlos, se pide la confirmación y el servidor decide bajo el cerrojo:
     * una deuda aparecida entre la comprobación y la confirmación vuelve como
     * `blockedDebt` y se explica igual.
     */
    void leaving.check(scopeId).then((check) => {
      if (check.state === 'blocked') {
        leaveBlocked(scopeId, check.net);
        return;
      }
      Alert.alert(t('groups.leaveTitle', { name: displayName }), t('groups.leaveBody'), [
        { text: t('action.cancel'), style: 'cancel' },
        {
          text: t('groups.leaveConfirm'),
          style: 'destructive',
          onPress: () => {
            void leaving.leave(scopeId).then((outcome) => {
              if (outcome === 'left') {
                refresh();
                return;
              }
              if (outcome === 'blockedDebt') {
                /* Bloqueo tardío (deuda aparecida entre medias): se relee el neto para decirlo. */
                void leaving.check(scopeId).then((again) => {
                  leaveBlocked(scopeId, again.state === 'blocked' ? again.net : null);
                });
                return;
              }
              Alert.alert(t('groups.leaveFailedTitle'), t('groups.leaveFailed'), [
                { text: t('action.close') },
              ]);
            });
          },
        },
      ]);
    });
  };

  /*
   * AL VOLVER A ESTA PESTAÑA SE VUELVE A PREGUNTAR.
   *
   * Las tabs conservan su estado, así que sin esto la pantalla se quedaba con el
   * resultado del primer viaje para siempre: medido en el emulador, tras
   * restaurar la conexión el aviso de «no se ha podido conectar» seguía puesto
   * aunque ya se podía. Un grupo creado en otro aparato tampoco habría aparecido
   * nunca.
   *
   * **Vive en la ruta y no en el hook** porque es una decisión de navegación:
   * `features/` no conoce la pila, y un hook que se suscribiera al foco ataría el
   * dominio al router.
   */
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  return (
    <ThemedView style={styles.screen}>
      {/*
       * LA CABECERA YA NO SE MONTA AQUÍ: la pone el layout de pestañas, una
       * vez y por encima del navegador, para que no viaje con la transición.
       * Por lo mismo, el inset superior lo consume él y esta pantalla sólo pide
       * los laterales. Debajo sigue `ScreenTitle`, que ocupa exactamente el
       * sitio donde Inicio dice «Hola, Edu» con el mismo rol y los mismos
       * márgenes — y «Grupos» sigue apareciendo una sola vez.
       */}
      <SafeAreaView style={styles.screen} edges={['left', 'right']}>
        <ScrollView
          /*
           * **El contenedor del scroll no pone márgenes propios**, igual que en
           * Inicio: el título entra a ancho completo con los suyos y el resto va
           * dentro de `body`. Puestos aquí se sumarían a los del título.
           */
          contentContainerStyle={[
            styles.content,
            { paddingBottom: DOCK_HEIGHT + insets.bottom + Spacing.lg },
          ]}>
          {/*
           * Dentro del scroll, y como primer hijo: es exactamente donde vive el
           * saludo de Inicio, así que sube con el contenido igual que él.
           */}
          <ScreenTitle>{t('groups.title')}</ScreenTitle>

          <View style={styles.body}>
            {/*
             * «TODAVÍA NO TIENES GRUPOS» ES UNA AFIRMACIÓN, y no se hace antes de
             * saberlo. Mientras el primer viaje no ha vuelto y no hay nada local
             * que pintar, no se dice nada: enseñar el estado vacío en ese hueco
             * afirma que la cuenta no tiene grupos justo cuando eso es lo único
             * que aún no se sabe. Medido en el emulador: al montar la pestaña por
             * primera vez, el vacío se veía un instante y luego aparecían.
             */}
            {loading ? null : groups.length === 0 ? (
              <EmptyState
                symbol={Symbols.groups}
                title={t('groups.empty')}
                description={t('groups.emptyHint')}
              />
            ) : (
              groups.map((group) => (
                /*
                 * ═══════ MANTENER PULSADO: EL MENÚ DEL SISTEMA ═══════
                 *
                 * El toque normal sigue abriendo el grupo —es el `Pressable` de
                 * la tarjeta—; la pulsación prolongada abre el menú contextual
                 * nativo, sin que el toque llegue además a la tarjeta.
                 *
                 * Las tres acciones, y su estado REAL:
                 * - Añadir gasto: abre la ventana del gasto de ESTE grupo, la
                 *   misma que el `+` de dentro.
                 * - Modificar grupo: el mismo editor que el lápiz de la cabecera.
                 * - Salir del grupo: F09/ADR-003. No hay eliminación —nada se borra—:
                 *   quien sale deja de ver el grupo, conserva su Personal, y los
                 *   demás conservan historial y saldos. Con confirmación.
                 *
                 * Un grupo aún sin confirmar no ofrece gasto ni edición: no hay
                 * ámbito en el servidor sobre el que escribir.
                 */
                /*
                 * DESLIZAR LA TARJETA DESCUBRE «SALIR DEL GRUPO»: la misma pieza
                 * que la papelera de Inicio, con el símbolo de salida en vez de
                 * la papelera, porque salir no borra nada (F09/ADR-003) y no se
                 * llama eliminar. Pulsarlo abre la MISMA confirmación que la
                 * opción del menú; deslizar por sí solo no sale. Un grupo aún
                 * sin confirmar no permite salir por el menú, y tampoco por el
                 * gesto: la misma condición, en el mismo sitio.
                 */
                <SwipeToDelete
                  key={group.scopeId}
                  label={t('groups.menuLeave')}
                  icon={Symbols.leave}
                  enabled={!group.pending}
                  busy={leaving.leaving}
                  onDelete={() => {
                    askLeave(group.scopeId, group.displayName);
                  }}>
                  <LongPressMenu
                    actions={
                      group.pending
                        ? []
                        : [
                            { id: 'expense', title: t('groups.menuAddExpense'), icon: Symbols.add },
                            { id: 'edit', title: t('groups.menuEdit'), icon: Symbols.edit },
                            {
                              id: 'leave',
                              title: t('groups.menuLeave'),
                              icon: Symbols.leave,
                              destructive: true,
                            },
                          ]
                    }
                    onSelect={(action) => {
                      if (action === 'expense') {
                        backdrop.show();
                        router.push({
                          pathname: '/group-expense',
                          params: { groupId: group.scopeId },
                        });
                      } else if (action === 'edit') {
                        backdrop.show();
                        router.push({ pathname: '/edit-group', params: { id: group.scopeId } });
                      } else if (action === 'leave') {
                        askLeave(group.scopeId, group.displayName);
                      }
                    }}>
                    <GroupCard
                      group={group}
                      onPress={() => {
                        router.push({ pathname: '/group/[id]', params: { id: group.scopeId } });
                      }}
                      onLeave={
                        group.pending
                          ? undefined
                          : () => {
                              askLeave(group.scopeId, group.displayName);
                            }
                      }
                    />
                  </LongPressMenu>
                </SwipeToDelete>
              ))
            )}

            {/*
             * Sin conexión la lista es lo local, que es la verdad disponible. Se
             * dice que puede faltar algo en vez de esconderlo o de afirmar que no
             * hay grupos.
             */}
            {stale ? (
              <ThemedText variant="caption" themeColor="textSecondary" style={styles.stale}>
                {t('groups.stale')}
              </ThemedText>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {/* Sin márgenes propios: los pone el título y los pone `body`. */},
  body: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  stale: {
    textAlign: 'center',
  },
});
