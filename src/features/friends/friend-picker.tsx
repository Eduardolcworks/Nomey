import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import {
  ActionButton,
  EmptyState,
  ErrorState,
  GlassSurface,
  Icon,
  IdentityLine,
  ThemedText,
} from '@/ui/components';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

import { FRIEND_ROW_HEIGHT, friendListHeight } from './friend-picker-layout';
import { filterFriendChoices, type FriendChoice, friendChoices } from './friend-search';
import { useMyFriends } from './use-my-friends';

/**
 * ELEGIR A UN AMIGO, de los que ya se tienen.
 *
 * Una hoja que sube desde abajo, sobre lo que haya —se presenta con el
 * `Modal` del núcleo, como `DateSheet`, porque tiene que cubrir la pantalla
 * entera y quien la abre vive DENTRO de una ventana que se recorta a sí
 * misma—.
 *
 * **Y no oscurece nada de lo que hay detrás.** El área exterior sigue
 * existiendo y sigue cerrando al tocarla, pero es completamente
 * transparente: no pinta ningún color, no baja ninguna opacidad y no
 * desenfoca. Transferencia se ve exactamente igual con la hoja abierta que
 * sin ella; lo único que cambia es que hay algo encima. Un velo oscuro aquí
 * habría atenuado el importe y el concepto que la persona acaba de escribir
 * —y que sigue necesitando ver mientras elige a quién enviárselos—.
 *
 * **La cabecera no se desplaza.** El título y el buscador son fijos; lo
 * único que se desplaza es la lista, y sólo cuando hay más de seis
 * (`friend-picker-layout.ts`).
 *
 * **No busca en el servidor.** El campo de arriba acota en local la lista que
 * `api.my_friends` ya devolvió (`friend-search.ts`): ni una llamada por
 * tecla, ni `resolve_username`, ni `lookup_friend_candidate`. Esa otra
 * búsqueda —la que encuentra a cualquiera por `@username` exacto— sigue
 * existiendo donde estaba, y este selector no la sustituye.
 *
 * **Lee con el hook que ya hay**, `useMyFriends`, así que hereda sin hacer
 * nada las tres señales de F12.E.B: el actor, `friendsChanged` y el
 * despertar al volver al primer plano. Aceptar o eliminar una amistad se ve
 * aquí sin un segundo hook que mantener en sintonía.
 *
 * **Quien no tenga handle definitivo no se lista** (`friendChoices`): sin
 * handle no hay forma de nombrar a esa persona en un comando.
 */
