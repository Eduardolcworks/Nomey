/**
 * UN FALLO DE LA INFRAESTRUCTURA LOCAL, tipado y sin contenido.
 *
 * Que SQLite falle —disco lleno, base bloqueada, fichero corrupto, el módulo
 * nativo caído— es un fallo **del cliente**, no una respuesta del servidor, y
 * por eso no pasa por la clasificación de ADR-028 §11 ni produce un código de
 * frontera. Lo que hace es más humilde: la pasada se interrumpe, **ninguna
 * entrada cambia de estado por ello**, y el coordinador vuelve a intentar la
 * infraestructura con su backoff.
 *
 * Lo que un fallo local **nunca** hace:
 *
 * - mover una entrada a `rejected`, `review` o `conflict`: esos estados hablan
 *   de lo que el servidor demostró, y aquí el servidor no ha dicho nada;
 * - borrar, reconstruir ni crear otra clave;
 * - saltarse la cola con un envío directo: la puerta directa es la de F6 y no
 *   se abre desde aquí.
 *
 * **Lo que se guarda del error es el nombre y, si lo trae, un `code`.** Nunca
 * el mensaje: el de SQLite puede llevar fragmentos de SQL, y aunque los valores
 * viajan como parámetros y no aparecen en él, ADR-028 §19 pide no registrar
 * nada que pueda acercarse a un importe o a un concepto. Con el nombre y la
 * etapa basta para saber qué se rompió; con la clave, para saber a quién le
 * pasó.
 */

/**
 * En qué punto de la pasada se rompió la infraestructura.
 *
 * | Etapa         | Qué estaba haciendo                            | La fila queda      |
 * | ------------- | ---------------------------------------------- | ------------------ |
 * | `read`        | leyendo la cola del actor                      | como estaba        |
 * | `revive`      | devolviendo a `queued` una `blocked_session`   | como estaba        |
 * | `markSending` | marcando `sending` antes de enviar             | `queued`, sin salir|
 * | `record`      | anotando la respuesta del servidor             | **`sending`**      |
 * | `schedule`    | leyendo los plazos para armar el temporizador  | como estaba        |
 *
 * `record` es la etapa delicada: la petición ya salió y el servidor **pudo
 * haber escrito**. La fila conserva su clave y queda `sending` en disco, que
 * ADR-028 §6 relee siempre como `queued`: se reenviará igual, y el servidor
 * contestará `already_processed` si aquello llegó. Ni se distingue ni se
 * intenta.
 */
export type InfrastructureStage = 'read' | 'revive' | 'markSending' | 'record' | 'schedule';

export type InfrastructureFailure = {
  readonly stage: InfrastructureStage;
  /** La entrada afectada, si la había. Sólo la clave: jamás el payload. */
  readonly clientOperationId: string | null;
  /** Si la petición ya había salido cuando falló. Entonces la fila queda `sending`. */
  readonly afterSend: boolean;
  /** `error.name`, o el `typeof` de lo lanzado si no era un `Error`. */
  readonly errorName: string;
  /** Un `code` de cadena si el error lo traía —`SQLITE_FULL`, `SQLITE_BUSY`—. */
  readonly errorCode: string | null;
};

/** Reduce cualquier cosa lanzada a lo que se puede guardar sin riesgo. */
export function describeFailure(
  stage: InfrastructureStage,
  cause: unknown,
  context: { readonly clientOperationId: string | null; readonly afterSend: boolean },
): InfrastructureFailure {
  const errorName = cause instanceof Error ? cause.name : typeof cause;
  const code = (cause as { code?: unknown } | null)?.code;
  return {
    stage,
    clientOperationId: context.clientOperationId,
    afterSend: context.afterSend,
    errorName,
    errorCode: typeof code === 'string' ? code : null,
  };
}

/**
 * Lo que una pasada le cuenta a quien la escucha al terminar.
 *
 * `infrastructure` es `null` cuando la pasada terminó por sus propios medios
 * —envió, se quedó sin trabajo, no tocaba, no había sesión— y lleva el fallo
 * cuando la interrumpió la infraestructura local. Es lo único que el
 * coordinador necesita para decidir si el ciclo que cierra es el de la cola o
 * el de la propia base.
 */
export type PassResult = {
  readonly infrastructure: InfrastructureFailure | null;
};
