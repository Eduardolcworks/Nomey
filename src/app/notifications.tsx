import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { IncidentCard, useCategoryNames, useIncidents } from '@/features/personal';
import { useSession } from '@/features/session';
import { PlaceholderScreen } from '@/features/shell';
import { useTranslation } from '@/lib/i18n';
import { EmptyState, ThemedText } from '@/ui/components';
import { Spacing, Symbols } from '@/ui/theme';

/**
 * Notifications, and for now that means the queue's incidents.
 *
 * ADR-028 §15: **the bell is the only entrance**, and the queue's own terminal
 * state is the durable source — there is no second store, no counter and no
 * badge on the movement list. So this screen is a read of the queue and two
 * buttons; nothing here persists anything of its own.
 *
 * Pushed rather than presented as a sheet: it is a place with content and a
 * back affordance, not a task that is started and finished.
 *
 * **Where `Revisar` goes depends on what can be proven** (ADR-029 §2), and this
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

  const { incidents, retry, dismiss, busy } = useIncidents(actorId);
  /*
   * El catálogo ENTERO, no el del selector: una incidencia sobre una categoría
   * dada de baja tiene que seguir diciendo cómo se llamaba (ADR-021 §7).
   */
  const named = useCategoryNames(actorId);

  const review = (clientOperationId: string) => {
    const incident = incidents.find((one) => one.clientOperationId === clientOperationId);
    if (incident === undefined) return;

    if (incident.reviewDestination === 'movements') {
      // It might already exist. Look first; registering is the ordinary route.
      router.dismissTo('/');
      return;
    }

    /*
     * The sheet, prefilled with everything except the amount (ADR-029 §3). The
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
      {incidents.length === 0 ? (
        <EmptyState
          symbol={Symbols.notifications}
          title={t('notifications.empty')}
          description={t('notifications.emptyHint')}
        />
      ) : (
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
    </PlaceholderScreen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.md,
    paddingTop: Spacing.sm,
  },
});
