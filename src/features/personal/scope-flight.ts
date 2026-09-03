/**
 * UN VUELO COMPARTIDO, CON SUSCRIPCIONES QUE PUEDEN MORIR POR SEPARADO.
 *
 * **Por qué existe.** Aquí había un booleano: la primera invocación del efecto
 * lo levantaba y las siguientes se iban sin hacer nada. React invoca dos veces
 * cada efecto en desarrollo —monta, limpia, vuelve a montar—, así que la que se
 * quedaba con la respuesta era la que la limpieza ya había cancelado, y la que
 * seguía viva no estaba suscrita a nada. La respuesta llegaba, se descartaba, y
 * la pantalla se quedaba en su estado inicial con un 200 en el servidor.
 *
 * En el iPhone no se veía por milésimas: contra la red local la respuesta
 * llegaba antes de la limpieza y se aplicaba. Contra `10.0.2.2` desde el
 * emulador, no. Era una carrera, no una diferencia de plataforma.
 *
 * **Las dos cosas que separa, y que el booleano confundía:**
 *
 * - el VUELO es la operación, y se comparte: mientras hay uno en curso, nadie
 *   lanza otro;
 * - la SUSCRIPCIÓN es de cada invocación, y muere sola: una cancelada descarta
 *   el resultado, y eso sigue siendo cierto — un componente realmente
 *   desmontado nunca escribe.
 *
 * **Y el vuelo sólo se limpia a sí mismo.** El `finally` comprueba que la
 * promesa que termina siga siendo la vigente: una respuesta lenta de un intento
 * anterior no puede dejar sin dueño a uno posterior.
 */

/** Lo que se hace con el resultado, si la suscripción sigue viva. */
export type ScopeSink<T> = {
  readonly value: (result: T) => void;
  readonly error: () => void;
};

/** Una suscripción viva. Cancelarla la calla para siempre. */
export type ScopeSubscription = {
  readonly cancel: () => void;
};

export type ScopeFlight<T> = {
  /**
   * Se suscribe al vuelo en curso, o lo arranca si no hay ninguno.
   *
   * `start` sólo se llama cuando hace falta empezar uno: mientras se comparte,
   * el servidor recibe una única petición.
   */
  readonly join: (start: () => Promise<T>, sink: ScopeSink<T>) => ScopeSubscription;
  /** Si hay un vuelo en curso. Para poder afirmarlo en las pruebas. */
  readonly pending: () => boolean;
};

export function createScopeFlight<T>(): ScopeFlight<T> {
  let current: Promise<T> | null = null;

  return {
    join(start, sink) {
      let alive = true;

      const flight = current ?? start();
      current = flight;

      void flight
        .then(
          (result) => {
            if (alive) sink.value(result);
          },
          () => {
            if (alive) sink.error();
          },
        )
        .finally(() => {
          // SÓLO si sigue siendo el vigente. Ver la nota de cabecera.
          if (current === flight) current = null;
        });

      return {
        cancel: () => {
          alive = false;
        },
      };
    },

    pending: () => current !== null,
  };
}
