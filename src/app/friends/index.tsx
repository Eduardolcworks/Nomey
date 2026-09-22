import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import {
  type Friend,
  type FriendRequest,
  FRIEND_FAILURE_KEY,
  FriendRequestRow,
  FriendRow,
  settledAfterRefusal,
  useFriendActions,
  useMyFriendRequests,
  useMyFriends,
} from '@/features/friends';
import { isGuest, useSession } from '@/features/session';
import { PlaceholderScreen } from '@/features/shell';
import { useTranslation } from '@/lib/i18n';
import { ActionButton, EmptyState, ErrorState, ThemedText } from '@/ui/components';
import { Spacing, Symbols } from '@/ui/theme';

/**
 * AMIGOS — a social list, and deliberately nothing more.
 *
 *   Solicitudes recibidas        (only when there are any)
 *     Eduardo · @edu13           [Aceptar] [Rechazar]
 *
 *   Solicitudes enviadas         (only when there are any)
 *     Aitor · @aitor · Pendiente [Cancelar solicitud]
 *
 *   Amigos
 *     Ana · @ana                 (menú contextual → Eliminar amigo)
 *
 *   [Añadir amigo]
 *
 * **An empty section is not a section.** With nothing received and nothing
 * sent the screen is the friends list and the call to action, because a
 * heading over a box saying «no hay nada» is three lines spent to say
 * nothing. Only the friends list has an empty state, and it is one compact
 * line plus the same call to action.
 *
 * **What is listed is what the server publishes, and nothing is filtered
 * here.** `api.my_friend_requests` publishes only requests whose derived
 * state is `pending`, and `api.my_friends` only friendships with
 * `ended_at is null` — so accepted history, declines, cancellations and
 * expiries never arrive, and no client-side filter pretends to drop them.
 *
 * **Every action is server-authoritative.** Accepting, declining,
 * cancelling and removing publish their change only after the server
 * confirms; offline, nothing moves and the failure is said out loud.
 */
export default function FriendsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { state: session } = useSession();
  const actorId = session.status === 'signed-in' ? session.identity.userId : '';
  /*
   * A guest never reaches this route — the root layout keeps it out — and
   * this is the second barrier, not the first: with no normal account the
   * two reads would be refused by `sec.assert_friend_actor` anyway.
   */
  const enabled = actorId !== '' && !isGuest(session);

  const requests = useMyFriendRequests(actorId, enabled);
  const friends = useMyFriends(actorId, enabled);
  const actions = useFriendActions();

  /*
   * Coming back to this screen asks again. It is the fourth trigger the two
   * hooks have — actor, `friendsChanged`, foreground `wake` — and the one
   * that covers «I answered from Notificaciones and came back here».
   */
  const { refresh: refreshRequests } = requests;
  const { refresh: refreshFriends } = friends;
  useFocusEffect(
    useCallback(() => {
      refreshRequests();
      refreshFriends();
    }, [refreshRequests, refreshFriends]),
  );

  const nameOf = (row: {
    counterpartPublicName: string | null;
    counterpartHandle: string | null;
  }) =>
    row.counterpartPublicName ??
    (row.counterpartHandle === null ? t('friends.unknown') : `@${row.counterpartHandle}`);

  const explain = (outcome: Awaited<ReturnType<typeof actions.accept>>) => {
    if (outcome.kind !== 'failed') return;
    Alert.alert(
      t(
        settledAfterRefusal(outcome.failure)
          ? 'friends.actionMovedTitle'
          : 'friends.actionFailedTitle',
      ),
      t(FRIEND_FAILURE_KEY[outcome.failure]),
      [{ text: t('action.understood') }],
    );
  };

  const decline = (request: FriendRequest) => {
    Alert.alert(t('friends.declineTitle'), t('friends.declineBody', { name: nameOf(request) }), [
      { text: t('action.cancel'), style: 'cancel' },
      {
        text: t('friends.decline'),
        style: 'destructive',
        onPress: () => {
          void actions.decline(request.requestId).then(explain);
        },
      },
    ]);
  };

  const cancel = (request: FriendRequest) => {
    Alert.alert(t('friends.cancelTitle'), t('friends.cancelBody', { name: nameOf(request) }), [
      { text: t('action.close'), style: 'cancel' },
      {
        text: t('friends.cancelRequest'),
        style: 'destructive',
        onPress: () => {
          void actions.cancel(request.requestId).then(explain);
        },
      },
    ]);
  };

  /*
   * ELIMINAR AMIGO, con confirmación y sin optimismo.
   *
   * La fila NO desaparece al tocar: desaparece cuando el servidor lo
   * confirma y la relectura deja de publicarla. Si falla —o no hay red— la
   * lista sigue como está y se dice por qué, que es lo contrario de fingir
   * que se hizo.
   */
  const remove = (friend: Friend) => {
    Alert.alert(t('friends.removeTitle'), t('friends.removeBody', { name: nameOf(friend) }), [
      { text: t('action.cancel'), style: 'cancel' },
      {
        text: t('action.delete'),
        style: 'destructive',
        onPress: () => {
          void actions.remove(friend.friendshipId).then(explain);
        },
      },
    ]);
  };

  const addFriend = () => {
    router.push('/friends/add');
  };

  const failed = requests.failed || friends.failed;

  return (
    <PlaceholderScreen title="friends.title">
      {failed ? (
        <ErrorState
          title={t('friends.loadFailed')}
          retry={{
            label: t('action.retry'),
            onPress: () => {
              requests.refresh();
              friends.refresh();
            },
          }}
        />
      ) : null}

      {requests.incoming.length === 0 ? null : (
        <View style={styles.block}>
          <ThemedText variant="caption" themeColor="textTertiary">
            {t('friends.incomingTitle')}
          </ThemedText>
          {requests.incoming.map((request) => (
            <FriendRequestRow
              key={request.requestId}
              request={request}
              busy={actions.busy === request.requestId}
              onAccept={() => {
                void actions.accept(request.requestId).then(explain);
              }}
              onDecline={() => {
                decline(request);
              }}
              onCancel={() => {
                cancel(request);
              }}
            />
          ))}
        </View>
      )}

      {requests.outgoing.length === 0 ? null : (
        <View style={styles.block}>
          <ThemedText variant="caption" themeColor="textTertiary">
            {t('friends.outgoingTitle')}
          </ThemedText>
          {requests.outgoing.map((request) => (
            <FriendRequestRow
              key={request.requestId}
              request={request}
              busy={actions.busy === request.requestId}
              onAccept={() => {
                void actions.accept(request.requestId).then(explain);
              }}
              onDecline={() => {
                decline(request);
              }}
              onCancel={() => {
                cancel(request);
              }}
            />
          ))}
        </View>
      )}

      {friends.friends.length === 0 ? (
        friends.loading || failed ? null : (
          <EmptyState symbol={Symbols.friends} title={t('friends.empty')} />
        )
      ) : (
        <View style={styles.block}>
          <ThemedText variant="caption" themeColor="textTertiary">
            {t('friends.listTitle')}
          </ThemedText>
          {friends.friends.map((friend) => (
            <FriendRow
              key={friend.friendshipId}
              friend={friend}
              onRemove={() => {
                remove(friend);
              }}
            />
          ))}
        </View>
      )}

      <ActionButton label={t('friends.add')} tone="brand" onPress={addFriend} />
    </PlaceholderScreen>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: Spacing.xs,
    paddingTop: Spacing.sm,
  },
});
