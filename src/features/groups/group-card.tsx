import { Pressable, StyleSheet, Text, View } from 'react-native';

import { currencyDefinition, money } from '@/domain';
import { useFormat } from '@/lib/format';
import { pluralCategory, useTranslation } from '@/lib/i18n';
import { AmountPlate, Icon, ThemedText } from '@/ui/components';
import { HomeCardRelief, homeCardSurface, Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

import { positionAmount, positionLabel, positionState, positionTone } from './group-position';
import type { ProjectedGroup } from './group-projection';

/**
 * UN GRUPO EN LA LISTA. **Una sola superficie pulsable.**
 *
 * ═══════════ LA COMPOSICIÓN ═══════════
 *
 *   [emoji]  [ nombre del grupo        ]  [ posición neta ]  [›]
 *            [ icono · N participantes ]
 *
 * El emoji y el galón se centran respecto a la tarjeta entera; la columna del
 * medio apila nombre y contador; y a su derecha va la posición del actor en el
 * grupo. Todo en el flujo: ni una coordenada manual, para que agrandar el tipo
 * de letra del sistema no descoloque nada.
 *
 * **El nombre se recorta, nunca empuja.** `flex: 1` con `minWidth: 0` sobre la
 * columna del medio: un nombre largo encoge esa columna hasta truncarse y deja
 * intactos el oblongo y el galón, que no participan en el reparto.
 *
 * ═══════════ QUÉ ES INTERACTIVO, Y QUÉ NO ═══════════
 *
 * Toda la tarjeta es el control, y sólo ella. El oblongo de la posición **no es
 * otro botón**: es la misma pieza de Inicio —`AmountPlate`, en `ui/`—, plana,
 * sin rol de botón y sin sombreado táctil. El emoji, el icono de persona y el
 * galón son decorativos; lo que un lector de pantalla anuncia es una sola
 * etiqueta con nombre, participantes, estado e importe.
 *
 * **Y no se distingue lo pendiente.** Un grupo recién creado y uno confirmado se
 * pintan igual: F07/ADR-001, invariante 13.
 */
export type GroupCardProps = {
  readonly group: ProjectedGroup;
  readonly onPress: () => void;
  /**
   * Salir del grupo, por la vía accesible. El gesto de deslizar y el menú al
   * mantener pulsado no existen para un lector de pantalla; con esto la acción
   * aparece en el rotor y llama a la MISMA puerta. Ausente cuando la tarjeta
   * todavía no permite salir.
   */
  readonly onLeave?: () => void;
};

export function GroupCard({ group, onPress, onLeave }: GroupCardProps) {
  const { t, locale } = useTranslation();
  const format = useFormat();
  const theme = useTheme();

  /*
   * EL CONTADOR: UN NÚMERO EN PANTALLA, LA FRASE ENTERA PARA QUIEN ESCUCHA.
   *
   * Lo que se ve es `👤 2`, sin la palabra. El icono ya dice de qué se está
   * contando, y repetirlo en texto consumía el ancho que la columna necesita
   * para el nombre — medido: a 360 dp con la fuente al 150 % la palabra se
   * truncaba con elipsis, que es peor que no estar.
   *
   * **La descripción completa NO se pierde: se muda.** Un icono no se lee en voz
   * alta, así que la frase pluralizada —«1 participante», «2 participantes»— es
   * exactamente lo que la etiqueta accesible sigue anunciando. La pluralización
   * se conserva por eso, no por inercia.
   *
   * La cuenta incluye a quien creó el grupo y a todos los participantes con
   * nombre, tengan cuenta o no — es el `participant_count` que devuelve el
   * servidor y el `1 + participants.length` que calcula la entrada local, que son
   * la misma cuenta. El hueco final vacío del formulario nunca entra: no es
   * nadie.
   */
  const participants = t(
    pluralCategory(locale, group.participantCount) === 'one'
      ? 'group.participantsOne'
      : 'group.participantsOther',
    { count: group.participantCount },
  );

  /*
   * LA POSICIÓN, EN LA DIVISA BASE DEL GRUPO.
   *
   * La definición monetaria sale del propio grupo —código y escala—, nunca del
   * Modo Personal y nunca presuponiendo dos decimales (F02/ADR-001 §3). El importe
   * se enseña sin signo: la dirección la dice la etiqueta.
   */
  const state = positionState(group.position);
  const minor = positionAmount(group.position);
  const amount =
    minor === null
      ? t('home.amountPending')
      : format.money(
          money(
            minor,
            currencyDefinition({
              id: group.currencyDefinitionId,
              code: group.currencyCode,
              scale: group.currencyScale,
            }),
          ),
        );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('groups.cardLabel', {
        name: group.displayName,
        participants,
        position: `${t(positionLabel(state))} ${amount}`,
      })}
      accessibilityActions={
        onLeave === undefined ? undefined : [{ name: 'leave', label: t('groups.menuLeave') }]
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'leave') onLeave?.();
      }}
      onPress={onPress}
      style={[
        styles.card,
        { backgroundColor: homeCardSurface(theme.surface), borderColor: theme.border },
        HomeCardRelief,
      ]}>
      {/* Decorativo: lo que identifica al grupo es su nombre, que va al lado. */}
      <Text style={styles.emoji}>{group.emoji}</Text>

      <View style={styles.identity}>
        {/*
         * `bodyStrong` (17/22/500) y no `subheading` (20/25/600): un escalón por
         * debajo en tamaño, conservando el peso que lo mantiene como elemento
         * principal de esta zona frente al contador, que es `caption`.
         */}
        <ThemedText variant="bodyStrong" numberOfLines={1}>
          {group.displayName}
        </ThemedText>

        {/*
         * `accessible={false}` sobre la fila entera: el número suelto no dice
         * nada por sí mismo, y quien lo nombra es la etiqueta de la tarjeta con
         * la frase completa. Sin esto, un lector de pantalla podría anunciar «2»
         * a secas como un nodo aparte.
         */}
        <View style={styles.count} accessible={false}>
          <Icon name={Symbols.person} size={13} colour={theme.textTertiary} />
          <ThemedText variant="caption" themeColor="textTertiary" numberOfLines={1}>
            {String(group.participantCount)}
          </ThemedText>
        </View>
      </View>

      <AmountPlate label={t(positionLabel(state))} size="compact">
        <ThemedText variant="bodyStrong" themeColor={positionTone(state)} numberOfLines={1}>
          {amount}
        </ThemedText>
      </AmountPlate>

      <Icon name={Symbols.forward} size={13} colour={theme.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  emoji: {
    fontSize: 26,
    lineHeight: 32,
  },
  /**
   * La columna que cede: se queda con el sitio que sobra y se recorta.
   *
   * `minWidth: 0` acompaña al `flex: 1` a propósito. Sin él, el ancho mínimo de
   * un contenedor flexible es el de su contenido, así que un nombre largo
   * ensancharía la columna y empujaría al oblongo fuera en vez de truncarse.
   */
  identity: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.xxs,
  },
  /**
   * El icono y su número, alineados bajo el nombre.
   *
   * `alignSelf: 'flex-start'` es lo que los mantiene a la izquierda de la
   * columna cuando ya no hay palabra que la llene: sin él la fila se estiraría a
   * todo el ancho disponible y el par quedaría suelto en una caja vacía.
   *
   * `gap: xs` en vez de `xxs`: con la palabra al lado, dos puntos bastaban para
   * separar icono y texto; con un número solo, esa separación los pegaba y el
   * conjunto se leía como un glifo raro.
   */
  count: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.xs,
  },
});
