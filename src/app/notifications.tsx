import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { GroupNoticeCard, useGroupNotices } from '@/features/groups';
import { IncidentCard, useCategoryNames, useIncidents } from '@/features/personal';
import { useSession } from '@/features/session';
import { PlaceholderScreen } from '@/features/shell';
import { useTranslation } from '@/lib/i18n';
import { EmptyState, ThemedText } from '@/ui/components';
import { Spacing, Symbols } from '@/ui/theme';

/**
 * Notifications, and for now that means the queue's incidents.
 *
 * F07/ADR-001 §15: **the bell is the only entrance**, and the queue's own terminal
 * state is the durable source — there is no second store, no counter and no
 * badge on the movement list. So this screen is a read of the queue and two
 * buttons; nothing here persists anything of its own.
 *
 * Pushed rather than presented as a sheet: it is a place with content and a
 * back affordance, not a task that is started and finished.
 *
 * **Where `Revisar` goes depends on what can be proven** (F07/ADR-002 §2), and this
 * route is where that is resolved because it is the one place that can see both
 * the incident and the navigator. A conflicted movement opens the sheet with
 * everything but its amount — the amount belonged to another monetary
 * definition and carrying it across would restate it. A movement whose result
 * is unknown goes to the list instead, so the person looks before deciding; no
 * press from there can mint a key.
 */
export default function NotificationsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { state: session } = useSession();
  const actorId = session.status === 'signed-in' ? session.identity.userId : '';

  const { incidents, ready, markSeen, retry, dismiss, busy } = useIncidents(actorId);
  /*
   * El catálogo ENTERO, no el del selector: una incidencia sobre una categoría
   * dada de baja tiene que seguir diciendo cómo se llamaba (F06/ADR-003 §7).
   */
  const named = useCategoryNames(actorId);
  /*
   * LOS AVISOS DE GRUPO (F09/ADR-003 §7), debajo de las incidencias: las
   * incidencias piden una decisión; un aviso sólo dice qué pasó y dónde. Abrir
   * uno lo marca leído y lleva al grupo, que se puede abrir porque el aviso es
   * de la membresía: sin ella no habría llegado.
   */
  const notices = useGroupNotices(actorId);

  /*
   * ═══════ ENTRAR EN LA CAMPANA DA POR VISTO LO QUE HABÍA ═══════
   *
   * Una vez por visita y por fuente, y sólo cuando la fuente se ha mostrado
   * bien: los avisos, cuando su lectura llegó; las incidencias, cuando la cola
   * se leyó. Lo que se marca es EXACTAMENTE lo que estaba al entrar —los
   * avisos, hasta el más reciente cargado; las incidencias, por su clave—,
   * así que lo que llegue después vuelve a encender el punto, aunque la
   * petición de esta visita llegue tarde. Si la carga o el guardado fallan,
   * no se marca nada y el punto sigue: no se simula una lectura correcta.
   *
   * Nada se borra ni se resuelve por entrar: las incidencias siguen con sus
   * botones, y los avisos siguen en la lista y llevan a su grupo. Y lo que
   * era nuevo al entrar SE SIGUE VIENDO como nuevo durante la visita
   * (`fresh`): la marca no desaparece delante de la persona.
   */
  const marked = useRef({ notices: false, incidents: false });
  // Lo que estaba sin leer al entrar, fijado en el primer render con la lista
  // cargada —estado derivado durante el render, no en un efecto— y nunca más.
  const [fresh, setFresh] = useState<ReadonlySet<string> | null>(null);
  if (fresh === null && !notices.loading && !notices.failed) {
    setFresh(new Set(notices.notices.filter((one) => one.readAt === null).map((one) => one.id)));
  }

  const { markSeen: markNoticesSeen } = notices;
  useEffect(() => {
    if (fresh === null || marked.current.notices) return;
    marked.current.notices = true;
    if (fresh.size > 0) void markNoticesSeen();
  }, [fresh, markNoticesSeen]);

  useEffect(() => {
    if (marked.current.incidents || !ready) return;
    marked.current.incidents = true;
    void markSeen(incidents.map((one) => one.clientOperationId));
  }, [ready, incidents, markSeen]);

  const open = (id: string, scopeId: string) => {
    // Ya visto al entrar; si aquello falló, abrirlo lo intenta por su cuenta.
    const notice = notices.notices.find((one) => one.id === id);
    if (notice !== undefined && notice.readAt === null) void notices.markRead(id);
    router.push({ pathname: '/group/[id]', params: { id: scopeId } });
  };

  const review = (clientOperationId: string) => {
    const incident = incidents.find((one) => one.clientOperationId === clientOperationId);
    if (incident === undefined) return;

    if (incident.reviewDestination === 'movements') {
      // It might already exist. Look first; registering is the ordinary route.
      router.dismissTo('/');
      return;
    }

    /*
     * The sheet, prefilled with everything except the amount (F07/ADR-002 §3). The
     * entry stays where it is: it and its incident are resolved only inside the
     * transaction that creates the replacement, never by opening this.
     */
    router.push({
      pathname: '/add',
      params: {
        resolving: incident.clientOperationId,
        kind: incident.kind,
        concept: incident.concept ?? '',
        categoryId: incident.categoryId ?? '',
        date: incident.effectiveDate,
      },
    });
  };

  return (
    <PlaceholderScreen title="nav.notifications">
      {incidents.length === 0 && notices.notices.length === 0 ? (
        <EmptyState
          symbol={Symbols.notifications}
          title={t('notifications.empty')}
          description={t('notifications.emptyHint')}
        />
      ) : null}
      {incidents.length === 0 ? null : (
        <View style={styles.list}>
          <ThemedText variant="caption" themeColor="textTertiary">
            {t('incident.title')}
          </ThemedText>
          {incidents.map((incident) => (
            <IncidentCard
              key={incident.clientOperationId}
              incident={incident}
              categories={named}
              busy={busy(incident.clientOperationId)}
              onYes={() => {
                void retry(incident.clientOperationId);
              }}
              onNo={() => {
                void dismiss(incident.clientOperationId);
              }}
              onReview={() => {
                review(incident.clientOperationId);
              }}
              onDiscard={() => {
                void dismiss(incident.clientOperationId);
              }}
            />
          ))}
        </View>
      )}
      {notices.notices.length === 0 ? null : (
        <View style={styles.list}>
          <ThemedText variant="caption" themeColor="textTertiary">
            {t('notifications.groups')}
          </ThemedText>
          {notices.notices.map((notice) => (
            <GroupNoticeCard
              key={notice.id}
              notice={notice}
              fresh={fresh?.has(notice.id) ?? false}
              onOpen={() => {
                open(notice.id, notice.scopeId);
              }}
            />
          ))}
        </View>
      )}
    </PlaceholderScreen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.md,
    paddingTop: Spacing.sm,
  },
});
