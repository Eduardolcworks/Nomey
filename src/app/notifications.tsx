import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { currencyDefinition, moneyFromMinorString } from '@/domain';
import {
  type FriendRequest,
  FRIEND_FAILURE_KEY,
  FriendRequestRow,
  settledAfterRefusal as friendRequestSettled,
  useFriendActions,
  useMyFriendRequests,
} from '@/features/friends';
import { GroupNoticeCard, useGroupNotices } from '@/features/groups';
import {
  IncidentCard,
  readyScope,
  useCategoryNames,
  useIncidents,
  usePersonalScope,
} from '@/features/personal';
import { isGuest, useSession } from '@/features/session';
import { PlaceholderScreen } from '@/features/shell';
import {
  FAILURE_KEY,
  ProposalCard,
  stateAfterRefusal,
  type TransferProposal,
  useDeclinedNotices,
  useMyProposals,
  useProposalActions,
} from '@/features/transfers';
import { useFormat } from '@/lib/format';
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
   * ═══════ EL CENTRO DE PENDIENTES DE LAS TRANSFERENCIAS (F12/ADR-002 §9) ═══════
   *
   * Sólo lo pendiente, en las dos direcciones, en una misma sección: las
   * ENTRANTES piden respuesta —Aceptar o Rechazar— y las SALIENTES esperan la
   * del otro y se pueden cancelar. Nada terminal se lista aquí: la aceptada
   * ya es un movimiento en Inicio, y la rechazada, cancelada o caducada no
   * es nada. No hay «visto» que marcar para lo PENDIENTE —no existe en el
   * servidor— y no se inventa: entrar aquí no apaga esa parte de la campana;
   * contestar la última entrante, sí. Las salientes nunca la encienden.
   *
   * Y una NOVEDAD, la única terminal que se cuenta: «Aitor rechazó tu
   * propuesta de 25,00 €». Sin botones y sin nada económico. Ésta sí se da por
   * vista al entrar —es información, no una tarea— con el mismo criterio que
   * los avisos de grupo: lo que estaba sin ver al entrar se marca una vez, se
   * sigue enseñando durante la visita (`freshDeclines`) y a la siguiente ya
   * no está. Lo que se guarda es el id de la propuesta, por actor, nunca su
   * importe (`declined-seen.ts`).
   */
  const format = useFormat();
  const guest = isGuest(session);
  const scope = usePersonalScope(actorId, guest);
  const personal = readyScope(scope.state);
  const currency =
    personal === null
      ? null
      : currencyDefinition({
          id: personal.currencyDefinitionId,
          code: personal.currencyCode,
          scale: personal.currencyScale,
        });
  const proposals = useMyProposals(actorId, !guest);
  const declines = useDeclinedNotices(actorId, proposals.declined, !guest);
  const actions = useProposalActions();

  /*
   * ═══════ LAS SOLICITUDES DE AMISTAD, SÓLO LAS ENTRANTES (F12.E.B) ═══════
   *
   * Aquí vive lo que pide una respuesta AHORA: «Eduardo quiere añadirte como
   * amigo», con Aceptar y Rechazar. Las SALIENTES no se listan: esperan la
   * respuesta del otro y no son una novedad para quien las envió; su sitio
   * es Perfil → Amigos, donde además se pueden cancelar. Es el mismo
   * criterio que separa una incidencia de un aviso.
   *
   * Y no hay «visto» que marcar: una solicitud pendiente no tiene marca en
   * el servidor y no se inventa una, así que entrar aquí NO apaga esa parte
   * de la campana — contestar la última entrante, sí. Rechazar tampoco crea
   * ningún aviso para quien la envió: no está especificado para la amistad,
   * y el emisor simplemente deja de ver su solicitud al refrescar.
   */
  const friendRequests = useMyFriendRequests(actorId, !guest);
  const friendActions = useFriendActions();
  const friendName = (request: FriendRequest) =>
    request.counterpartPublicName ??
    (request.counterpartHandle === null ? t('friends.unknown') : `@${request.counterpartHandle}`);
  const explainFriend = (outcome: Awaited<ReturnType<typeof friendActions.accept>>) => {
    if (outcome.kind !== 'failed') return;
    Alert.alert(
      t(
        friendRequestSettled(outcome.failure)
          ? 'friends.actionMovedTitle'
          : 'friends.actionFailedTitle',
      ),
      t(FRIEND_FAILURE_KEY[outcome.failure]),
      [{ text: t('action.understood') }],
    );
  };
  const declineFriend = (request: FriendRequest) => {
    Alert.alert(
      t('friends.declineTitle'),
      t('friends.declineBody', { name: friendName(request) }),
      [
        { text: t('action.cancel'), style: 'cancel' },
        {
          text: t('friends.decline'),
          style: 'destructive',
          onPress: () => {
            void friendActions.decline(request.requestId).then(explainFriend);
          },
        },
      ],
    );
  };

  const proposalAmount = (proposal: TransferProposal) =>
    currency === null
      ? proposal.amountMinor
      : format.money(moneyFromMinorString(proposal.amountMinor, currency));
  const proposalName = (proposal: TransferProposal) =>
    proposal.counterpartPublicName ??
    (proposal.counterpartHandle === null
      ? t('transfer.counterpartUnknown')
      : `@${proposal.counterpartHandle}`);
  const explainProposal = (outcome: Awaited<ReturnType<typeof actions.accept>>) => {
    if (outcome.kind !== 'failed') return;
    Alert.alert(
      t(
        stateAfterRefusal(outcome.failure) === null
          ? 'transfer.actionFailedTitle'
          : 'transfer.actionMovedTitle',
      ),
      t(FAILURE_KEY[outcome.failure]),
      [{ text: t('action.understood') }],
    );
  };
  const acceptProposal = (proposal: TransferProposal) => {
    Alert.alert(
      t('transfer.acceptTitle'),
      t('transfer.acceptBody', { amount: proposalAmount(proposal), name: proposalName(proposal) }),
      [
        { text: t('action.cancel'), style: 'cancel' },
        {
          text: t('transfer.accept'),
          onPress: () => {
            void actions.accept(proposal.proposalId).then(explainProposal);
          },
        },
      ],
    );
  };
  const cancelProposal = (proposal: TransferProposal) => {
    Alert.alert(
      t('transfer.cancelTitle'),
      t('transfer.cancelBody', { amount: proposalAmount(proposal), name: proposalName(proposal) }),
      [
        { text: t('action.close'), style: 'cancel' },
        {
          text: t('transfer.cancel'),
          style: 'destructive',
          onPress: () => {
            void actions.cancel(proposal.proposalId).then(explainProposal);
          },
        },
      ],
    );
  };
  const declineProposal = (proposal: TransferProposal) => {
    Alert.alert(
      t('transfer.declineTitle'),
      t('transfer.declineBody', { amount: proposalAmount(proposal), name: proposalName(proposal) }),
      [
        { text: t('action.cancel'), style: 'cancel' },
        {
          text: t('transfer.decline'),
          style: 'destructive',
          onPress: () => {
            void actions.decline(proposal.proposalId).then(explainProposal);
          },
        },
      ],
    );
  };

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
  const marked = useRef({ notices: false, incidents: false, declines: false });
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

  /*
   * Los rechazos sin ver al entrar, fijados igual que los avisos: en el primer
   * render con la lista y la marca cargadas, y nunca más. Sólo ELLOS se marcan;
   * las propuestas pendientes no tienen marca que poner.
   */
  const [freshDeclines, setFreshDeclines] = useState<ReadonlySet<string> | null>(null);
  if (freshDeclines === null && !proposals.loading && !proposals.failed && declines.ready) {
    setFreshDeclines(new Set(declines.unseen.map((one) => one.proposalId)));
  }
  const { markSeen: markDeclinesSeen } = declines;
  useEffect(() => {
    if (freshDeclines === null || marked.current.declines) return;
    marked.current.declines = true;
    if (freshDeclines.size > 0) void markDeclinesSeen([...freshDeclines]);
  }, [freshDeclines, markDeclinesSeen]);
  // Lo que se enseña de rechazos: lo que era nuevo al entrar, mientras dure la visita.
  const shownDeclines = proposals.declined.filter((one) => freshDeclines?.has(one.proposalId));

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
      {incidents.length === 0 &&
      notices.notices.length === 0 &&
      proposals.incoming.length === 0 &&
      proposals.sent.length === 0 &&
      shownDeclines.length === 0 &&
      friendRequests.incoming.length === 0 ? (
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
      {proposals.incoming.length === 0 &&
      proposals.sent.length === 0 &&
      shownDeclines.length === 0 ? null : (
        <View style={styles.list}>
          <ThemedText variant="caption" themeColor="textTertiary">
            {t('notifications.transfers')}
          </ThemedText>
          {/* Las que piden respuesta primero; debajo, las que la esperan; al final, las rechazadas. */}
          {[...proposals.incoming, ...proposals.sent, ...shownDeclines].map((proposal) => (
            <ProposalCard
              key={proposal.proposalId}
              proposal={proposal}
              currency={currency}
              busy={actions.busy === proposal.proposalId}
              onAccept={() => {
                acceptProposal(proposal);
              }}
              onDecline={() => {
                declineProposal(proposal);
              }}
              onCancel={() => {
                cancelProposal(proposal);
              }}
            />
          ))}
        </View>
      )}
      {friendRequests.incoming.length === 0 ? null : (
        <View style={styles.list}>
          <ThemedText variant="caption" themeColor="textTertiary">
            {t('notifications.friends')}
          </ThemedText>
          {friendRequests.incoming.map((request) => (
            <FriendRequestRow
              key={request.requestId}
              request={request}
              headline={t('friends.wantsToAdd', { name: friendName(request) })}
              busy={friendActions.busy === request.requestId}
              onAccept={() => {
                void friendActions.accept(request.requestId).then(explainFriend);
              }}
              onDecline={() => {
                declineFriend(request);
              }}
              onCancel={() => {
                /* Una saliente no se lista aquí: no hay nada que cancelar. */
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
