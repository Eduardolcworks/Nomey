import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { AmountField } from './amount-field';
import type { AmountEntry } from './movement-entry';
import { currencySymbol, useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { GlassPressable, ThemedText } from '@/ui/components';
import { Radius, Spacing, useTheme } from '@/ui/theme';

/**
 * EL CTA ES UNA PÍLDORA, y su radio es una cifra REAL, no un número enorme.
 *
 * `Radius.full` vale 9999 — el modismo de «redondea del todo», que funciona
 * mientras la plataforma lo recorte a la mitad de la altura. iOS lo hace; en
 * Android este oblongo salía CUADRADO, y es el único control cuyo relleno
 * visible es un hijo opaco que ocupa la caja entera: si su radio se pierde, no
 * queda nada redondeado debajo que se vea.
 *
 * Con la mitad de su propia altura no hay nada que recortar y el resultado es el
 * mismo en las dos: 9999 sobre 58 puntos de alto se recorta a 29 en iOS, que es
 * exactamente esto. **No cambia lo aprobado; deja de depender de un recorte.**
 */
const CTA_HEIGHT = 58;

/**
 * **iOS CONSERVA SU MODISMO APROBADO.** `Radius.full` son 9999 puntos, que iOS
 * recorta a la mitad de la altura: la pildora que se aprobo. Android no lo
 * recortaba y el relleno salia cuadrado, asi que alli —y solo alli— se usa la
 * cifra real. No es un valor distinto: es el mismo resultado sin depender de un
 * recorte que una de las dos plataformas no hace.
 */
const CTA_RADIUS = Platform.OS === 'android' ? CTA_HEIGHT / 2 : Radius.full;

/**
 * Y la mascara, tambien solo en Android: alli el relleno de acento perdia su
 * forma y tapaba la del control. En iOS nunca paso, y una vista con `overflow`
 * es una vista distinta — no se le anade por si acaso.
 */
const CTA_CLIP = Platform.OS === 'android';

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
  /**
   * DENTRO de la fila de la cifra, a la derecha del control de moneda.
   *
   * Lo pide corregir un movimiento para su selector de categoría, y por eso no
   * es `fields`: ahí abajo le costaba una fila entera de alto, y la ventana
   * dejaba de medir lo que medía. Aquí no ocupa ni un punto vertical.
   *
   * **Y sustituye al contrapeso, no se suma a él.** El hueco de la izquierda
   * existe para que la cifra quede centrada frente al €; con un segundo control
   * a la derecha ese equilibrio ya no es posible dentro del mismo ancho, así
   * que el hueco se retira y la cifra gana su sitio en vez de estrecharse. Sin
   * esto quedaban 89 puntos para el importe y `1000,00` mide 114: se habría
   * recortado una cifra de dinero, que es justo lo que no puede pasar.
   */
  readonly aside?: React.ReactNode;

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

/**
 * EL ANCHO DE LA COLUMNA DE LA MONEDA, y del hueco que la equilibra.
 *
 * Es una cifra sola porque el contrapeso y el control TIENEN que medir lo
 * mismo: en cuanto se separan, la cifra deja de estar centrada y nadie lo nota
 * hasta verlo.
 */
const CURRENCY_SLOT = 56;

export function AmountSheet({
  header,
  fields,
  aside,
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
        {aside === undefined ? <View style={styles.currencyGutter} /> : null}

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

        {aside === undefined ? null : <View style={styles.aside}>{aside}</View>}
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
      /*
       * Apagado es transparente y activo es amarillo: ninguno de los dos puede
       * recibir el gris solido de los controles neutros.
       */
      material="translucent-control"
      radius={CTA_RADIUS}
      /*
       * EL RELLENO DE ACENTO VA DENTRO DE LA MASCARA.
       *
       * Deshabilitado el CTA se ve oblongo -lo que se ve es la superficie, y
       * su radio funciona-; al habilitarse, el hijo amarillo pasa a ser lo
       * unico visible y en Android salia CUADRADO pese a llevar el MISMO
       * radio. Recortando en la superficie, la forma la manda ella y la del
       * hijo deja de importar.
       *
       * No cambia nada del estado apagado, donde ese hijo es transparente, ni
       * recorta la sombra exterior.
       */
      clip={CTA_CLIP}
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
  /**
   * EL SITIO DEL CONTROL DE AL LADO, centrado con el de moneda.
   *
   * `CategoryMenu` lleva `alignSelf: flex-start` en su propio disparador —lo
   * necesita en la fila del alta, donde va con el campo de concepto— y eso, en
   * una fila mas alta que el, lo pega arriba: medido, su centro caia 6,3 puntos
   * por encima del centro del €.
   *
   * Esta capa se estira a lo alto de la fila y centra lo que le llegue, sin
   * tocar el componente compartido y sin una sola medida: la altura la pone la
   * fila.
   */
  aside: {
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  currencyGutter: {
    width: CURRENCY_SLOT,
  },
  currency: {
    width: CURRENCY_SLOT,
    height: CURRENCY_SLOT,
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
    minHeight: CTA_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    // El MISMO radio que la superficie de debajo. Son dos capas visibles —el
    // cristal y el relleno de acento— y la de arriba es opaca: si pierde su
    // forma, la de abajo deja de verse.
    borderRadius: CTA_RADIUS,
  },
});
