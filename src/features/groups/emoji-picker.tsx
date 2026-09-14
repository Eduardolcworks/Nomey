import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from '@/lib/i18n';
import { GlassSurface, Icon, ThemedText } from '@/ui/components';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';
import { SLIDE_IN } from '@/ui/theme/motion-runtime';

import {
  type Emoji,
  EMOJI_GROUPS,
  emojisOfGroup,
  hasTones,
  searchEmojis,
  type SkinChoice,
  SKIN_TONES,
  withTone,
} from './emoji-catalogue';

/**
 * EL SELECTOR DE EMOJIS. Un teclado, y por eso se comporta como uno.
 *
 * **Sube desde abajo y ocupa la franja de un teclado**, no el centro de la
 * pantalla: lo que se está haciendo es escribir un carácter, y una ventana
 * flotante para eso se lee como otra decisión distinta. Encima de la ventana de
 * crear grupo, que sigue detrás y conserva todo lo escrito.
 *
 * **Cierra el teclado de texto al abrirse.** Los dos paneles ocupan el mismo
 * sitio: sin esto, en Android quedan superpuestos y en iOS uno empuja al otro.
 *
 * **Y se queda con el botón Atrás mientras está abierto.** Se suscribe al
 * montar, así que es el último suscriptor y el sistema lo consulta primero:
 * Atrás cierra el selector y la ventana de debajo no se entera.
 *
 * **Los glifos son los del sistema.** Aquí sólo viajan puntos de código; el
 * dibujo lo pone la fuente del aparato.
 *
 * **Se monta al abrirse y se desmonta al cerrarse**, en vez de quedarse puesto
 * devolviendo `null`. Así la búsqueda empieza vacía cada vez sin que nadie la
 * borre desde un efecto: reabrirlo con el texto de la vez anterior enseñaría
 * una cuadrícula filtrada sin que se hubiera escrito nada. El estado que sí
 * tiene que sobrevivir —el emoji elegido— vive en el formulario, no aquí.
 */
export type EmojiPickerProps = {
  /** La cuenta cuyos recientes se enseñan. Vacío = no se guarda ninguno. */
  readonly recents: readonly string[];
  readonly onSelect: (emoji: string) => void;
  readonly onClose: () => void;
};

/** El lado de cada celda. Ocho por fila en un teléfono normal. */
const CELL = 44;
const GLYPH = 28;

/** Cuánto de la pantalla ocupa, en la franja donde estaría el teclado. */
const PICKER_RATIO = 0.52;

