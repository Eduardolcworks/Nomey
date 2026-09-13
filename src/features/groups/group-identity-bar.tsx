import { StyleSheet, Text, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import { Icon, IconButton, ThemedText } from '@/ui/components';
import { Spacing, Symbols, useTheme } from '@/ui/theme';

/**
 * LA IDENTIDAD DEL GRUPO, EN UNA FILA. Debajo de la barra compartida.
 *
 *   [‹]  [emoji]  [ nombre del grupo ]   [👥 4] [↗] [✎]
 *
 * Ese orden y no otro: primero cómo salir, después qué grupo es, y al final lo
 * que se puede hacer con él. Los controles de la derecha comparten tamaño,
 * tratamiento y área táctil porque son el mismo tipo de cosa.
 *
 * **El nombre cede.** `flex: 1` con `minWidth: 0`: un nombre largo se trunca en
 * vez de empujar los botones fuera de la pantalla. Sin `minWidth: 0` el ancho
 * mínimo de un contenedor flexible es el de su contenido, y crecería. El
 * contador de participantes tiene ancho de contenido, así que el nombre cede
 * ANTES de que ningún control se mueva.
 *
 * **Editar es un lápiz, nunca un engranaje.** Un engranaje son ajustes de la
 * aplicación; esto cambia el nombre, el emoji y los participantes de UN grupo.
 * `Symbols.edit` ya resuelve el par —`pencil` en Apple, `edit` en Material—.
 *
 * ═══════════ QUÉ ES CONTROL Y QUÉ NO, HOY ═══════════
 *
 * - **El lápiz es un `IconButton` real**: abre el editor del grupo. Sin
 *   `onEdit` —un grupo aún sin confirmar— se pinta apagado y lo anuncia.
 * - **El contador de participantes NO es un control.** Enseña el número REAL
 *   —participantes del contrato vigente, con o sin cuenta, también en un grupo
 *   proyectado offline— y lo anuncia con su etiqueta, pero no abre nada: la
 *   pantalla de participantes no existe todavía, y un botón que no lleva a
 *   ninguna parte es peor que un dato. Queda fuera del recorrido interactivo,
 *   no del accesible.
 * - **Compartir sigue siendo dibujo**: sin flujo, sin rol, fuera del recorrido.
 */
export type GroupIdentityBarProps = {
  readonly emoji: string;
  readonly name: string;
  /**
   * Cuántos participantes tiene el grupo, o `null` si aún no se sabe.
   *
   * Cuenta PARTICIPANTES (F03/ADR-009: identidades contextuales, tengan cuenta o
   * no), nunca membresías. Con `null` no se pinta un cero: se deja el icono
   * solo, que es lo que se sabe.
   */
  readonly participantCount: number | null;
  /** Volver a Grupos. */
  readonly onBack: () => void;
  /** Abrir el editor. Ausente mientras el grupo no tiene fila autoritativa. */
  readonly onEdit?: () => void;
  /** Compartir el grupo (F09/ADR-004): la ventana con el QR y la hoja del sistema. */
  readonly onShare?: () => void;
};

/** El tamaño del glifo de las acciones, y su objetivo táctil. */
const GLYPH = 20;

export function GroupIdentityBar({
  emoji,
  name,
  participantCount,
  onBack,
  onEdit,
  onShare,
}: GroupIdentityBarProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const countLabel =
    participantCount === null
      ? t('groups.participants')
      : participantCount === 1
        ? t('group.participantCountOne')
        : t('group.participantCount', { count: String(participantCount) });

  return (
    <View style={styles.bar}>
      <IconButton name={Symbols.back} label={t('action.close')} size={GLYPH} onPress={onBack} />

      {/* Decorativo: quien nombra al grupo es el texto de al lado. */}
      <Text style={styles.emoji}>{emoji}</Text>

      <ThemedText variant="heading" numberOfLines={1} style={styles.name}>
        {name}
      </ThemedText>

      <View style={styles.actions}>
        {/*
         * EL CONTADOR: icono + número, un solo elemento accesible que dice
         * «4 participantes». No es botón y no lo anuncia como tal.
         */}
        <View accessible accessibilityLabel={countLabel} style={[styles.action, styles.count]}>
          <Icon name={Symbols.groups} size={GLYPH} colour={theme.textSecondary} />
          {participantCount === null ? null : (
            <ThemedText variant="caption" themeColor="textSecondary">
              {String(participantCount)}
            </ThemedText>
          )}
        </View>

        {/* Compartir: un control real desde F09/ADR-004; apagado sin ámbito confirmado. */}
        <IconButton
          name={Symbols.share}
          label={t('group.shareTitle')}
          size={GLYPH}
          onPress={onShare ?? (() => undefined)}
          disabled={onShare === undefined}
        />

        <IconButton
          name={Symbols.edit}
          label={t('group.editGroup')}
          size={GLYPH}
          onPress={onEdit ?? (() => undefined)}
          disabled={onEdit === undefined}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  emoji: {
    fontSize: 26,
    lineHeight: 32,
  },
  /** Se queda con el sitio que sobra, y se trunca antes de empujar nada. */
  name: {
    flex: 1,
    minWidth: 0,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  /**
   * El mismo cuadro de 44 que usa `IconButton`, para que los controles de la
   * fila —la flecha incluida— tengan idéntica área y se alineen sin ajustes.
   */
  action: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * El contador crece a lo ancho con su número —dos cifras caben sin apretar—
   * y sigue midiendo 44 de alto para alinear con los demás.
   */
  count: {
    width: undefined,
    minWidth: 44,
    flexDirection: 'row',
    gap: Spacing.xxs,
    paddingHorizontal: Spacing.xs,
  },
});
