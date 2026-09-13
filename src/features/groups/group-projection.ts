/**
 * LA PROYECCIÓN DE GRUPOS: snapshot del servidor + comandos locales. Pura.
 *
 * F07/ADR-001 §8, aplicado a una LISTA y no a una cifra. La diferencia importa y es
 * lo que hace esto mucho más simple que `features/personal/projection.ts`:
 *
 * **Aquí no se suma nada.** Un grupo no es un agregado, es una identidad. Y esa
 * identidad la genera el cliente antes del primer intento (`client_group_id`) y
 * el servidor la conserva tal cual (`scope_id`), así que las dos fuentes hablan
 * de lo mismo con el mismo nombre. Unirlas es una igualdad, no una aritmética, y
 * **contar dos veces el mismo grupo es estructuralmente imposible**: dos filas
 * con la misma identidad colapsan en una.
 *
 * Por eso esto **no necesita la ventana de instantánea** de F7 —el argumento del
 * doble conteo, que allí decide si una respuesta es siquiera fiable— ni podría
 * usarla: vive en otra feature y `features/` no importa `features/`. Lo que sí
 * se conserva es la marca de retirada de §9, que aquí responde a una pregunta
 * distinta: **¿sigue siendo esta creación incierta?**
 *
 *   retirada  ⇔  confirm_seq <= snapshot.seq
 *
 * Retirada significa que el servidor ya la tenía cuando la consulta corrió, así
 * que la fila del servidor es la buena. Sin retirar, **la creación local
 * prevalece sobre un snapshot más antiguo**: el snapshot no la había visto
 * todavía, y dejar de pintarla haría desaparecer de la pantalla un grupo que la
 * persona acaba de crear.
 *
 * **Confirmarse no cambia la identidad.** La tarjeta no se remonta, la ruta
 * interior sigue valiendo y el número de participantes es el mismo, porque el
 * servidor devuelve el que se le mandó.
 */

import { groupPayloadOf } from '@/lib/offline/command';
import type { QueueEntry, QueueEntryState } from '@/lib/offline/queue-entry';

import { type GroupPosition, groupPosition } from './group-position';
import type { GroupPositionRow, RemoteGroup } from './group-service';

/** Un grupo tal como lo pinta la pantalla, venga de donde venga. */
export type ProjectedGroup = {
  /** La identidad definitiva. Idéntica antes y después de confirmarse. */
  readonly scopeId: string;
  readonly displayName: string;
  readonly emoji: string;
  readonly currencyDefinitionId: string;
  readonly currencyCode: string;
  /** Los decimales de ESTA definición. Nunca se presupone 2 (F02/ADR-001 §3). */
  readonly currencyScale: number;
  /** Contando a quien lo creó. */
  readonly participantCount: number;
  readonly createdAt: string;
  /**
   * El testigo del CAS de la edición, o `null` si el grupo aún no ha vuelto
   * del servidor: sin fila autoritativa no hay nada que declarar, y el editor
   * lo dice en vez de fingir un guardado.
   */
  readonly updatedAt: string | null;
  /** La categoría preestablecida del grupo, o `null` («Todas»). */
  readonly defaultCategoryId: string | null;
  /** El registro del último movimiento, o `null` sin movimientos. Ordena la lista. */
  readonly lastActivityAt: string | null;
  /**
   * LA POSICIÓN NETA DEL ACTOR en este grupo, en unidad mínima de `currency*`.
   *
   * **Tipada y con su definición monetaria al lado**, nunca una cadena ya
   * formateada ni un número suelto: es el mismo contrato que consumirá el motor
   * de gastos, y lo único que cambiará entonces es de dónde salen los importes.
   *
   * Hoy vale cero, y **por una ausencia real y comprobable**, no por un valor
   * por defecto: ver `GROUP_DEBT_AMOUNTS`.
   */
  readonly position: GroupPosition;
  /**
   * Si todavía no está reconciliado con el servidor.
   *
   * **No es una etiqueta de interfaz.** La tarjeta no lo pinta con otro color
   * ni con un contador aparte (F07/ADR-001, invariante 13); está para que la
   * pantalla interior sepa que ese grupo aún no tiene fila autoritativa y no
   * ofrezca lo que todavía no se puede hacer.
   */
  readonly pending: boolean;
};

/**
 * LOS ESTADOS QUE SE PINTAN, y por qué los otros no.
 *
 * Una entrada en marcha —encolada, enviándose, esperando reintento o parada por
 * falta de sesión— es una intención viva: el grupo o existe ya en el servidor o
 * va a existir, y esconderla haría desaparecer lo que la persona acaba de
 * crear.
 *
 * **Las terminales de fallo no se pintan.** `rejected`, `review` y `conflict`
 * significan que el servidor se negó o que hace falta una decisión humana; una
 * tarjeta ahí afirmaría que el grupo existe cuando no existe. Aparecen en la
 * bandeja de incidencias, que es donde se resuelven, y no en la lista.
 */
