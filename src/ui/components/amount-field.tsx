import { useEffect, useRef } from 'react';
import { Keyboard, Platform, StyleSheet, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import {
  type AmountEntry,
  amountComplete,
  amountParts,
  amountTones,
  amountTouched,
  amountFieldSelection,
  amountFieldStep,
  amountValue,
} from './amount-entry';
import { ThemedText } from './themed-text';
import { useFigurePop } from '@/ui/theme/motion-runtime';

/**
 * EL EDITOR MONETARIO, y hay uno solo en toda la aplicación.
 *
 * Lo usan «Añadir movimiento», «Editar movimiento», «Editar disponible» y el
 * alta de un gasto compartido. Vive aquí y no dentro de un formulario porque
 * ninguno de los cuatro necesita nada del otro: sin extraerlo habría que
 * arrastrar concepto, categoría y clase a una pantalla que sólo pide una cifra
 * — o escribir un segundo editor, que es la forma más rápida de que dos
 * superficies monetarias dejen de comportarse igual.
 *
 * **Y por eso vive en `ui/`.** Compartirlo entre el Modo Personal y Grupos por
 * la vía de que uno importe del otro está prohibido, y copiarlo sería tener dos.
 *
 * **Toda la aritmética es texto y `bigint`.** Lo tecleado lo convierte
 * `toMinorUnits`, en `domain/money`, y nunca pasa por un `number`; aquí sólo se
 * compone y se presenta.
 */
export function AmountField({
  entry,
  onChange,
  scale,
  label,
  separator,
  reference,
}: {
  readonly entry: AmountEntry;
  readonly onChange: (next: AmountEntry) => void;
  readonly scale: number;
  readonly label: string;
  /**
   * EL SEPARADOR DECIMAL YA RESUELTO, y llega de fuera a propósito.
   *
   * Un `','` escrito aquí sería una coma en inglés y unos decimales en yenes,
   * que no tiene decimales. Quien sabe de patrones regionales es `lib/format`, y
   * el diseño no puede leer de infraestructura: así que lo resuelve quien monta
   * la ventana y esto lo recibe hecho.
   */
  readonly separator: string;
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

  /*
   * EL CURSOR AL FINAL, UNA VEZ, tras sustituir una cantidad precargada.
   *
   * Ver `amountFieldStep`: React Native en iOS conserva el cursor relativo al
   * final del texto anterior, y al pasar de `110` a `1` lo deja en 0, con lo
   * que la siguiente tecla se insertaba delante (10 → «1», «2» → 21).
   *
   * **Imperativo, no una prop `selection` controlada.** Medido en el iPhone:
   * con `selection` declarada el botón Guardar dejó de recibir el toque —la
   * ventana no enviaba nada—. Aquí no se controla nada: tras el render en el
   * que el valor nuevo ya está aplicado, un `setSelection` de una vez coloca
   * el cursor al final, y el campo vuelve a ser el de siempre.
   *
   * La marca vive en una ref porque se escribe en un manejador y se lee en un
   * efecto —nunca en el render—, y el efecto no escribe estado.
   */
  /*
   * EL TOQUE SE ACUSA EN LA CIFRA: 1 → 1,20 → 1, como al pulsar y soltar un
   * botón. Subida rápida y vuelta suave, sin rebote, unos 220 ms en total
   * (`useFigurePop`, junto a `usePressScale`); los dos tramos respetan el ajuste
   * de movimiento reducido del sistema. Se dispara en `onPressIn` del propio
   * capturador —una vez por toque, nunca al escribir, y vuelve aunque el foco
   * se quede— y sólo escala la cifra: una transformación, sin fondo, sin color
   * y sin mover el layout. La moneda y el resto de la fila no participan.
   */
  const pop = useFigurePop(FIGURE_POP);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.scale.value }] }));

  const input = useRef<TextInput | null>(null);
  const pendingCaret = useRef(false);
  useEffect(() => {
    if (!pendingCaret.current) return;
    pendingCaret.current = false;
    const target = amountFieldSelection({ entry, pinToEnd: true });
    if (target !== undefined) input.current?.setSelection(target.start, target.end);
  });

  return (
    <View style={styles.amountSlot}>
      <Animated.View style={popStyle}>
        <AmountFigure entry={showing} scale={scale} separator={separator} muted={muted} />
      </Animated.View>

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
          const step = amountFieldStep({ entry, pinToEnd: false }, next, scale);
          const moved = step.entry;
          if (step.pinToEnd) pendingCaret.current = true;
          onChange(moved);

          // Terminada la parte decimal, el teclado sobra. Sólo al COMPLETAR
          // —no si ya lo estaba—, para que corregir un céntimo y volver a
          // escribirlo lo cierre otra vez.
          if (!amountComplete(entry, scale) && amountComplete(moved, scale)) {
            Keyboard.dismiss();
          }
        }}
        ref={input}
        onPressIn={pop.onPressIn}
        keyboardType="decimal-pad"
        caretHidden
        selectionColor="transparent"
        accessibilityLabel={label}
        style={[styles.capture, invisible]}
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
 * **El separador sale de la configuración regional, no de un literal**, y llega
 * ya resuelto desde arriba: un `','` escrito a mano sería una coma en inglés y
 * unos decimales en yenes, que no tiene decimales.
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
  separator,
  muted = false,
}: {
  entry: AmountEntry;
  scale: number;
  separator: string;
  /**
   * Apagada entera, sea cual sea su estado.
   *
   * Hace falta porque una referencia viene COMPLETA —tiene enteros y céntimos
   * escritos—, así que sus tonos dirían «esto lo puso la persona». Y no: lo
   * puso el saldo que ya existía.
   */
  muted?: boolean;
}) {
  const { whole, fraction } = amountParts(entry, scale);

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

/**
 * QUE EL EDITOR NATIVO NO PINTE SU PROPIO TEXTO, y en Android hace falta
 * decirlo aparte.
 *
 * En esta pantalla hay DOS vistas dibujando el mismo importe: la composición
 * —`AmountFigure`, la que se lee, con sus enteros grandes y sus céntimos
 * pequeños— y el `TextInput` que va encima capturando el teclado. El campo se
 * daba por invisible con `color: 'transparent'`, y en iOS lo es. En Android no:
 * su texto aparecía en negro, descentrado y por encima de la cifra blanca,
 * porque el cuerpo del campo son 56 puntos y la composición no.
 *
 * **Se apaga la CAPA, no el control.** El cursor ya estaba oculto por
 * `caretHidden`, que es una decisión de diseño anterior a esto; el toque, el
 * foco, el teclado, el borrado y `onChangeText` no dependen de que la vista
 * pinte, y una vista con opacidad cero sigue en el árbol de accesibilidad con su
 * `accessibilityLabel`. Lo único que se pierde es lo que nunca debió verse.
 *
 * **iOS no se toca.** Allí `color: 'transparent'` ya bastaba, y añadir opacidad
 * sería cambiar algo aprobado por un problema que no tiene.
 */
const invisible = Platform.select({ android: { opacity: 0 }, default: undefined });

/** Cuánto crece la cifra al tocarla. Un poco por encima de uno, y vuelve. */
const FIGURE_POP = 1.2;

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
