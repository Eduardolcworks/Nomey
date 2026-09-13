/**
 * «ACABO DE ESCRIBIR UN GASTO EN ESTE GRUPO.»
 *
 * El `+` de un grupo abre **otra ruta**, apilada encima. Cuando esa ruta guarda
 * y se cierra, la pantalla del grupo sigue montada exactamente como estaba: no
 * se remonta, no vuelve a consultar y por tanto no se enteraría de nada. Esto es
 * el hilo que las une, con el mismo patrón que `lib/offline/queue-events.ts`.
 *
 * **No transporta el gasto**: sólo de qué ámbito se trata, para que quien esté
 * mirándolo vuelva a leer del servidor. El dato sigue viviendo únicamente donde
 * la frontera lo escribió — anunciar aquí el importe crearía una segunda copia
 * que podría discrepar de la autoritativa.
 *
 * **No es una recarga al recuperar el foco.** Volver de la ventana sin haber
 * guardado nada —cancelar, el gesto del sistema, el Atrás de hardware— no
 * dispara ninguna consulta, porque no ha cambiado nada que leer.
 *
 * Un oyente que lanza no rompe a quien anuncia: el anuncio sale del `then` del
 * guardado, y una excepción ahí contaría como fallo de una escritura correcta.
 */

type Listener = (scopeId: string) => void;

const listeners = new Set<Listener>();

export function subscribeGroupRecorded(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishGroupRecorded(scopeId: string): void {
  for (const listener of [...listeners]) {
    try {
      listener(scopeId);
    } catch {
      // Un oyente roto no convierte un guardado correcto en un fallo.
    }
  }
}

/** Para poder afirmar en una prueba que no queda nadie escuchando. */
export function groupListenerCount(): number {
  return listeners.size;
}

/**
 * LA CAMPANA DIO POR VISTOS SUS AVISOS. Hay más de una lista de avisos viva a
 * la vez —la del punto de la barra y la de la propia campana— y cada una lee
 * por su cuenta; sin esto, el punto seguiría encendido hasta la siguiente
 * escritura en un grupo. No lleva carga: quien escucha vuelve a leer.
 */
const seenListeners = new Set<() => void>();

export function subscribeNoticesSeen(listener: () => void): () => void {
  seenListeners.add(listener);
  return () => {
    seenListeners.delete(listener);
  };
}

export function publishNoticesSeen(): void {
  for (const listener of [...seenListeners]) {
    try {
      listener();
    } catch {
      // Un oyente roto no convierte un marcado correcto en un fallo.
    }
  }
}