const PAINTED: readonly QueueEntryState[] = [
  'queued',
  'sending',
  'retryable',
  'blocked_session',
  'confirmed',
];

/** Una entrada local convertida en grupo, o `null` si no habla de un grupo. */
export function localGroup(entry: QueueEntry): ProjectedGroup | null {
  const payload = groupPayloadOf(entry.commandType, entry.payload);
  if (payload === null) return null;
  if (!PAINTED.includes(entry.state)) return null;

  return {
    scopeId: payload.client_group_id,
    displayName: payload.display_name,
    emoji: payload.emoji,
    currencyDefinitionId: payload.currency_definition_id,
    /*
     * La divisa sale de la instantánea monetaria de la ENTRADA, no del catálogo
     * de ahora: es la que estaba vigente cuando se congeló la intención, y es la
     * que el servidor va a resolver. Releerla del catálogo podría formatear un
     * importe futuro con una escala que nadie eligió.
     */
    currencyCode: entry.currency.code,
    currencyScale: entry.currency.scale,
    participantCount: 1 + payload.participants.length,
    createdAt: entry.createdAt,
    updatedAt: null,
    /*
     * La preferencia viaja en el comando durable desde que existe; un comando
     * congelado antes no la lleva, y ausente significa «Todas». No se
     * reescribe ningún comando: se interpreta.
     */
    defaultCategoryId: payload.default_category_id ?? null,
    /* Un grupo que aún no ha viajado no tiene movimientos en el servidor. */
    lastActivityAt: null,
    /*
     * Un grupo que todavía no ha salido de este aparato no puede tener deudas:
     * no hay operación posible sobre un ámbito que el servidor aún no conoce.
     * **Cero CONOCIDO, no desconocido**, y por eso la colección vacía y no
     * `null`: es una ausencia demostrable, no un dato que falte.
     */
    position: groupPosition([]),
    pending: true,
  };
}

/**
 * La posición de un grupo confirmado. **Tres respuestas, no dos.**
 *
 * - **Sin lectura de posiciones** —no llegó, o falló— es `unavailable`. No es
 *   cero: afirmar «Saldado» sobre un grupo cuyos efectos no se han leído es
 *   exactamente la cifra contable sin derivar que `AGENTS.md` §1 prohíbe. Es el
 *   defecto que esto corrige: hasta ahora la posición salía de una constante
 *   vacía, así que TODA tarjeta decía «Saldado · 0,00» tuviera lo que tuviera.
 * - **Con lectura y sin fila para este grupo** es cero de verdad.
 *   `api.group_summary` agrega sobre efectos vigentes, de modo que un grupo sin
 *   ningún gasto no aparece — y no tener deudas es la respuesta, no su ausencia.
 * - **Con fila** es su `net_position`… si la divisa es la del grupo.
 *
 * **La divisa se comprueba, no se supone.** Hoy la igualdad está garantizada
 * por una clave ajena compuesta —el efecto lleva la divisa base de su ámbito—,
 * pero eso es un invariante del esquema y esto es una frontera de red: si
 * alguna vez llegara una posición en otra definición monetaria, pintarla junto
 * al código de divisa del grupo sería enseñar una cifra en euros que no está en
 * euros. Antes que eso, no se afirma nada (F02/ADR-001 §2).
 */
function fromRemote(
  row: RemoteGroup,
  positions: ReadonlyMap<string, GroupPositionRow> | null,
): ProjectedGroup {
  if (positions === null) return { ...row, position: groupPosition(null), pending: false };

  const found = positions.get(row.scopeId);
  if (found === undefined) return { ...row, position: groupPosition([]), pending: false };
  if (found.currencyDefinitionId !== row.currencyDefinitionId) {
    return { ...row, position: groupPosition(null), pending: false };
  }

  return { ...row, position: groupPosition([found.netMinor]), pending: false };
}

