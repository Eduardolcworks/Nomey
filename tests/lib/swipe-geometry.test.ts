import { describe, expect, it } from 'vitest';

import {
  DELETE_ACTION_INSET,
  DELETE_ACTION_SIZE,
  DELETE_ACTION_WIDTH,
  deleteActionOffset,
  deleteActionRevealed,
} from '../../src/ui/components/swipe-geometry';

/**
 * LA TIRA DE UNA FILA DESLIZABLE, comprobada como aritmética.
 *
 * ```
 * [ contenido de la operación ][ acción ]
 * ```
 *
 * Se prueba la GEOMETRÍA, no una cadena en el fuente: `ReanimatedSwipeable`
 * entrega el desplazamiento y quien lo usa decide dónde cae la acción, así que
 * todo lo que puede ir mal —descubrirse entera con un milímetro, quedarse bajo
 * el texto, no volver al sitio al cancelar— es esta función.
 *
 * `drag` es lo que entrega la librería: cero en reposo y **negativo** mientras
 * se arrastra hacia la izquierda.
 */

/** Lo que la librería entrega para un arrastre de tantos puntos a la izquierda. */
function arrastre(puntos: number): number {
  return -puntos;
}

describe('la acción de eliminar se coloca por el gesto', () => {
  /**
   * **UNA SOLA DECISIÓN: el lado del botón.** Todo lo demás se deriva, así que
   * no puede quedar una franja vacía entre el contenido y el rojo — que fue el
   * defecto cuando el hueco y lo pintado eran dos cifras sueltas.
   */
  it('el hueco es el botón más su aire, a los dos lados', () => {
    expect(DELETE_ACTION_WIDTH).toBe(DELETE_ACTION_SIZE + DELETE_ACTION_INSET * 2);
  });

  /** Y el botón es cuadrado: una acción de fila, no una píldora larga. */
  it('el botón es prácticamente cuadrado', () => {
    // Su lado cabe holgadamente en el hueco, que sólo le añade el aire.
    expect(DELETE_ACTION_SIZE).toBeGreaterThan(DELETE_ACTION_WIDTH * 0.9);
    // Y por encima del mínimo táctil accesible.
    expect(DELETE_ACTION_SIZE).toBeGreaterThanOrEqual(44);
  });

  it('el ancho abierto es el recorrido entero', () => {
    // Recorrer el hueco lo deja exactamente encajado, sin sobrar ni faltar.
    expect(deleteActionOffset(arrastre(DELETE_ACTION_WIDTH))).toBe(0);
    expect(deleteActionRevealed(arrastre(DELETE_ACTION_WIDTH))).toBe(DELETE_ACTION_WIDTH);
  });

  /**
   * **EL INSET NO TOCA EL RECORRIDO**, y por eso son tres conceptos y no uno.
   *
   * Lo que se arrastra y lo que se puede pulsar miden el hueco entero; lo
   * PINTADO se mete un escalón hacia dentro por los cuatro lados. La aritmética
   * del gesto no sabe nada de ese escalón: recorrer el hueco sigue encajando
   * exactamente, con o sin él.
   */
  it('la superficie respira sin cambiar lo que se recorre', () => {
    expect(deleteActionOffset(arrastre(DELETE_ACTION_WIDTH))).toBe(0);
    expect(deleteActionOffset(0)).toBe(DELETE_ACTION_WIDTH);

    // Y es un escalón, no un margen: cabe de sobra dentro del hueco.
    expect(DELETE_ACTION_INSET).toBeGreaterThan(0);
    expect(DELETE_ACTION_INSET * 2).toBeLessThan(DELETE_ACTION_WIDTH / 4);
  });

  /**
   * **REPOSO: fuera del borde derecho.** Desplazada su ancho entero, así que el
   * contenedor de la librería —que ya recorta— no deja ver nada de ella. Es lo
   * contrario del defecto: antes estaba siempre puesta, detrás del texto.
   */
  it('en reposo queda completamente fuera', () => {
    expect(deleteActionOffset(0)).toBe(DELETE_ACTION_WIDTH);
    expect(deleteActionRevealed(0)).toBe(0);
  });

  /**
   * **ARRASTRE PARCIAL: proporción exacta.** Un gesto de pocos puntos enseña
   * esos pocos puntos, que es justo lo que no pasaba.
   */
  it('un arrastre pequeño sólo enseña su parte', () => {
    expect(deleteActionRevealed(arrastre(3))).toBe(3);
    expect(deleteActionRevealed(arrastre(20))).toBe(20);
    expect(deleteActionRevealed(arrastre(DELETE_ACTION_WIDTH / 2))).toBe(DELETE_ACTION_WIDTH / 2);
  });

  /** Y avanza monótonamente: más gesto nunca enseña menos control. */
  it('cuanto más se arrastra, más se ve', () => {
    let anterior = -1;
    for (let puntos = 0; puntos <= DELETE_ACTION_WIDTH; puntos += 4) {
      const visible = deleteActionRevealed(arrastre(puntos));
      expect(visible).toBeGreaterThan(anterior);
      anterior = visible;
    }
  });

  /**
   * **POSICIÓN ABIERTA: pegada al canto del contenido.** Desplazamiento cero,
   * ni un punto por debajo — que es lo que la mantiene siempre DESPUÉS de la
   * fila y nunca bajo el texto.
   */
  it('en la posición abierta queda justo después del contenido', () => {
    expect(deleteActionOffset(arrastre(DELETE_ACTION_WIDTH))).toBe(0);
    expect(deleteActionRevealed(arrastre(DELETE_ACTION_WIDTH))).toBe(DELETE_ACTION_WIDTH);
  });

  /**
   * **NUNCA BAJO EL CONTENIDO.** Aunque el gesto se pase de largo —o la
   * animación de encaje se pase un fotograma—, no entra en territorio del
   * texto. Sin `zIndex`, sin transparencias y sin esperas: es la aritmética.
   */
  it('ningún arrastre la mete bajo el contenido', () => {
    for (const puntos of [DELETE_ACTION_WIDTH + 1, 200, 5000]) {
      expect(deleteActionOffset(arrastre(puntos))).toBe(0);
    }
  });

  /** Ni un gesto hacia el otro lado la aleja más de lo que ya está escondida. */
  it('un arrastre hacia la derecha no la aparta más', () => {
    for (const puntos of [1, 40, 500]) {
      expect(deleteActionOffset(puntos)).toBe(DELETE_ACTION_WIDTH);
    }
  });

  /**
   * **CANCELAR: vuelve exactamente al sitio.** Soltar antes del umbral devuelve
   * el desplazamiento a cero, y con él la acción a fuera — sin residuo.
   */
  it('al cancelar vuelve a estar fuera del todo', () => {
    const aMedias = deleteActionOffset(arrastre(12));
    expect(aMedias).toBeLessThan(DELETE_ACTION_WIDTH);
    expect(deleteActionOffset(0)).toBe(DELETE_ACTION_WIDTH);
    expect(deleteActionRevealed(0)).toBe(0);
  });

  /**
   * **SEGUNDO GESTO: sin memoria.** La posición depende SÓLO del desplazamiento
   * de ahora, así que abrir, cerrar y volver a abrir recorre las mismas cifras.
   * Nada se acumula, nada se duplica y nada se queda superpuesto.
   */
  it('abrir, cerrar y volver a abrir recorre lo mismo', () => {
    const recorrido = (): readonly number[] =>
      [0, 10, 40, DELETE_ACTION_WIDTH].map((puntos) => deleteActionOffset(arrastre(puntos)));

    const primero = recorrido();
    // Entre medias se cerró: el desplazamiento vuelve a cero.
    expect(deleteActionOffset(0)).toBe(DELETE_ACTION_WIDTH);

    expect(recorrido()).toEqual(primero);
  });
});
