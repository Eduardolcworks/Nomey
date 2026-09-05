/**
 * LO QUE DECIDE EL ASPECTO DE UN CAMPO, FUERA DEL COMPONENTE.
 *
 * **Por qué vive aquí y no dentro del `.tsx`.** El proyecto no tiene renderer de
 * React y no se va a añadir uno por esto, así que una regla enterrada en el JSX
 * sólo se podría comprobar leyendo el fuente — y una prueba que busca cadenas
 * falla cuando alguien reescribe una línea sin cambiar nada, que es el peor
 * canje posible. Sacadas aquí, las dos reglas son funciones puras y se prueban
 * por lo que hacen.
 *
 * No decide nada nuevo: es exactamente lo que el campo ya hacía, en un sitio
 * donde se puede interrogar.
 */

/**
 * El contorno del campo: un color, un grosor, y el mismo para las cuatro
 * esquinas porque no hay cuatro trazados sino uno.
 *
 * **El grosor NO depende del foco, y es deliberado.** El borde crece hacia
 * dentro del marco, así que engordarlo sólo al enfocar haría que la caja
 * cambiase de alto justo al tocarla. Devolver el mismo ancho siempre es lo que
 * mantiene la geometría quieta.
 *
 * **Y no lleva opacidad.** El color es el token tal cual: aplicar una opacidad
 * al contorno lo mezclaría con el fondo y reaparecería, por otra vía, el
 * problema que el grosor arregla.
 */
export type FieldBorder = {
  readonly color: string;
  readonly width: number;
};

/**
 * Un píxel físico no basta para una curva.
 *
 * Medido sobre una captura del campo enfocado en Android: con
 * `StyleSheet.hairlineWidth` —exactamente un píxel físico— el tramo recto salía
 * en el acento puro y el píxel más brillante de cada fila del arco oscilaba
 * entre el 42 % y el 97 % de ese valor, porque la curva cruza la rejilla en
 * diagonal y cada píxel recibe cobertura parcial. Con este grosor las 33 filas
 * del arco medidas dan el acento exacto.
 */
export const FIELD_BORDER_WIDTH = 1;

export function fieldBorder(
  focused: boolean,
  palette: { accent: string; border: string },
): FieldBorder {
  return {
    color: focused ? palette.accent : palette.border,
    width: FIELD_BORDER_WIDTH,
  };
}

/** Lo que hay que pintar y anunciar en el botón de mostrar u ocultar. */
export type RevealPresentation = {
  /** Si el texto va enmascarado. */
  readonly secure: boolean;
  /** La clave i18n del nombre accesible, que cambia con el estado. */
  readonly labelKey: 'auth.showPassword' | 'auth.hidePassword';
  /** Cuál de los dos iconos del vocabulario se usa. */
  readonly icon: 'reveal' | 'conceal';
  /** El estado accesible, para que no dependa sólo del nombre. */
  readonly selected: boolean;
};

/**
 * Resuelve el botón de ojo.
 *
 * **El botón manda sobre `secureTextEntry` mientras exista.** Si el llamante
 * pasara las dos cosas, dos fuentes decidirían lo mismo y la que perdiera sería
 * invisible; aquí gana el botón, que es el que la persona ve.
 *
 * Y `revealed` sólo significa algo cuando hay botón: sin él, manda lo que pidió
 * el llamante y el estado interno no puede desenmascarar nada.
 */
export function revealPresentation(
  revealed: boolean,
  revealable: boolean,
  secureTextEntry: boolean | undefined,
): RevealPresentation {
  const secure = revealable ? !revealed : (secureTextEntry ?? false);

  return {
    secure,
    labelKey: revealed ? 'auth.hidePassword' : 'auth.showPassword',
    icon: revealed ? 'conceal' : 'reveal',
    selected: revealed,
  };
}

/** Alternar. Una función de una línea, pero es la que fija que sea un ciclo. */
export function nextRevealed(revealed: boolean): boolean {
  return !revealed;
}
