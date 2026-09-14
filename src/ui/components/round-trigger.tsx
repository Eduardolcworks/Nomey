import { StyleSheet, View } from 'react-native';

import { ControlMaterial } from './control-material';
import { Icon, type IconProps } from './icon';
import { Radius, useTheme } from '@/ui/theme';

/**
 * EL MISMO CÍRCULO DE `IconButton`, PERO SIN SU PULSACIÓN.
 *
 * Existe por una sola razón, y es la misma que justifica `CategoryTrigger`: un
 * menú del sistema aloja su disparador DENTRO —`MenuView` en Android, `Menu` de
 * SwiftUI en iOS— y quien recibe el toque es el menú. Un `Pressable` propio se
 * lo disputaría, y ya está medido lo que pasa cuando el disparador queda fuera:
 * el control se ve, se anuncia y no responde a ningún toque.
 *
 * **Ni un token ni una geometría nuevos.** Los 44 pt son los de `IconButton`
 * —el mínimo de Apple, no un redondeo de él—, el material es `ControlMaterial`
 * y el radio, `Radius.full`. Lo único que no está aquí es el `Pressable`.
 *
 * **La etiqueta va aquí y no en el menú.** La capa nativa que el menú pone
 * encima no llega al árbol de accesibilidad; lo que sí llega es esto, que
 * además es lo que se ve. Y `accessible` explícito: en Android una vista con rol
 * y etiqueta pero sin él no abre un nodo propio.
 */
export function RoundTrigger({
  name,
  label,
  size = 22,
  colour,
}: {
  readonly name: IconProps['name'];
  /** Siempre: un icono solo no le dice nada a un lector de pantalla. */
  readonly label: string;
  readonly size?: number;
  readonly colour?: string;
}) {
  const theme = useTheme();

  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.circle, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
      <ControlMaterial radius={Radius.full} />
      <Icon name={name} size={size} colour={colour ?? theme.text} shape="circle" />
    </View>
  );
}

/** El lado del botón redondo, exactamente el de `IconButton`. */
export const ROUND_TRIGGER = 44;

const styles = StyleSheet.create({
  circle: {
    width: ROUND_TRIGGER,
    height: ROUND_TRIGGER,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
