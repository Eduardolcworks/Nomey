import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { CurrenciesState, CurrencyOption } from '@/lib/currency';
import { useTranslation } from '@/lib/i18n';
import { CurrencyList, GlassSurface, Icon, ThemedText } from '@/ui/components';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

/**
 * LA DIVISA DEL GRUPO. **No había ningún selector que reutilizar.**
 *
 * Lo que sí había es el catálogo: `api.currency_definition`, la vista
 * `security_invoker` que publicó el provisioning del Modo Personal y que
 * `authenticated` puede leer. De cliente no existía nada — ni pantalla ni
 * componente—, así que esto se monta con las piezas que sí están aprobadas: la
 * superficie de control, el tipo `label` y el chevron del vocabulario.
 *
 * **Y no se presupone ninguna moneda.** Mientras la del Modo Personal no se
 * conozca, el apartado dice que está cargando y no ofrece nada que elegir.
 * Preseleccionar `EUR` mientras tanto daría por buena una moneda que nadie ha
 * elegido, en un valor que **queda fijo tras la primera operación del grupo**
 * (F01/ADR-001 §8, invariante 12).
 */
export type CurrencyFieldProps = {
  /**
   * La divisa elegida, YA RESUELTA, o `null` si todavía no se sabe cuál es.
   *
   * **Resuelta y no un id**, porque su código no siempre se puede consultar: sin
   * red el catálogo no llega, y la del Modo Personal sí — viene cacheada con su
   * código y su escala. Con un id suelto, este campo se quedaba en «no se ha
   * podido saber tu divisa» sin conexión, y con él la acción de crear.
   */
  readonly selected: CurrencyOption | null;
  /**
   * El catálogo, tal como lo trae quien contiene este campo.
   *
   * **Lo pide el formulario, no esto.** Crear el grupo necesita el CÓDIGO y la
   * ESCALA de la divisa elegida —el id no basta, porque la escala pertenece a la
   * definición monetaria (F02/ADR-001 §3)— y pedir el catálogo dos veces serían dos
   * viajes y dos verdades que podrían no coincidir. Este campo es presentación:
   * enseña lo que hay y avisa de lo que se elige.
   */
  readonly state: CurrenciesState;
  readonly onSelect: (option: CurrencyOption) => void;
  /**
   * BLOQUEADA: se ve y no se cambia.
   *
   * Es el editor de un grupo ya creado. F09/ADR-001 §4 deja cambiar la moneda base
   * mientras el ámbito no tenga efectos, pero ese cambio es de F11 con su
   * conversión, y este editor no lo ofrece **aunque el grupo aún no tenga
   * gastos**: la definición monetaria real se conserva tal cual. Se pinta más
   * oscura con los tokens del sistema y se anuncia deshabilitada.
   */
  readonly locked?: boolean;
};

export function CurrencyField({ selected, state, onSelect, locked = false }: CurrencyFieldProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  if (locked && selected !== null) {
    return (
      <View
        accessible
        accessibilityRole="button"
        accessibilityState={{ disabled: true }}
        accessibilityLabel={t('groups.currencyLabel', { code: selected.code })}
        accessibilityHint={t('groups.currencyLocked')}>
        <GlassSurface
          material="control"
          /* Un escalón más oscuro que el control en reposo: `bar` es el tinte
           * que el sistema ya usa para lo que no se toca. Sin galón. */
          level="bar"
          depth="well"
          rim="soft"
          radius={Radius.full}
          nativeEffect={false}
          style={styles.box}>
          <ThemedText variant="body" themeColor="textDisabled">
            {selected.code}
          </ThemedText>
          <Icon name={Symbols.lock} size={16} colour={theme.textDisabled} shape="circle" />
        </GlassSurface>
      </View>
    );
  }

  if (selected === null) {
    return (
      <GlassSurface
        material="control"
        level="regular"
        depth="well"
        rim="soft"
        radius={Radius.full}
        nativeEffect={false}
        style={styles.box}>
        <ThemedText variant="body" themeColor="textSecondary">
          {t('groups.currencyLoading')}
        </ThemedText>
      </GlassSurface>
    );
  }

  return (
    <View style={styles.column}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('groups.currencyLabel', { code: selected.code })}
        onPress={() => {
          setOpen((current) => !current);
        }}>
        <GlassSurface
          material="control"
          level="regular"
          depth="well"
          rim="soft"
          radius={Radius.full}
          nativeEffect={false}
          style={styles.box}>
          <ThemedText variant="body">{selected.code}</ThemedText>
          <Icon
            name={open ? Symbols.collapse : Symbols.expand}
            size={16}
            colour={theme.textSecondary}
            shape="circle"
          />
        </GlassSurface>
      </Pressable>

      {/*
       * SIN CATÁLOGO NO HAY LISTA, y se dice.
       *
       * Cambiar de divisa exige el catálogo, que sólo llega por red. La elegida
       * se sigue viendo —viene resuelta— pero elegir otra no se puede, y abrir un
       * desplegable vacío sin explicación sería peor que decirlo.
       */}
      {open && state.status !== 'ready' ? (
        <ThemedText variant="caption" themeColor="textSecondary" style={styles.note}>
          {state.status === 'unavailable'
            ? t('groups.currencyUnknown')
            : t('groups.currencyLoading')}
        </ThemedText>
      ) : null}

      {/*
       * LA MISMA LISTA QUE EL CONTROL DE MONEDA DE `AmountSheet`, que es por
       * donde F11 elige la moneda de una operación. Bajó a `ui/` para que
       * fuese una y no dos; este campo no perdió nada al hacerlo.
       */}
      {open && state.status === 'ready' ? (
        <CurrencyList
          options={state.options}
          selectedId={selected.id}
          onSelect={(option) => {
            /*
             * La escala viene del catálogo, no de la lista: `CurrencyList` no
             * la conoce, y crear un grupo la necesita (F02/ADR-001 §3).
             */
            const full = state.options.find((one) => one.id === option.id);
            if (full !== undefined) onSelect(full);
            setOpen(false);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    gap: Spacing.xs,
  },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
    paddingHorizontal: Spacing.lg,
  },
  note: {
    paddingHorizontal: Spacing.lg,
  },
});
