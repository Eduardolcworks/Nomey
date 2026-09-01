import { Keyboard, StyleSheet, TextInput, View } from 'react-native';

import {
  type AmountEntry,
  amountComplete,
  amountParts,
  amountTones,
  amountTouched,
  amountValue,
  applyAmountInput,
} from './movement-entry';
import { ThemedText } from '@/ui/components';
import { useFormat } from '@/lib/format';

/**
 * EL EDITOR MONETARIO, y hay uno solo en toda la aplicación.
 *
 * Lo usan «Añadir movimiento», «Editar movimiento» y «Editar disponible». Vive
 * aquí y no dentro del formulario porque la tercera no necesita nada más de él:
 * sin extraerlo habría que arrastrar concepto, categoría y clase a una pantalla
 * que sólo pide una cifra — o escribir un segundo editor, que es la forma más
 * rápida de que dos superficies monetarias dejen de comportarse igual.
 *
 * **Toda la aritmética es texto y `bigint`.** Lo tecleado lo convierte
 * `toMinorUnits` y nunca pasa por un `number`; aquí sólo se compone y se
 * presenta.
 */
export function AmountField({
  entry,
  onChange,
  scale,
  label,
  reference,
}: {
  readonly entry: AmountEntry;
  readonly onChange: (next: AmountEntry) => void;
  readonly scale: number;
  readonly label: string;
  /**
   * Una cifra que se enseña MIENTRAS no se ha escrito nada, y que no se edita.
   *
   * **No es el valor del campo, y ésa es toda la diferencia.** El editor
   * arranca vacío igual que siempre: esto sólo ocupa el sitio de la cifra
   * mientras está sin tocar, apagada, como referencia de un dato que conviene
   * tener delante — el Disponible de ahora, cuando se va a fijar uno nuevo.
   *
   * En cuanto entra la primera pulsación desaparece y empieza una cantidad
   * nueva. **No hay nada que borrar antes**, porque nunca hubo nada escrito:
   * el borrado sobre un campo vacío no la toca, no puede, no es suya.
   *
   * Opcional a propósito: sin ella, `AmountField` se comporta exactamente como
   * hasta ahora — un `0,00` apagado —, que es lo que quieren «Añadir
   * movimiento» y «Editar movimiento». En el segundo el importe anterior SÍ es
   * el borrador, porque corregir parte de lo que había; fijar un saldo, no.
   */
  readonly reference?: AmountEntry;
}) {
  /*
   * La referencia sólo manda mientras el editor está intacto. `amountTouched`
   * cubre también la coma como primera tecla: entrar en decimales ya es haber
   * empezado, aunque todavía no haya dígitos.
   */
  const showing = reference !== undefined && !amountTouched(entry) ? reference : entry;
  const muted = showing !== entry;

  return (
    <View style={styles.amountSlot}>
      <AmountFigure entry={showing} scale={scale} muted={muted} />

      {/*
       * EL CAMPO ES UN CAPTURADOR DE TECLADO, no la cifra.
       *
       * Va encima, invisible y sin cursor: recibe el toque, abre el teclado
       * decimal y entrega lo tecleado, pero lo que se lee es la composición de
       * debajo. Así la cifra conserva su jerarquía —enteros grandes, céntimos
       * pequeños— en vez de volver a ser el texto crudo de un campo, que no
       * admite dos cuerpos.
       *
       * `caretHidden` es la capacidad de React Native para esto, y el color
       * transparente hace el resto: ni barra, ni texto, ni selección que altere
       * la composición.
       */}
      <TextInput
        value={amountValue(entry)}
        onChangeText={(next) => {
          const moved = applyAmountInput(entry, next, scale);
          onChange(moved);

          // Terminada la parte decimal, el teclado sobra. Sólo al COMPLETAR
          // —no si ya lo estaba—, para que corregir un céntimo y volver a
          // escribirlo lo cierre otra vez.
          if (!amountComplete(entry, scale) && amountComplete(moved, scale)) {
            Keyboard.dismiss();
          }
        }}
        keyboardType="decimal-pad"
        caretHidden
        selectionColor="transparent"
        accessibilityLabel={label}
        style={styles.capture}
      />
    </View>
  );
}

