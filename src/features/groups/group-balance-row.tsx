import { StyleSheet, View } from 'react-native';

import { type CurrencyDefinition, money } from '@/domain';
import { useFormat } from '@/lib/format';
import { type MessageKey, useTranslation } from '@/lib/i18n';
import {
  ActionButton,
  ActionMenu,
  Icon,
  type LongPressMenuAction,
  ThemedText,
} from '@/ui/components';
import { Radius, Spacing, Symbols, type TextColor, useTheme } from '@/ui/theme';

import type { GroupBalanceRow as Row } from './group-service';

/**
 * UNA PERSONA DEL GRUPO Y SU POSICIÓN.
 *
 *   ┌───┬──────────────────┬──────────┬──────────────┐
 *   │ 👤│ Sel (Tú)         │          │   Le deben   │
 *   │   │                  │          │    16,50 €   │
 *   └───┴──────────────────┴──────────┴──────────────┘
 *   ┌───┬──────────────────┬──────────┬──────────────┐
 *   │ ⇥ │ Ana              │[Saldado] │     Debe     │
 *   │   │ Inactivo         │          │    13,50 €   │
 *   └───┴──────────────────┴──────────┴──────────────┘
 *
 * **La posición es una cifra con dirección, y la dirección la dice el TEXTO.**
 * El importe va en valor absoluto —«Debe 13,50 €» es lo que alguien diría en voz
 * alta; «Debe −13,50 €» son dos negaciones— y el color acompaña sin decidir
 * nada, que es lo que `design-direction.md` §8 exige para que el estado no
 * dependa de distinguir dos tonos.
 *
 * **Cero es «Saldado», no un hueco.** Aquí llega derivado de los efectos
 * vigentes, así que es un cero CONOCIDO: el participante existe y no debe ni le
 * deben. Es distinto de no haber podido leer, que lo dice la pantalla.
 *
 * **Y no es lo que gastó.** Lo que consumió, lo que adelantó como pagador y su
 * Disponible personal son otras tres cifras.
 *
 * **Una sola fila.** Identidad a la izquierda —avatar y nombre, que es lo que
 * cede—, el botón «Saldado» compacto pegado a la cifra cuando lo hay, y la
 * cifra a la derecha, que no cede ni se recorta. Con un nombre largo y una
 * cifra larga en 360 dp, lo que se acorta es el nombre.
 */
export type GroupBalanceRowProps = {
  readonly balance: Row;
  /** La divisa base del grupo. Todas las posiciones van en ella. */
  readonly currency: CurrencyDefinition;
  /**
   * Salió del grupo (F09/ADR-003 §2). Se dice con la palabra «Inactivo» además del
   * tono: nunca sólo por color (design-direction.md §8).
   */
  readonly inactive?: boolean;
  /**
   * Con una cuenta vinculada Y activo: borde amarillo en el avatar, y «Con
   * cuenta» en la etiqueta. Es la lectura real del servidor (`is_linked`),
   * no una deducción por nombre, foto o presencia. Quien salió no lo lleva
   * aunque conserve el vínculo: su tratamiento es «Inactivo».
   */
  readonly linked?: boolean;
  /**
   * Un menú nativo al TOCAR la identidad, con acciones sobre este participante
   * —eliminar o retirar a uno sin cuenta—. Ausente, la identidad no responde
   * al toque, como hasta ahora. La cifra y «Saldado» quedan siempre fuera.
   */
  readonly menu?: readonly LongPressMenuAction[];
  readonly onMenuSelect?: (id: string) => void;
  /**
   * «Saldado»: presente sólo sobre un inactivo no retirado. Es una declaración
   * de los miembros, no la prueba de un pago; quien lo monta enseña antes los
   * pares y lo manda literal. Aquí sólo se pinta y se anuncia con su nombre.
   */
  readonly onSettle?: () => void;
};

const STATE: Readonly<
  Record<'owed' | 'owing' | 'settled', { readonly key: MessageKey; readonly tone: TextColor }>
