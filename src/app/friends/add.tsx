import { useRouter } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';

import {
  CandidateField,
  CandidateResult,
  FRIEND_FAILURE_KEY,
  type FriendActions,
  type FriendFailure,
  settledAfterRefusal,
  useCreateFriendRequest,
  useFriendActions,
  useLookupCandidate,
} from '@/features/friends';
import { PlaceholderScreen } from '@/features/shell';
import { useTranslation } from '@/lib/i18n';
import { ThemedText } from '@/ui/components';
import { Spacing } from '@/ui/theme';

/**
 * AÑADIR AMIGO — by exact `@username`, and by nothing else.
 *
 * One field, one explicit search, one server call
 * (`api.lookup_friend_candidate`), and one offer that depends on the
 * relation the server reported. No autocomplete, no global listing, no
 * partial match, no e-mail, no uid — and no second call to
 * `api.resolve_username`, which would spend a second lookup out of the
 * twenty the resolver allows per ten minutes to learn what the first call
 * already said.
 *
 * ═══════ THE CROSSED REQUEST ═══════
 *
 * `api.create_friend_request` locks the pair before it inserts, and if the
 * other side had already asked it inserts NOTHING and answers
 * `incoming_pending` with their request's id (F12/ADR-005 §4: never an
 * automatic friendship for «enviar»). The screen applies that answer
 * literally — «Te ha enviado una solicitud», [Aceptar] [Rechazar] — instead
 * of claiming an outgoing request was created. The same goes for `friends`,
 * `cooldown` and `not_found`: what is painted is what the server said, never
 * what was intended.
 *
 * Nothing here is optimistic. A transport failure leaves the state exactly
 * as it was and says so; the `client_command_id` is kept so a retry replays
 * instead of asking twice.
 */
export default function AddFriendScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const lookup = useLookupCandidate();
  const creation = useCreateFriendRequest();
  const actions = useFriendActions();

  const busy = creation.creating || actions.busy !== null;

  const explain = (failure: FriendFailure) => {
    Alert.alert(
      t(settledAfterRefusal(failure) ? 'friends.actionMovedTitle' : 'friends.actionFailedTitle'),
      t(FRIEND_FAILURE_KEY[failure]),
      [{ text: t('action.understood') }],
    );
  };

  const add = () => {
    if (lookup.state.kind !== 'found') return;
    const handle = lookup.state.handle;
    void creation.create(handle).then((outcome) => {
      if (outcome.kind === 'failed') {
        explain(outcome.failure);
        return;
      }
      lookup.applyCreate(outcome.answer);
    });
  };

  const settle = (run: FriendActions['accept'], settled: 'accepted' | 'declined' | 'cancelled') => {
    if (lookup.state.kind !== 'found' || lookup.state.requestId === null) return;
    void run(lookup.state.requestId).then((outcome) => {
      if (outcome.kind === 'done') {
        lookup.applySettled(settled);
        return;
      }
      explain(outcome.failure);
      /*
       * The other side got there first. The request is not pending any more,
       * so the offer must not stay on screen; what the relation IS now is a
       * question for the server, and the person can search again.
       */
      if (settledAfterRefusal(outcome.failure)) lookup.applySettled('gone');
    });
  };

  return (
    <PlaceholderScreen title="friends.add">
      <CandidateField lookup={lookup} />

      {lookup.state.kind === 'found' ? (
        <CandidateResult
          relation={lookup.state.relation}
          handle={lookup.state.handle}
          publicName={lookup.state.publicName}
          requestId={lookup.state.requestId}
          busy={busy}
          onAdd={add}
          onAccept={() => {
            settle(actions.accept, 'accepted');
          }}
          onDecline={() => {
            settle(actions.decline, 'declined');
          }}
          onCancel={() => {
            settle(actions.cancel, 'cancelled');
          }}
        />
      ) : null}

      <View style={styles.footer}>
        <ThemedText
          variant="bodySmall"
          themeColor="textTertiary"
          accessibilityRole="link"
          onPress={() => {
            router.back();
          }}>
          {t('friends.backToList')}
        </ThemedText>
      </View>
    </PlaceholderScreen>
  );
}

const styles = StyleSheet.create({
  footer: {
    paddingTop: Spacing.md,
    alignItems: 'center',
  },
});
