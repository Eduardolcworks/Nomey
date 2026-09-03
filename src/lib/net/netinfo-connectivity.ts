/**
 * LO ÚNICO QUE NOMBRA `@react-native-community/netinfo`.
 *
 * Mismo patrón que `session-storage.ts` con SecureStore y `sqlite-database.ts`
 * con `expo-sqlite`: un punto de contacto, para que todo lo demás sea
 * comprobable sin el módulo nativo y para poder afirmar en un test que nadie
 * más lo importa.
 *
 * **NetInfo dispara y suprime; jamás demuestra** (ADR-028 §11). Que haya enlace
 * no dice nada sobre si Supabase contesta, y por eso la clasificación de una
 * respuesta no lo consulta nunca: sale del transporte o de la frontera.
 *
 * **La duda cuenta como conectado.** Antes del primer evento, `isConnected` es
 * `null`, y tratarlo como «no hay red» dejaría la cola parada al arrancar sin
 * ningún motivo. Suprimir un intento sólo es correcto cuando se SABE que no hay
 * enlace; en la duda, se intenta y contesta el transporte.
 */

import NetInfo from '@react-native-community/netinfo';

import type { Connectivity } from '@/lib/offline';

export function createNetInfoConnectivity(): Connectivity {
  let connected = true;

  const unsubscribe = NetInfo.addEventListener((state) => {
    connected = state.isConnected !== false;
  });
  void unsubscribe;

  return {
    isConnected: () => connected,
    subscribe(listener) {
      return NetInfo.addEventListener((state) => {
        const next = state.isConnected !== false;
        connected = next;
        listener(next);
      });
    },
  };
}