/**
 * La cifra, compuesta por nosotros y no por el campo.
 *
 * **No es un `placeholder`, y ahora tampoco es sólo el estado vacío.** Un
 * `placeholder` de `TextInput` es una cadena con un solo estilo, así que no
 * puede llevar los enteros grandes y los céntimos pequeños; y el texto del
 * propio campo, tampoco. Por eso el campo es invisible y esto es lo que se lee,
 * escrito o no.
 *
 * **Los enteros y los céntimos van en UN solo texto con una tirada anidada.**
 * Con dos textos en fila habría que alinearlos por línea base a mano y quedan
 * separados el ancho del primero; anidados, el propio motor de texto los
 * compone pegados y sobre la misma base, como un cambio de cuerpo a media
 * palabra.
 *
 * **El separador sale de la configuración regional, no de un literal.** Un
 * `','` escrito a mano sería una coma en inglés y unos decimales en yenes, que
 * no tiene decimales. Se formatea un cero de la escala pedida y se lee de ahí
 * el carácter que no es dígito: viene bien en los tres casos.
 *
 * **Y va en tres tiradas porque el color dice en qué punto va la edición.** La
 * cifra se lee siempre entera, así que sin distinguir tonos no habría forma de
 * saber si esos ceros los puso la persona o están para completar la forma. Qué
 * pieza está encendida lo decide `amountTones` sobre el estado del editor: aquí
 * no hay ningún indicador propio que pueda quedarse desincronizado.
 */
function AmountFigure({
  entry,
  scale,
  muted = false,
}: {
  entry: AmountEntry;
  scale: number;
  /**
   * Apagada entera, sea cual sea su estado.
   *
   * Hace falta porque una referencia viene COMPLETA —tiene enteros y céntimos
   * escritos—, así que sus tonos dirían «esto lo puso la persona». Y no: lo
   * puso el saldo que ya existía.
   */
  muted?: boolean;
}) {
  const format = useFormat();
  const { whole, fraction } = amountParts(entry, scale);

  const zero = format.number(0, {
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  });
  const cut = zero.search(/[^0-9]/);
  const separator = cut === -1 ? '' : zero.slice(cut, cut + 1);

  const tones = amountTones(entry);
  const paint = (tone: 'entered' | 'pending') =>
    muted || tone === 'pending' ? 'textDisabled' : 'text';

  return (
    <View style={styles.figure} pointerEvents="none">
      <ThemedText
        themeColor={paint(tones.whole)}
        numberOfLines={1}
        adjustsFontSizeToFit
        style={styles.amount}>
        {whole}
        {fraction === '' ? null : (
          <ThemedText style={styles.amountDecimals}>
            <ThemedText themeColor={paint(tones.separator)}>{separator}</ThemedText>
            <ThemedText themeColor={paint(tones.fraction)}>{fraction}</ThemedText>
          </ThemedText>
        )}
      </ThemedText>
    </View>
  );
}

/**
 * El CTA, y el único amarillo de esta pantalla.
 *
 * No reutiliza `ActionButton` porque aquel renunció al acento a propósito —«en
 * este armazón el amarillo relleno pertenece a la acción flotante y a nada
 * más»—. Aquí la ventana ES la acción flotante desplegada, así que el amarillo
 * le corresponde. Cambiar `ActionButton` para admitirlo habría abierto el
 * acento a cualquier pantalla, que es lo que aquella nota evita.
 *
 * **Sin brillo de borde** (`rim="none"`): el amarillo ya se separa del fondo por
 * sí solo —13.2:1—, así que la luz del canto no añadía profundidad, sólo dos
 * destellos en las puntas del oblongo. El negro encima es `onAccent`, el único
 * primer plano admitido sobre el acento, a 12.4:1.
 */

const styles = StyleSheet.create({
  amountSlot: {
    // Todo lo que queda a la izquierda de la columna de moneda.
    flex: 1,
    justifyContent: 'center',
  },
  /**
   * La cifra manda en el formulario, y va CENTRADA en la ventana.
   *
   * Centrada de verdad, no centrada en lo que sobra: el contrapeso de la
   * izquierda es lo que impide que la presencia del `€` la desplace. Y el
   * cuerpo es el de la pasada anterior, que ya estaba bien: lo que se
   * corrige aquí es la alineación, no el tamaño.
   */
  amount: {
    fontSize: 56,
    lineHeight: 64,
    fontWeight: '600',
    letterSpacing: -1.5,
    textAlign: 'center',
  },
  figure: {
    justifyContent: 'center',
  },
  /**
   * La capa que recibe el toque y el teclado, encima de la cifra y sin verse.
   *
   * Transparente y no `opacity: 0`: con opacidad cero iOS deja de entregar el
   * foco en algunas versiones, y lo que hace falta es que se siga pudiendo
   * enfocar. Lo invisible es el TEXTO, no el control.
   */
  capture: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    color: 'transparent',
    fontSize: 56,
    textAlign: 'center',
  },
  /**
   * Los céntimos, a poco más de la mitad: se leen como parte de la cifra.
   *
   * **Sin `lineHeight` propio**: es una tirada anidada, y heredar la caja de
   * línea del texto que la contiene es justo lo que la deja sobre la misma base.
   */
  amountDecimals: {
    fontSize: 28,
    fontWeight: '600',
    letterSpacing: -0.5,
  },
});