export function EmojiPicker({ recents, onSelect, onClose }: EmojiPickerProps) {
  const { t, locale } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<number>(EMOJI_GROUPS[0].group);
  const [tone, setTone] = useState<SkinChoice>(null);

  /*
   * ATRÁS CIERRA ESTO, NO LA VENTANA.
   *
   * El cierre se lee por referencia para poder suscribirse una sola vez: si la
   * suscripción dependiera de `onClose`, se reharía en cada render del padre y
   * podría dejar de ser la última — que es justo lo que decide quién gana.
   */
  const latestClose = useRef(onClose);
  useEffect(() => {
    latestClose.current = onClose;
  });

  useEffect(() => {
    // El teclado de texto y éste ocupan el mismo sitio: no pueden estar los dos.
    Keyboard.dismiss();

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      latestClose.current();
      return true;
    });
    return () => subscription.remove();
  }, []);

  const searching = query.trim() !== '';
  const results = useMemo(
    () => (searching ? searchEmojis(locale, query) : emojisOfGroup(locale, group)),
    [searching, locale, query, group],
  );

  /*
   * Lo que se pinta: cadenas ya resueltas con el tono elegido. Los recientes se
   * guardaron con su tono, así que van tal cual — volver a aplicarles el actual
   * cambiaría un emoji que la persona ya eligió.
   */
  const cells = useMemo<readonly string[]>(() => {
    const grid = results.map((emoji: Emoji) => withTone(emoji, tone));
    return searching || group !== EMOJI_GROUPS[0].group || recents.length === 0
      ? grid
      : [...recents, ...grid];
  }, [results, tone, searching, group, recents]);

  /*
   * La muestra de cada tono, resuelta una vez. Es una entrada del catálogo, no
   * una cadena escrita aquí: la variante sale del dato, que es lo que evita
   * componer grafemas a mano.
   */
  const sample = useMemo(() => toneSample(locale), [locale]);

  const columns = Math.max(6, Math.floor((width - Spacing.md * 2) / CELL));
  const panelHeight = Math.round(height * PICKER_RATIO);

  return (
    <View style={styles.canvas}>
      {/* Tocar fuera cierra, igual que en la hoja del selector de acciones. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('action.close')}
        onPress={onClose}
        style={StyleSheet.absoluteFill}
      />

      <Animated.View
        entering={SLIDE_IN}
        accessibilityViewIsModal
        style={[
          styles.panel,
          {
            height: panelHeight,
            backgroundColor: theme.background,
            /*
             * Un canto de un píxel arriba. El panel es del mismo negro que la
             * pantalla, así que sin él sus esquinas redondeadas no se ven y el
             * teclado parece flotar sin superficie.
             */
            borderTopColor: theme.border,
            paddingBottom: insets.bottom,
          },
        ]}>
        <View style={styles.header}>
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
              placeholder={t('emoji.search')}
              placeholderTextColor={theme.textDisabled}
              accessibilityLabel={t('emoji.search')}
              autoCorrect={false}
              autoCapitalize="none"
              style={[styles.searchInput, { color: theme.text }]}
            />
          </GlassSurface>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('action.close')}
            onPress={onClose}
            style={styles.headerButton}>
            <Icon name={Symbols.close} size={17} colour={theme.textSecondary} shape="circle" />
          </Pressable>
        </View>

        {/* EL TONO DE PIEL, elegido una vez y aplicado a todo lo que lo admita. */}
        <View
          style={styles.tones}
          accessibilityRole="radiogroup"
          accessibilityLabel={t('emoji.tone')}>
          <ToneChip
            label={t('emoji.toneDefault')}
            glyph="✋"
            selected={tone === null}
            onPress={() => {
              setTone(null);
            }}
          />
          {SKIN_TONES.map((one) => (
            <ToneChip
              key={one}
              label={t('emoji.tone')}
              glyph={withTone(sample, one)}
              selected={tone === one}
              onPress={() => {
                setTone(one);
              }}
            />
          ))}
        </View>

        {/* LAS CATEGORÍAS. Se desplazan porque son nueve y no caben. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          /*
           * `flexGrow: 0` porque si no se queda con todo el hueco sobrante de la
           * columna: medido en el emulador dejaba dos bandas vacías, una encima
           * de la tira y otra debajo, con la cuadrícula empujada al fondo.
           */
          style={styles.tabStrip}
          contentContainerStyle={styles.tabs}>
          {EMOJI_GROUPS.map((entry) => {
            const active = !searching && entry.group === group;
            return (
              <Pressable
                key={entry.group}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t(entry.labelKey)}
                onPress={() => {
                  setQuery('');
                  setGroup(entry.group);
                }}
                style={[
                  styles.tab,
                  {
                    backgroundColor: active ? theme.surfaceRaised : 'transparent',
                    borderColor: active ? theme.border : 'transparent',
                  },
                ]}>
                <ThemedText
                  variant="caption"
                  themeColor={active ? 'text' : 'textSecondary'}
                  numberOfLines={1}>
                  {t(entry.labelKey)}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* LA CUADRÍCULA. Virtualizada: son casi dos mil celdas por categoría. */}
        <FlatList
          key={`grid-${String(columns)}`}
          data={cells}
          numColumns={columns}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item, index) => `${item}-${String(index)}`}
          ListHeaderComponent={
            searching || recents.length === 0 || group !== EMOJI_GROUPS[0].group ? null : (
              <ThemedText variant="caption" themeColor="textSecondary" style={styles.sectionLabel}>
                {t('emoji.recent')}
              </ThemedText>
            )
          }
          ListEmptyComponent={
            <ThemedText variant="bodySmall" themeColor="textSecondary" style={styles.sectionLabel}>
              {t('emoji.empty')}
            </ThemedText>
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item}
              onPress={() => {
                onSelect(item);
              }}
              style={styles.cell}>
              {/* Sin `ThemedText`: un emoji no lleva color de tema ni peso. */}
              <Text style={styles.glyph}>{item}</Text>
            </Pressable>
          )}
          style={styles.grid}
        />
      </Animated.View>
    </View>
  );
}

/**
 * La entrada con la que se dibuja la muestra de cada tono.
 *
 * Una mano saludando, que es la que usan los teclados del sistema para lo
 * mismo. Se busca en el catálogo en vez de escribirse a mano para que la
 * variante salga del dato y no de una cadena compuesta aquí.
 */
function toneSample(locale: Parameters<typeof emojisOfGroup>[0]): Emoji {
  const people = emojisOfGroup(locale, 1);
  return people.find(hasTones) ?? people[0];
}

function ToneChip({
  label,
  glyph,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly glyph: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        styles.tone,
        {
          borderColor: selected ? theme.accent : 'transparent',
          backgroundColor: selected ? theme.surfaceRaised : 'transparent',
        },
      ]}>
      <Text style={styles.toneGlyph}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  canvas: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
  },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    height: 40,
    paddingHorizontal: Spacing.md,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    padding: 0,
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tones: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingTop: Spacing.sm,
  },
  tone: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toneGlyph: {
    fontSize: 18,
  },
  tabStrip: {
    flexGrow: 0,
  },
  tabs: {
    /*
     * Sin esto, cada píldora se estira al alto del contenedor horizontal y la
     * activa se ve como un bloque vertical con la cuadrícula empujada abajo.
     */
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  tab: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sectionLabel: {
    paddingVertical: Spacing.xs,
  },
  grid: {
    flex: 1,
  },
  cell: {
    width: CELL,
    height: CELL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    fontSize: GLYPH,
    lineHeight: GLYPH + 6,
  },
});
