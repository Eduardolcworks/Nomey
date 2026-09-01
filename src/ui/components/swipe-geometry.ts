import { Spacing } from '@/ui/theme/spacing';

/**
 * LA TIRA HORIZONTAL DE UNA FILA DESLIZABLE, expresada como aritmética.
 *
 * ```
 * [ contenido de la operación ][ acción ]
 * ```
 *
 * **Por qué esto existe.** `ReanimatedSwipeable` coloca sus acciones en una capa
 * `absoluteFill` con `row-reverse`, es decir, pegadas al borde derecho de la
 * fila y DEBAJO del contenido — y **no las mueve**: entrega el desplazamiento a
 * `renderRightActions` para que lo haga quien la usa. Sin trasladarla, la acción
 * está siempre ahí, a ancho completo, y el primer milímetro de gesto la descubre
 * entera por detrás del texto. Es el defecto que esto corrige.
 *
 * **La posición es función del desplazamiento y de nada más.** No hay estado
 * acumulado, así que un segundo gesto arranca exactamente donde deja el primero
 * y abrir, cerrar y volver a abrir devuelve las mismas cifras. Eso es lo que se
 * puede comprobar sin un aparato delante.
 */

/**
 * EL BOTÓN ROJO, CUADRADO Y DE TAMAÑO FIJO.
 *
 * **Cuadrado y no una tira**: una píldora larga y baja pesaba mucho más de lo
 * que pide una acción secundaria de una fila.
 *
 * **Y fijo, no del alto de la fila.** Al desplegar una operación la fila crece
 * con su detalle, y un botón que se estirara con ella se volvería una columna
 * roja. Se queda de su tamaño, centrado verticalmente en lo que haya.
 *
 * Son 52, que es el lado que Nomey ya usa para sus controles táctiles —los
 * círculos de la fila de campos, el alto mínimo de los campos de texto—, y por
 * encima del mínimo accesible de 44. **El tema no tiene un token para esto**:
 * el 52 vive como literal en `app/` y en `features/`, y `ui/` no puede importar
 * de ninguno de los dos. Así que se declara aquí, una vez, y de aquí sale todo
 * lo demás.
 */
export const DELETE_ACTION_SIZE = 52;

/**
 * CUÁNTO RESPIRA EL BOTÓN DENTRO DE SU HUECO.
 *
 * **Simétrico en los cuatro lados**, que es lo que lo separa del margen a un
 * solo lado que hubo antes: aquello era una franja vacía entre el texto y la
 * acción; esto es el mismo aire por arriba, por abajo y por los dos costados.
 *
 * El escalón más pequeño de la escala: no se trata de separar dos bloques, sino
 * de despegar el rojo de los cantos.
 */
export const DELETE_ACTION_INSET = Spacing.xxs;

/**
 * EL HUECO DE LA ACCIÓN: lo que se recorre, dónde ancla y qué se puede pulsar.
 *
 * **Sale del botón, no al revés.** Un hueco mayor que lo pintado dejaría una
 * franja vacía entre el contenido y el rojo — que es exactamente el defecto que
 * tuvo esto cuando eran dos cifras sueltas. Aquí sólo hay una decisión, el lado
 * del botón, y el recorrido es su consecuencia.
 *
 * **El área táctil es este hueco entero**, no el botón: se puede tocar hasta el
 * canto aunque lo pintado respire un poco menos.
 */
export const DELETE_ACTION_WIDTH = DELETE_ACTION_SIZE + DELETE_ACTION_INSET * 2;

/**
 * Dónde va la acción para un desplazamiento dado.
 *
 * `drag` es lo que entrega la librería: **cero en reposo y negativo** mientras
 * se arrastra hacia la izquierda.
 *
 * - en reposo devuelve el ancho entero, o sea la acción **fuera** del borde
 *   derecho — y el contenedor, que ya recorta, la esconde;
 * - a mitad de gesto devuelve la parte proporcional, así que entra poco a poco;
 * - en la posición abierta devuelve cero: pegada al canto del contenido.
 *
 * **Nunca menos de cero**, que es lo que garantiza que no se meta bajo el texto
 * ni siquiera si el gesto se pasa; y nunca más que su ancho, para que un
 * arrastre hacia la derecha no la aleje más de lo que ya está escondida.
 */
export function deleteActionOffset(drag: number, width = DELETE_ACTION_WIDTH): number {
  'worklet';
  return Math.min(Math.max(drag + width, 0), width);
}

/** Cuánto del control se ve, para poder afirmarlo sin mirar la pantalla. */
export function deleteActionRevealed(drag: number, width = DELETE_ACTION_WIDTH): number {
  return width - deleteActionOffset(drag, width);
}
