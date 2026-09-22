import { StyleSheet, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import { ActionButton, IdentityLine, ThemedText } from '@/ui/components';
import { Spacing, Symbols, useTheme } from '@/ui/theme';

import type { FriendRequest } from './friend';

/**
 * ONE PENDING REQUEST, in either direction.
 *
 *   ┌───┬──────────────────────────────┐
 *   │ 👤│ Eduardo                      │
 *   │   │ @edu13                       │
 *   │   [Aceptar] [Rechazar]           │   ← incoming
 *   └───┴──────────────────────────────┘
 *   ┌───┬──────────────────────────────┐
 *   │ 👤│ Aitor                        │
 *   │   │ @aitor · Pendiente           │
 *   │   [Cancelar solicitud]           │   ← outgoing
 *   └───┴──────────────────────────────┘
 *
 * The identity is the whole content: a friendship carries no amount, no
 * concept and nothing economic. The direction decides the buttons, and the
 * word «Pendiente» is there for the outgoing one because a row with a single
 * grey button would not say WHY it is waiting — state is never carried by
 * colour or position alone (design-direction §8).
 *
 * `headline` lets a caller say the request as a sentence instead
 * («Eduardo quiere añadirte como amigo»), which is what Notificaciones
 * needs: there the row is news, and in `/friends` it is a list item.
 */
export function FriendRequestRow({
  request,
  headline,
  busy,
  onAccept,
  onDecline,
  onCancel,
}: {
  readonly request: FriendRequest;
  readonly headline?: string;
  readonly busy: boolean;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  const incoming = request.direction === 'incoming';

  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      {headline === undefined ? null : <ThemedText variant="bodyStrong">{headline}</ThemedText>}
      <IdentityLine
        name={request.counterpartPublicName}
        handle={request.counterpartHandle}
        fallback={t('friends.unknown')}
        glyph={Symbols.person}
      />
      {incoming ? null : (
        <ThemedText variant="caption" themeColor="textTertiary">
          {t('friends.pending')}
        </ThemedText>
      )}

      <View style={styles.actions}>
        {incoming ? (
          <>
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
          </>
        ) : (
          <ActionButton
            label={t('friends.cancelRequest')}
            tone="secondary"
            material="control"
            busy={busy}
            disabled={busy}
            onPress={onCancel}
            style={styles.action}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingTop: Spacing.xxs,
  },
  action: {
    flexGrow: 1,
  },
});