> = {
  owed: { key: 'group.owedToThem', tone: 'positive' },
  owing: { key: 'group.theyOwe', tone: 'negative' },
  settled: { key: 'group.settled', tone: 'text' },
};

export function GroupBalanceRow({
  balance,
  currency,
  inactive = false,
  linked = false,
  menu,
  onMenuSelect,
  onSettle,
}: GroupBalanceRowProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const theme = useTheme();

  const net = BigInt(balance.netMinor);
  const state = net > 0n ? 'owed' : net < 0n ? 'owing' : 'settled';
  /* Siempre sin signo: quien dice la dirección es la etiqueta de encima. */
  const shown = money(net < 0n ? -net : net, currency);

  const name = balance.isSelf
    ? t('group.payerYou', { name: balance.displayName })
    : balance.displayName;

  const withAccount = linked && !inactive;

  const summary = [
    name,
    inactive ? t('group.participantInactive') : null,
    withAccount ? t('group.participantLinked') : null,
    `${t(STATE[state].key)} ${format.money(shown)}`,
  ]
    .filter((part) => part !== null)
    .join('. ');

  const hasMenu = menu !== undefined && menu.length > 0 && onMenuSelect !== undefined;

  /*
   * LA IDENTIDAD, avatar y nombre. `accessible` explícito: en Android una vista
   * con etiqueta pero sin él no abre nodo propio y sus hijos se anuncian
   * sueltos. Se lee entera, con la dirección dentro —un color no se anuncia—;
   * «Saldado» es su propio nodo: una acción no se anuncia como parte de una
   * cifra. Con menú, además, es un botón y su pista lo dice.
   */
  const identity = (
    <View
      accessible
      accessibilityRole={hasMenu ? 'button' : undefined}
      accessibilityLabel={summary}
      accessibilityHint={hasMenu ? t('group.participantMenuHint') : undefined}
      style={styles.identity}>
      <View
        style={[
          styles.badge,
          { backgroundColor: theme.surfaceRaised },
          // El mismo amarillo y el mismo grosor que el tick marcado; dentro
          // del círculo, así que ni el tamaño ni la posición cambian.
          withAccount ? { borderWidth: 1.5, borderColor: theme.accent } : null,
        ]}>
        <Icon
          name={inactive ? Symbols.leave : Symbols.person}
          size={16}
          colour={inactive ? theme.textTertiary : theme.textSecondary}
        />
      </View>

      <View style={styles.copy}>
        <ThemedText
          variant="bodyStrong"
          themeColor={inactive ? 'textSecondary' : 'text'}
          numberOfLines={1}>
          {name}
        </ThemedText>
        {inactive ? (
          <ThemedText variant="caption" themeColor="textTertiary" numberOfLines={1}>
            {t('group.participantInactive')}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      {hasMenu ? (
        <ActionMenu actions={menu} onSelect={onMenuSelect}>
          {identity}
        </ActionMenu>
      ) : (
        identity
      )}

      {onSettle === undefined ? null : (
        /*
         * EL OBLONGO COMPACTO: el mismo material amarillo con texto oscuro del
         * «Saldado» de antes, en un cuerpo de 32 con 44 de área táctil. Va
         * inmediatamente a la izquierda de la cifra, y es el nombre quien cede.
         */
        <ActionButton
          label={t('group.settleAction')}
          hint={t('group.settleActionHint', { name: balance.displayName })}
          onPress={onSettle}
          tone="brand"
          size="compact"
        />
      )}

      <View style={styles.amounts}>
        <ThemedText variant="caption" themeColor="textTertiary" numberOfLines={1}>
          {t(STATE[state].key)}
        </ThemedText>
        <ThemedText variant="amountRow" themeColor={STATE[state].tone} numberOfLines={1}>
          {format.money(shown)}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  /** Avatar y nombre: lo que cede. `flex: 1` con `minWidth: 0` recorta el nombre. */
  identity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
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
  },
  /** La cifra no cede nunca: ni ante el nombre ni ante el botón. */
  amounts: {
    alignItems: 'flex-end',
    flexShrink: 0,
    gap: Spacing.xxs,
  },
});