export function FriendPicker({
  actorId,
  onSelect,
  onClose,
  onSeeFriends,
}: {
  readonly actorId: string;
  readonly onSelect: (choice: FriendChoice) => void;
  readonly onClose: () => void;
  /** «Ver Amigos» del estado vacío. Ausente, no se ofrece. */
  readonly onSeeFriends?: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  const friends = useMyFriends(actorId, actorId !== '');
  const [query, setQuery] = useState('');

  const choices = useMemo(() => friendChoices(friends.friends), [friends.friends]);
  const shown = useMemo(() => filterFriendChoices(choices, query), [choices, query]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.canvas}>
        {/*
         * EL ÁREA EXTERIOR: sólo táctil. Cierra al tocarla y **no pinta
         * nada** — ni color, ni alfa, ni desenfoque—, que es lo que deja lo
         * de debajo intacto.
         */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('action.close')}
          onPress={onClose}
          style={styles.outside}
        />

        <GlassSurface
          level="heavy"
          depth="selected"
          rim="soft"
          radius={Radius.xl}
          style={styles.sheet}>
          <View style={styles.head}>
            <ThemedText variant="label" themeColor="textSecondary" style={styles.headTitle}>
              {t('friends.pickerTitle')}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('action.close')}
              onPress={onClose}
              hitSlop={Spacing.sm}>
              <Icon name={Symbols.close} size={17} colour={theme.textSecondary} shape="circle" />
            </Pressable>
          </View>

          {/*
           * El campo de arriba. Mismo pozo que el buscador del teclado de
           * emojis —se escribe en él— y misma lupa, que aquí significa
           * «acota lo que ves», no «pregunta al servidor».
           */}
          <GlassSurface
            material="control"
            level="regular"
            depth="well"
            rim="soft"
            radius={Radius.full}
            nativeEffect={false}
            style={styles.searchBox}>
            <Icon name={Symbols.search} size={16} colour={theme.textSecondary} shape="circle" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('friends.pickerSearch')}
              placeholderTextColor={theme.textDisabled}
              accessibilityLabel={t('friends.pickerSearch')}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              style={[styles.searchInput, { color: theme.text }]}
            />
          </GlassSurface>

          {friends.failed ? (
            <ErrorState
              title={t('friends.loadFailed')}
              retry={{ label: t('action.retry'), onPress: friends.refresh }}
            />
          ) : choices.length === 0 ? (
            friends.loading ? null : (
              <View style={styles.empty}>
                <EmptyState symbol={Symbols.friends} title={t('friends.empty')} />
                {onSeeFriends === undefined ? null : (
                  <ActionButton
                    label={t('friends.seeFriends')}
                    tone="secondary"
                    material="control"
                    onPress={onSeeFriends}
                  />
                )}
              </View>
            )
          ) : shown.length === 0 ? (
            <ThemedText variant="bodySmall" themeColor="textTertiary" style={styles.noMatches}>
              {t('friends.pickerNoMatches')}
            </ThemedText>
          ) : (
            /*
             * EL ALTO SALE DE CUÁNTAS FILAS HAY, hasta seis. Como `maxHeight`
             * y no como `height`: con menos de seis la lista mide su
             * contenido y no reserva hueco, y a partir de ahí el tope la
             * acota y aparece el desplazamiento. Y se calcula sobre `shown`,
             * no sobre `choices`, así que filtrar encoge la hoja.
             */
            <ScrollView
              style={[styles.list, { maxHeight: friendListHeight(shown.length) }]}
              keyboardShouldPersistTaps="handled">
              {shown.map((choice) => (
                <Pressable
                  key={choice.friendshipId}
                  accessibilityRole="button"
                  accessibilityLabel={`${choice.publicName} @${choice.handle}`}
                  onPress={() => {
                    onSelect(choice);
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    { borderBottomColor: theme.border },
                    pressed ? { backgroundColor: theme.surfaceSunken } : null,
                  ]}>
                  {/*
                   * El nombre arriba y el `@handle` debajo, más pequeño y más
                   * apagado: es exactamente lo que `IdentityLine` ya hace, y
                   * lo que hace verificable a un nombre que dos cuentas
                   * pueden compartir (F12/ADR-001 §10).
                   */}
                  <IdentityLine
                    name={choice.publicName}
                    handle={choice.handle}
                    fallback={t('friends.unknown')}
                  />
                </Pressable>
              ))}
            </ScrollView>
          )}
        </GlassSurface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  /**
   * SIN `backgroundColor`, y eso es el arreglo entero.
   *
   * Llevaba `rgba(0, 0, 0, 0.45)` —copiado de `DateSheet`, donde sí se
   * quiere—, y ese era el oscurecimiento: el `Modal` es `transparent` y no
   * atenúa por su cuenta, así que el único velo era éste. Sigue ocupando lo
   * que ocupaba y sigue cerrando al tocarlo; simplemente ya no dibuja.
   */
  outside: {
    flex: 1,
  },
  sheet: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xl,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.sm,
  },
  headTitle: {
    flexShrink: 1,
  },
  searchBox: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  /**
   * Sin alto propio: se lo pone el componente a partir de cuántas filas hay.
   * Y **sin relleno al final**: un `paddingBottom` aquí haría que seis filas
   * ya no cupieran en el alto de seis filas, y la lista se desplazaría
   * cuando no debe.
   */
  list: {},
  /**
   * `minHeight` y no `height`: con el texto del sistema agrandado la fila
   * crece en vez de recortar el nombre. Con el tamaño normal mide
   * exactamente `FRIEND_ROW_HEIGHT` —filete incluido, que React Native
   * cuenta dentro de la caja—, que es lo que hace exacta la cuenta del alto.
   */
  row: {
    minHeight: FRIEND_ROW_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  empty: {
    gap: Spacing.sm,
  },
  noMatches: {
    textAlign: 'center',
    paddingVertical: Spacing.lg,
  },
});