/**
 * LA POSICIÓN NETA DEL ACTOR EN TODOS SUS GRUPOS, para el bloque de Deudas.
 *
 * **Se compensan, y las individuales no se pierden.** Deber 30 en un viaje y
 * que te deban 30 en el piso es estar en paz, y eso es lo que la cifra de
 * Inicio tiene que decir; cada tarjeta sigue enseñando su propia posición, que
 * es donde el detalle importa. Una cifra agregada y N individuales, todas de la
 * misma columna.
 *
 * **Sin paginar.** `api.group_summary` devuelve el conjunto que la RLS permite,
 * así que esto suma todos los grupos y no los de una página. Sumar una página
 * daría una deuda menor que la real sin fallar por ningún sitio.
 *
 * ═══════════ LA MONEDA, QUE ES LO ÚNICO DELICADO ═══════════
 *
 * Sólo entran los grupos cuya definición monetaria es la del ámbito personal.
 * Un grupo en otra divisa **con posición cero** se salta sin más —cero es cero
 * en cualquier moneda, y no hay conversión que inventar—. Uno con posición
 * distinta de cero hace que la cifra agregada **no se pueda afirmar**: sumarla
 * sería tratar dos definiciones como una, y convertirla exigiría un tipo de
 * cambio que no existe (`CURRENCY_CONVERSION_UNSUPPORTED` sigue siendo la
 * respuesta del escritor). Antes que una cifra falsa, ninguna.
 *
 * Y basta con que UNA posición sea no disponible para que el total lo sea: una
 * suma a la que le falta un sumando no es la suma.
 */
export function positionAcross(
  groups: readonly ProjectedGroup[],
  currencyDefinitionId: string,
): GroupPosition {
  let total = 0n;

  for (const group of groups) {
    if (group.position.kind === 'unavailable') return { kind: 'unavailable' };
    if (group.currencyDefinitionId === currencyDefinitionId) {
      total += group.position.minor;
      continue;
    }
    if (group.position.minor !== 0n) return { kind: 'unavailable' };
  }

  return { kind: 'net', minor: total };
}

/**
 * EL ORDEN: EL DE MÁS ACTIVIDAD RECIENTE ARRIBA, y con desempate estable.
 *
 * La referencia de cada grupo es el registro REAL de su último movimiento
 * —`lastActivityAt`, que el servidor deriva de `core.operation.created_at`—
 * y, si no tiene ninguno, su creación. Un gasto registrado hoy con fecha de
 * ayer sube su grupo: lo que cuenta es cuándo se registró, no la fecha
 * efectiva elegida. Y nada del aparato entra en el criterio: ni la lectura, ni
 * el refresco, ni la sincronización. Un reintento idempotente no crea
 * operación; editar un gasto, el nombre, el emoji o la categoría tampoco.
 *
 * La identidad es el desempate. Sin él, dos grupos con el mismo instante
 * cambiarían de sitio entre renders, porque `Array.sort` no promete
 * estabilidad para elementos que compara iguales.
 *
 * **Sin saltos por mezclar respuestas**: la clave sale del snapshot de
 * perfiles, que se sustituye entero en cada lectura, y nunca de la lectura de
 * posiciones, que llega aparte.
 */
export function activityOf(group: ProjectedGroup): string {
  return group.lastActivityAt ?? group.createdAt;
}

function newestFirst(a: ProjectedGroup, b: ProjectedGroup): number {
  const left = activityOf(a);
  const right = activityOf(b);
  if (left !== right) return left < right ? 1 : -1;
  return a.scopeId.localeCompare(b.scopeId);
}

export type GroupProjectionInput = {
  /** Lo que el servidor devolvió, o `null` si todavía no ha devuelto nada. */
  readonly snapshot: readonly RemoteGroup[] | null;
  /** El valor del contador durable **cuando arrancó** ese refresco (§9). */
  readonly snapshotSeq: number;
  /** Todas las entradas de ESTE actor, de cualquier comando. */
  readonly entries: readonly QueueEntry[];
  /**
   * Las posiciones leídas, o `null` si esa lectura no llegó.
   *
   * Va aparte del snapshot de perfiles a propósito: son dos vistas y pueden
   * fallar por separado. Que llegue la lista y no las posiciones da una lista
   * completa con posiciones no disponibles, que es la verdad; mezclarlas
   * obligaría a esconder los grupos o a inventarles un saldo.
   */
  readonly positions: readonly GroupPositionRow[] | null;
};

export function projectGroups({
  snapshot,
  snapshotSeq,
  entries,
  positions,
}: GroupProjectionInput): readonly ProjectedGroup[] {
  const byId = new Map<string, ProjectedGroup>();
  const byScope =
    positions === null ? null : new Map(positions.map((row) => [row.scopeId, row] as const));

  for (const row of snapshot ?? []) byId.set(row.scopeId, fromRemote(row, byScope));

  for (const entry of entries) {
    /*
     * Retirada: el servidor ya la tenía cuando la consulta arrancó, así que su
     * fila es la buena y ésta sobra. Sin snapshot NADA está retirado — no hay
     * con qué compararla, y `snapshotSeq` no dice nada por sí solo.
     */
    const retired =
      snapshot !== null && entry.confirmSeq !== null && entry.confirmSeq <= snapshotSeq;
    if (retired) continue;

    const local = localGroup(entry);
    // La creación local incierta prevalece sobre un snapshot que no la vio.
    if (local !== null) byId.set(local.scopeId, local);
  }

  return [...byId.values()].sort(newestFirst);
}
