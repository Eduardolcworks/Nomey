import { StyleSheet, View } from 'react-native';

import { useFormat } from '@/lib/format';
import { type MessageKey, useTranslation } from '@/lib/i18n';
import { GlassPressable, Icon, ThemedText } from '@/ui/components';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

import type { GroupNotice } from './membership-service';

/**
 * UN AVISO DE GRUPO EN LA CAMPANA. F09/ADR-003 §7.
 *
 * Cuatro clases, una frase cada una, y el nombre del grupo delante: quien
 * lee la campana no está en ningún grupo. **Sin leer** se dice con texto, no
 * sólo con el punto (design-direction.md §8). Tocar abre el grupo —la fila es
 * de la membresía, así que el grupo se puede abrir— y lo marca leído.
 *
 * No se enseña ningún importe ni concepto: el aviso dice QUÉ pasó y DÓNDE; lo
 * que cambió se ve dentro, con su historial.
 */
const KEY: Readonly<Record<GroupNotice['kind'], MessageKey>> = {
  edit: 'notice.edit',
  profile: 'notice.profile',
  departure: 'notice.departure',
  settlement: 'notice.settlement',
  payment: 'notice.payment',
  payment_annulled: 'notice.paymentAnnulled',
};

export function GroupNoticeCard({
  notice,
  fresh = false,
  onOpen,
}: {
  readonly notice: GroupNotice;
  /**
   * Estaba sin leer al entrar en la campana. La campana da por vistos los
   * pendientes al abrirse, y sin esto la marca «Nuevo» desaparecería delante
   * de la persona antes de que llegara a leer qué era nuevo: se conserva
   * durante la visita, y a la siguiente ya no está.
   */
  readonly fresh?: boolean;
  readonly onOpen: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const theme = useTheme();

  const unread = fresh || notice.readAt === null;
  const line = t(KEY[notice.kind], { name: notice.participantDisplayName ?? '' });
  const when = format.date(notice.occurredAt.slice(0, 10), 'long');
  const who = notice.byMe ? ` · ${t('notice.byMe')}` : '';

  return (
    <GlassPressable
      label={`${notice.groupDisplayName}. ${line}. ${unread ? t('notice.unread') : ''} ${t('notice.open', { group: notice.groupDisplayName })}`}
      depth="well"
      rim="soft"
      radius={Radius.lg}
      onPress={onOpen}>
      <View style={styles.card}>
        <View style={[styles.badge, { backgroundColor: theme.surfaceRaised }]}>
          <Icon
            name={notice.kind === 'departure' ? Symbols.leave : Symbols.notifications}
            size={16}
            colour={unread ? theme.accent : theme.textSecondary}
          />
        </View>
        <View style={styles.copy}>
          <ThemedText variant="bodyStrong" numberOfLines={1}>
            {notice.groupDisplayName}
          </ThemedText>
          <ThemedText
            variant="body"
            themeColor={unread ? 'text' : 'textSecondary'}
            numberOfLines={2}>
            {line}
          </ThemedText>
          <ThemedText variant="caption" themeColor="textTertiary" numberOfLines={1}>
            {when}
            {who}
            {unread ? ` · ${t('notice.unread')}` : ''}
          </ThemedText>
        </View>
      </View>
    </GlassPressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  badge: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.xxs,
  },
});
