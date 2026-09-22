import { StyleSheet, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import { ActionMenu, IdentityLine, type LongPressMenuAction } from '@/ui/components';
import { Spacing, Symbols, useTheme } from '@/ui/theme';

import type { Friend } from './friend';

export const REMOVE_FRIEND_ACTION = 'remove';

/**
 * ONE FRIEND, as a line and not as a card.
 *
 * `/friends` is a social list, so a friend is a name and the handle that
 * makes it verifiable (F12/ADR-001 §10) — nothing else. There is no amount,
 * no date and no state word, because a friendship in this block has none of
 * those: it is active or it is not on the list.
 *
 * **The removal is contextual, and not a button on every row.** Ending a
 * friendship is rare and irreversible for that instance, so it lives behind
 * the same native menu a group participant uses (`ActionMenu`), marked
 * destructive by the system. The confirmation is the screen's: this
 * component only says what was chosen.
 */
export function FriendRow({
  friend,
  onRemove,
}: {
  readonly friend: Friend;
  readonly onRemove: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  const actions: readonly LongPressMenuAction[] = [
    {
      id: REMOVE_FRIEND_ACTION,
      title: t('friends.remove'),
      icon: Symbols.removeFriend,
      destructive: true,
    },
  ];

  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <ActionMenu
        actions={actions}
        onSelect={(id) => {
          if (id === REMOVE_FRIEND_ACTION) onRemove();
        }}>
        <IdentityLine
          name={friend.counterpartPublicName}
          handle={friend.counterpartHandle}
          fallback={t('friends.unknown')}
          glyph={Symbols.person}
        />
      </ActionMenu>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingVertical: Spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
