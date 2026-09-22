import { StyleSheet, View } from 'react-native';

import { type MessageKey, useTranslation } from '@/lib/i18n';
import { ActionButton, IdentityLine, ThemedText } from '@/ui/components';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

import type { CandidateRelation } from './friend-candidate';

/**
 * WHOEVER WAS FOUND, AND THE ONE THING THAT CAN BE DONE WITH THEM.
 *
 * The relation is the server's word, and each one has exactly one offer
 * (F12/ADR-005 §5):
 *
 * | relation           | line                           | buttons              |
 * | ------------------ | ------------------------------ | -------------------- |
 * | `none`             | —                              | Añadir amigo         |
 * | `outgoing_pending` | Solicitud enviada              | Cancelar solicitud   |
 * | `incoming_pending` | Te ha enviado una solicitud    | Aceptar · Rechazar   |
 * | `friends`          | Ya sois amigos                 | —                    |
 * | `cooldown`         | No puedes enviar otra…         | —                    |
 *
 * **`cooldown` says nothing about what happened.** It is a refusal with no
 * detail on purpose: telling the person their request was declined, or when,
 * or by whom, would publish someone else's decision. The copy is neutral and
 * stays neutral.
 *
 * **Cancelling and answering need the request's id**, which the lookup
 * publishes for the two pending relations and only for those. Without it the
 * buttons are not offered: nothing here guesses which request is meant.
 */
const RELATION_KEY: Readonly<Record<CandidateRelation, MessageKey | null>> = {
  none: null,
  outgoing_pending: 'friends.requestSent',
  incoming_pending: 'friends.incomingHint',
  friends: 'friends.already',
  cooldown: 'friends.cooldown',
};

export function CandidateResult({
  relation,
  handle,
  publicName,
  requestId,
  busy,
  onAdd,
  onAccept,
  onDecline,
  onCancel,
}: {
  readonly relation: CandidateRelation;
  readonly handle: string;
  readonly publicName: string | null;
  readonly requestId: string | null;
  readonly busy: boolean;
  readonly onAdd: () => void;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  const line = RELATION_KEY[relation];
  const actionable = requestId !== null;

  return (
    <View
      style={[styles.card, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
      <IdentityLine
        name={publicName}
        handle={handle}
        fallback={t('friends.unknown')}
        glyph={Symbols.person}
      />
      {line === null ? null : (
        <ThemedText variant="caption" themeColor="textTertiary" accessibilityLiveRegion="polite">
          {t(line)}
        </ThemedText>
      )}

      {relation === 'none' ? (
        <View style={styles.actions}>
          <ActionButton
            label={t('friends.add')}
            tone="brand"
            busy={busy}
            disabled={busy}
            onPress={onAdd}
            style={styles.action}
          />
        </View>
      ) : relation === 'incoming_pending' && actionable ? (
        <View style={styles.actions}>
          <ActionButton
            label={t('friends.accept')}
            tone="brand"
            busy={busy}
            disabled={busy}
            onPress={onAccept}
            style={styles.action}
          />
          <ActionButton
            label={t('friends.decline')}
            tone="secondary"
            material="control"
            disabled={busy}
            onPress={onDecline}
            style={styles.action}
          />
        </View>
      ) : relation === 'outgoing_pending' && actionable ? (
        <View style={styles.actions}>
          <ActionButton
            label={t('friends.cancelRequest')}
            tone="secondary"
            material="control"
            busy={busy}
            disabled={busy}
            onPress={onCancel}
            style={styles.action}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  action: {
    flexGrow: 1,
  },
});
