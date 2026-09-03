/**
 * LOS PUERTOS DEL WORKER.
 *
 * Seis, y todos inyectables: almacenamiento, transporte, reloj, RNG,
 * conectividad y sesión. No es ceremonia — es lo que permite que las pruebas
 * del worker sean **deterministas**: sin esperas arbitrarias, sin red y sin
 * depender de qué devuelva `Math.random` hoy.
 *
 * Ninguno de ellos conoce `expo-*` ni `@supabase/*`. Los adaptadores reales
 * viven en `features/personal/`, que es la capa a la que le corresponde
 * saber que existen NetInfo y `personal-service`.
 */

import type { Clock, Random } from './backoff';
import type { FrozenPayload, QueueCommandType } from './command';
import type { PassResult } from './local-failure';
import type { QueueStore } from './queue-store';
import type { SessionStatus, TransportOutcome } from './response';

/**
 * El envío de un comando.
 *
 * Recibe **el payload congelado, tal cual**, y una señal de cancelación. No
 * construye nada, no valida nada y no elige función: el discriminante ya lo
 * decidió quien encoló, y traducirlo es trabajo del adaptador con un `switch`
 * exhaustivo (ADR-028 §3).
 */
export type QueueTransport = {
  send(
    commandType: QueueCommandType,
    payload: FrozenPayload,
    signal: AbortSignal,
  ): Promise<TransportOutcome>;
};

/**
 * El enlace del aparato. **Disparador y supresor, jamás una prueba.**
 *
 * ADR-028 §11: sin enlace no se intenta —no se gasta batería en un fallo
 * seguro— pero **no se marca nada como fallido**. Que haya enlace no dice nada
 * sobre si Supabase contesta; eso sólo lo dice el transporte.
 */
export type Connectivity = {
  /** `false` sólo cuando se sabe que no hay enlace. La duda cuenta como `true`. */
  isConnected(): boolean;
  /** Avisa de cada cambio. Devuelve cómo dejar de escuchar. */
  subscribe(listener: (connected: boolean) => void): () => void;
};

/**
 * Quién está dentro, ahora mismo.
 *
 * El worker **no lee, no copia y no guarda el token** (ADR-028 §13): sólo
 * pregunta si hay sesión válida y de quién es. Quien adjunta el JWT y lo
 * refresca es el cliente de Supabase, como siempre.
 */
export type SessionPort = {
  status(): SessionStatus;
  /** El `sub` del JWT, o `null` si no hay sesión. */
  actorId(): string | null;
  subscribe(listener: () => void): () => void;
};

/** Volver a primer plano, sobre el puerto que F5.B ya tenía. No un segundo listener. */
export type ForegroundPort = {
  subscribe(listener: () => void): () => void;
};

export type WorkerPorts = {
  readonly store: QueueStore;
  readonly transport: QueueTransport;
  readonly clock: Clock;
  readonly random: Random;
  readonly connectivity: Connectivity;
  readonly session: SessionPort;
  /**
   * Cuánto se espera una petición antes de abortarla de verdad.
   *
   * ADR-028 §17. Agotarlo **conserva la entrada y su clave**: si la petición
   * abandonada llegó a escribir, el reintento recibe `already_processed`.
   */
  readonly timeoutMs?: number;

  /**
   * EL PUNTO QUE CIERRA EL CICLO. Se llama cuando una pasada termina.
   *
   * Sin esto el bucle automático **no existe**: un fallo transitorio deja su
   * `next_attempt_at` escrito y nadie arma el temporizador, así que la entrada
   * se queda esperando a un disparador externo —volver a primer plano,
   * reconectar— que puede no llegar en horas.
   *
   * `wake()` es deliberadamente fire-and-forget, así que quien quiera reaccionar
   * al **resultado** de la pasada no puede esperarla desde fuera: tiene que
   * enterarse por aquí. Lo usa `sync-coordinator.ts` para reprogramar.
   *
   * Recibe si la pasada la interrumpió la infraestructura local: entonces lo
   * que hay que programar no es un plazo de la cola sino el reintento de la
   * propia base, y sólo el coordinador tiene con qué calcularlo.
   */
  readonly onSettled?: (pass: PassResult) => void;
};
