import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AmountField } from './amount-field';
import type { AmountEntry } from './movement-entry';
import { currencySymbol, useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { GlassPressable, ThemedText } from '@/ui/components';
import { Radius, Spacing, useTheme } from '@/ui/theme';

/**
 * LA VENTANA EN LA QUE SE ESCRIBE UNA CIFRA, y hay una sola.
 *
 * La usan «Editar disponible» y «Editar movimiento», y las dos se ven iguales
 * porque **son la misma composición**, no porque se hayan copiado dos veces con
 * los mismos números.
 *
 * **Y ésa era la diferencia que faltaba.** Las dos ya compartían `SheetWindow`
 * —el armazón, el tamaño, las esquinas, la X, la animación— y aun así se veían
 * distintas por dentro: cada una traía su propia fila de importe, con
 * contrapesos de 56 y 52 puntos y separaciones distintas, y su propio botón
 * amarillo. Compartir el contenedor no es compartir la plantilla.
 *
 * Lo que esta pieza fija es todo lo que las dos tienen igual:
 *
 *   la fila del importe — contrapeso, cifra, control de moneda
 *   el aviso de que la moneda no cambia
 *   la pista o el error, cuando los hay
 *   el CTA amarillo
 *
 * Y deja dos huecos para lo que cada una tiene de suyo: `header`, encima de la
 * cifra —el selector de clase, cuando hay clase que enseñar— y `fields`,
 * debajo —concepto, categoría y fecha de un movimiento—. La ventana crece
 * hacia abajo con lo que se le meta; lo demás no se mueve.
 *
 * **«Añadir movimiento» NO pasa por aquí**, a propósito: su composición está
 * aprobada tal cual y esta pasada no la toca.
 */
export type AmountSheetProps = {
  /** Encima de la cifra. Hoy, el selector de clase de un movimiento. */
  readonly header?: React.ReactNode;
  /** Debajo de la cifra. Hoy, los campos del movimiento. */
  readonly fields?: React.ReactNode;

  readonly entry: AmountEntry;
  readonly onChangeEntry: (next: AmountEntry) => void;
  readonly amountLabel: string;
  /**
   * La cifra que se enseña apagada mientras nadie escribe.
   *
   * Sólo la usa «Editar disponible», donde el saldo actual es referencia y el
   * borrador empieza vacío. Al corregir un movimiento el importe anterior SÍ es
   * el borrador, así que allí no se pasa.
   */
  readonly reference?: AmountEntry;

  /** `null` mientras el ámbito no ha resuelto: la cifra ya se puede escribir. */
  readonly currency: { readonly code: string; readonly scale: number } | null;

  /** Por qué todavía no se puede guardar. Se lee en gris. */
  readonly hint?: string | null;
  /** Qué ha fallado al guardar. Se lee en rojo, y la ventana no se cierra. */
  readonly error?: string | null;

  readonly saveLabel: string;
  readonly saveDisabled: boolean;
  readonly saving: boolean;
  readonly onSave: () => void;
};

export function AmountSheet({
  header,
  fields,
  entry,
  onChangeEntry,
  amountLabel,
  reference,
  currency,
  hint,
  error,
  saveLabel,
  saveDisabled,
  saving,
  onSave,
}: AmountSheetProps) {
  const { t } = useTranslation();
  const { locale } = useFormat();

  const [currencyNote, setCurrencyNote] = useState(false);
  const scale = currency?.scale ?? 2;

  // Nunca un «€» escrito a mano: Nomey es multimoneda por diseño aunque hoy
  // sólo se vea una, y un símbolo fijo es la forma más barata de romperlo
  // (AGENTS.md §6). Lo resuelve `lib/format`, que es quien sabe de patrones.
  const symbol = currency === null ? '' : currencySymbol(locale, currency.code, currency.scale);

  return (
    <View style={styles.sheet}>
      {header}

      <View style={styles.amountRow}>
        {/*
         * CONTRAPESO, del mismo ancho que el control de moneda.
         *
         * Sin él la fila centra el CONJUNTO —cifra, hueco y €—, y la cifra
         * queda desplazada a la izquierda del centro por media anchura del
         * control. Con un hueco igual al otro lado, el centro de la cifra y el
         * de la ventana son el mismo: la presencia del € deja de moverla.
         *
         * Es el mismo recurso que el encabezado usa para centrar su título
         * frente a la X, y por la misma razón.
         */}
        <View style={styles.currencyGutter} />

        <AmountField
          entry={entry}
          onChange={onChangeEntry}
          scale={scale}
          label={amountLabel}
          reference={reference}
        />

        <GlassPressable
          label={t('entry.currencyLabel', { code: currency?.code ?? '' })}
          /*
           * LA MISMA PROFUNDIDAD QUE LOS OBLONGOS de esta ventana, que es
           * `well` y no `raised`. Los dos tokens no son variantes del mismo
           * relieve: la sombra EXTERIOR de `raised` es `offsetY 8 / blur 20 /
           * negro 0.65` y la de `well` es `offsetY 2 / blur 6 / 0.35` — más
           * del triple de difuminado y casi el doble de opacidad. Contra un
           * fondo negro eso es exactamente la mancha que se veía.
           *
           * Sigue habiendo relieve: `well` conserva su sombreado interior y su
           * sombra exterior corta. No se apaga la profundidad, se iguala.
           */
          depth="well"
          rim="soft"
          radius={Radius.lg}
          onPress={() => {
            setCurrencyNote(true);
          }}>
          <View style={styles.currency}>
            <ThemedText variant="title">{symbol}</ThemedText>
          </View>
        </GlassPressable>
      </View>

      {currencyNote ? (
        <ThemedText variant="caption" themeColor="textTertiary" style={styles.note}>
          {t('entry.currencyFixed')}
        </ThemedText>
      ) : null}

      {fields}

      <View style={styles.footer}>
        {hint === null || hint === undefined ? null : (
          <ThemedText variant="caption" themeColor="textTertiary" style={styles.note}>
            {hint}
          </ThemedText>
        )}
        {error === null || error === undefined ? null : (
          /*
           * La ventana NO se cierra ni se vacía: lo escrito sigue ahí y se
           * puede reintentar. El motivo se dice en castellano — los códigos de
           * la frontera son contrato, no interfaz.
           */
          <ThemedText variant="caption" themeColor="negative" style={styles.note}>
            {error}
          </ThemedText>
        )}

        <SaveButton label={saveLabel} disabled={saveDisabled} busy={saving} onPress={onSave} />
      </View>
    </View>
  );
}

/**
 * El CTA, y el único amarillo de esta pantalla.
 *
 * No reutiliza `ActionButton` porque aquel renunció al acento a propósito —«en
 * una pantalla llena de tarjetas, un botón amarillo compite con todo»— y aquí
 * pasa lo contrario: es lo único pulsable de la ventana.
 *
 * **Apagado no se pinta amarillo apagado, se queda sin relleno.** Un amarillo
 * al 40 % sigue leyéndose como el color de marca, y decir «esto es la acción»
 * y «esto no se puede hacer» a la vez es contradictorio.
 */
export function SaveButton({
  label,
  disabled,
  busy,
  onPress,
}: {
  label: string;
  disabled: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <GlassPressable
      label={label}
      onPress={onPress}
      disabled={disabled}
      busy={busy}
      rim="none"
      radius={Radius.full}
      style={styles.saveOuter}>
      <View style={[styles.save, { backgroundColor: disabled ? 'transparent' : theme.accent }]}>
        <ThemedText
          style={[styles.saveLabel, { color: disabled ? theme.textDisabled : theme.onAccent }]}>
          {label}
        </ThemedText>
      </View>
    </GlassPressable>
  );
}

const styles = StyleSheet.create({
  sheet: {
    gap: Spacing.md,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  currencyGutter: {
    width: 56,
  },
  currency: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    textAlign: 'center',
  },
  footer: {
    /*
     * **Separación, no empuje.** Llevó `marginTop: 'auto'`, que mandaba el CTA
     * al canto inferior aprovechando todo el hueco que sobrara — y como la
     * ventana medía una fracción de la pantalla, ese hueco eran casi
     * doscientos puntos de negro entre el último campo y el botón.
     *
     * Ahora la ventana mide lo que mide el contenido, así que no hay nada que
     * repartir: basta un respiro declarado. `xl` y no `lg` porque el CTA tiene
     * que separarse de los campos más de lo que los campos se separan entre sí;
     * si compartiera su misma distancia se leería como una fila más.
     */
    gap: Spacing.sm,
    paddingTop: Spacing.xl,
  },
  saveOuter: {
    alignSelf: 'stretch',
  },
  /**
   * Algo mayor que `label`, que es el registro del resto de controles: el CTA
   * final de la pantalla no se lee al mismo peso que un campo.
   */
  saveLabel: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '600',
  },
  save: {
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
});
