import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { Icon } from './icon';
import { ThemedText } from './themed-text';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

/**
 * Lo mínimo que esta lista necesita saber de una divisa: su identidad y su
 * código. **La escala no entra**: quien elige la usa después, aquí no se
 * formatea ninguna cifra.
 */
export type CurrencyListOption = {
  readonly id: string;
  readonly code: string;
};

/**
 * EL DESPLEGABLE DE DIVISAS, y hay uno solo.
 *
 * Lo estrenó el selector de la divisa base de un grupo (`CurrencyField`) y
 * desde F11 lo monta también el control de moneda de `AmountSheet`, que es por
 * donde se elige la moneda de una operación. Las dos listas se veían iguales
 * porque **son la misma**, no porque se hayan copiado los mismos números.
 *
 * Vive en `ui/` y por tanto no lee de `lib/`: los textos llegan traducidos
 * desde quien la monta, igual que hace `AmountSheet` con los suyos.
 */
export function CurrencyList({
  options,
  selectedId,
  onSelect,
}: {
  readonly options: readonly CurrencyListOption[];
  readonly selectedId: string | null;
  readonly onSelect: (option: CurrencyListOption) => void;
}) {
  const theme = useTheme();

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
      style={[styles.list, { borderColor: theme.border }]}
      contentContainerStyle={styles.listBody}>
      {options.map((option) => (
        <Pressable
          key={option.id}
          accessibilityRole="button"
          accessibilityState={{ selected: option.id === selectedId }}
          accessibilityLabel={option.code}
          onPress={() => {
            onSelect(option);
          }}
          style={styles.option}>
          <ThemedText
            variant="body"
            themeColor={option.id === selectedId ? 'text' : 'textSecondary'}>
            {option.code}
          </ThemedText>
          {option.id === selectedId ? (
            <Icon name={Symbols.confirm} size={16} colour={theme.accent} shape="circle" />
          ) : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  /** Acotada: el catálogo entero dentro de una ventana con alto máximo. */
  list: {
    maxHeight: 168,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  listBody: {
    paddingVertical: Spacing.xs,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
});
