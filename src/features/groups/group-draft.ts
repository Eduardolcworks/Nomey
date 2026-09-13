/**
 * EL BORRADOR DE UN GRUPO, Y SUS REGLAS. **Todo puro.**
 *
 * **Nada de esto persiste todavía.** `core.scope` no tiene ni nombre ni emoji
 * —su migración dice literalmente que «los atributos de Grupo y Modo Pareja
 * llegan en sus fases»— y no hay ninguna función escritora de grupos. Lo que
 * este módulo fija es el estado del formulario y cuándo es admisible, que es
 * exactamente lo que se puede decidir sin base de datos.
 *
 * **Y por eso los límites que hay son los que existen, no los que quedarían
 * bonitos.** El único contrato real sobre un nombre de participante es
 * `core.participant`: `display_name text not null` con
 * `check (display_name <> '')`. Es decir: **no vacío, y ninguna longitud
 * máxima**. Inventar aquí un `maxLength` sería inventar un contrato.
 *
 * Del nombre del GRUPO no hay contrato ninguno, ni siquiera el de no vacío, así
 * que la regla se toma prestada del único hecho parecido que sí está decidido
 * —un nombre en blanco no nombra nada— y se marca como decisión de interfaz.
 */

/**
 * El emoji con el que nace un grupo.
 *
 * Provisional y declarado como tal: es el valor inicial del formulario, no un
 * valor por defecto del modelo, que no existe.
 */
export const DEFAULT_GROUP_EMOJI = '👥';

/**
 * LA FORMA CANONICA DE UN NOMBRE VISIBLE.
 *
 * Tres pasos, en este orden:
 *
 * - **NFC primero**, para que `Jose` + acento combinante y `José` sean la misma
 *   cadena antes de medir nada;
 * - **colapsa** cualquier racha de espacios a uno solo. `s` en JavaScript cubre
 *   el tabulador, los saltos, el NBSP y los separadores Unicode, que a simple
 *   vista son indistinguibles de un espacio normal y entran al pegar desde otra
 *   aplicación;
 * - **recorta** los extremos.
 *
 * No toca mayúsculas ni acentos: eso cambiaría el nombre que la persona
 * escribió, y lo que se guarda es lo que escribió.
 *
 * **El servidor hace exactamente esto por su cuenta** —`sec.canonical_display_
 * name`— y no confía en que esto haya ocurrido. Que las dos formas coincidan
 * importa porque el valor canónico entra en la intención del comando: si
 * divergieran, un reintento legítimo se leería como clave reutilizada. La
 * paridad se garantiza con los vectores compartidos de
 * `tests/vectors/display-names.json`, no compartiendo código.
 */
export function normaliseName(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
}
/**
 * LA CLAVE CON LA QUE DOS NOMBRES SON EL MISMO.
 *
 * Tres pasos, y cada uno resuelve una forma distinta de parecer distinto:
 *
 * - **espacios** — `«  Ana  »` y `«Ana»` son la misma persona;
 * - **NFC** — `«José»` escrito con `é` y escrito con `e` + acento combinante
 *   son la MISMA cadena para quien lee y dos cadenas distintas para `===`;
 * - **minúsculas de locale** — `«ana»` y `«ANA»`. `toLocaleLowerCase` y no
 *   `toLowerCase` porque la `İ` turca no baja a `i` con la regla por defecto.
 *
 * **No quita acentos.** «María» y «Maria» son nombres distintos, y tratarlos
 * como duplicados impediría escribir uno de los dos.
 */
export function nameKey(raw: string): string {
  return normaliseName(raw).normalize('NFC').toLocaleLowerCase();
}

/** Una fila de la lista de participantes del formulario. */
export type ParticipantRow = {
  /** Estable mientras vive la fila: es lo que la identifica al reordenar o borrar. */
  readonly id: string;
  readonly name: string;
  /**
   * La fila del creador, que está vinculada a su cuenta y no se puede quitar.
   *
   * **No es un rol.** `core.membership` no tiene columna de rol y su migración
   * dice expresamente que ningún ADR fija roles dentro de un ámbito. Aquí
   * significa sólo «esta fila es la de quien está creando el grupo».
   */
  readonly owner: boolean;
  /**
   * UNA FILA QUE YA EXISTE EN EL SERVIDOR, en el editor de un grupo creado.
   *
   * Se enseña, no se edita y no se reenvía: conserva su identidad y su
   * presencia tal cual están. Sólo las filas sin esta marca son ALTAS. No es
   * `owner` —que dice «la de quien crea»— y no es un rol.
   */
  readonly fixed?: boolean;
  /** Salió del grupo (F09/ADR-003): se dice con texto en la fila fija. */
  readonly inactive?: boolean;
};

/** Por qué una fila no vale. `null` cuando vale. */
export type ParticipantIssue = 'blank' | 'duplicate';

/**
 * Qué le pasa a cada fila, en el mismo orden que las filas.
 *
 * **El duplicado se le marca al SEGUNDO**, no a los dos: quien repite un nombre
 * está escribiendo el de abajo, y encender también el de arriba señalaría como
 * erróneo algo que la persona no está tocando.
 */
export function participantIssues(
  rows: readonly ParticipantRow[],
): readonly (ParticipantIssue | null)[] {
  const seen = new Set<string>();

  return rows.map((row) => {
    const key = nameKey(row.name);
    if (key === '') return 'blank';
    if (seen.has(key)) return 'duplicate';
    seen.add(key);
    return null;
  });
}

/**
 * SIEMPRE UN OBLONGO VACÍO AL FINAL, Y EXACTAMENTE UNO.
 *
 * No hay botón de «añadir»: la fila siguiente ya está ahí, vacía, y escribir en
 * ella hace aparecer la de después. Esta función es toda la regla.
 *
 * **Conserva el PRIMER hueco y descarta los de detrás.** Es lo que evita que
 * vaciar la última fila con nombre le quite el campo debajo del dedo: la fila
 * que se está editando sobrevive con su identidad, y la que se va es la de
 * abajo. Si se descartara el primero, el foco saltaría a un campo distinto a
 * mitad de una pulsación.
 *
 * **Los huecos de EN MEDIO no se tocan.** Una fila con nombre que se vacía
 * queda marcada con su error y sigue donde está; borrarla sola sería decidir
 * por quien está escribiendo. Sólo se colapsa la cola.
 *
 * `nextId` genera identidades locales estables. **Nunca el índice**: al quitar
 * una fila de en medio, los índices se desplazan y React reutilizaría el estado
 * —texto, error y foco— de una fila en otra.
 */
export function withTrailingBlank(
  rows: readonly ParticipantRow[],
  nextId: () => string,
): readonly ParticipantRow[] {
  let ultimoConNombre = -1;
  for (const [i, row] of rows.entries()) {
    if (normaliseName(row.name) !== '') ultimoConNombre = i;
  }

  const conNombre = rows.slice(0, ultimoConNombre + 1);
  const cola = rows.slice(ultimoConNombre + 1);

  const hueco = cola[0] ?? { id: nextId(), name: '', owner: false };
  return [...conNombre, hueco];
}

/**
 * Si esta fila es el hueco final: la que todavía no es un participante.
 *
 * **No es «está vacía»**: una fila de en medio vacía sí es un participante a
 * medio escribir, con su error. Ésta es la última y no lleva ni error ni
 * control de quitar, y para un lector de pantalla no se anuncia como si ya
 * hubiera alguien.
 */
export function isTrailingBlank(rows: readonly ParticipantRow[], index: number): boolean {
  return index === rows.length - 1 && normaliseName(rows[index]?.name ?? '') === '';
}
/**
 * EL ESTADO COMPLETO DEL FORMULARIO, tal y como se envía a validar.
 *
 * `currency` es `null` mientras la divisa del Modo Personal no se conozca. No
 * es un hueco que rellenar con `EUR`: es la diferencia entre «todavía no se
 * sabe» y «se sabe y es ésta», y confundirlas es lo que pinta una moneda
 * inventada sin que nada falle.
 */
export type GroupDraft = {
  readonly emoji: string;
  readonly name: string;
  readonly currencyId: string | null;
  readonly participants: readonly ParticipantRow[];
  /**
   * LA CATEGORÍA PREESTABLECIDA, o `null` («Todas»).
   *
   * «Todas» significa SIN categoría preseleccionada para los gastos nuevos: no
   * es una categoría contable ni asigna un gasto a varias. Es una preferencia
   * del perfil, y el gasto guarda después la suya.
   */
  readonly defaultCategoryId: string | null;
};

/** Por qué un borrador todavía no se puede crear. Vacío = se puede. */
export type DraftIssue =
  /** Sin nombre, o sólo espacios. Regla de interfaz: no hay contrato de esquema. */
  | 'name'
  /** La divisa aún no se conoce, o no se ha elegido ninguna. */
  | 'currency'
  /** Alguna fila de participantes está en blanco o repetida. */
  | 'participants';

export function draftIssues(draft: GroupDraft): readonly DraftIssue[] {
  const issues: DraftIssue[] = [];

  if (normaliseName(draft.name) === '') issues.push('name');
  if (draft.currencyId === null) issues.push('currency');
  /*
   * **El hueco final no cuenta.** Siempre hay uno vacío al final —es el que
   * invita a escribir el siguiente nombre— y tomarlo por una fila incompleta
   * dejaría el borrador eternamente inválido.
   */
  const problemas = participantIssues(draft.participants);
  if (
    problemas.some((issue, index) => issue !== null && !isTrailingBlank(draft.participants, index))
  ) {
    issues.push('participants');
  }

  return issues;
}

/**
 * Si el borrador está completo.
 *
 * **No crea nada, y en este bloque nada lo va a crear.** Es lo que decide si la
 * acción de abajo se ve disponible: mostrar la composición prevista sin fingir
 * que hay persistencia detrás.
 */
export function isDraftComplete(draft: GroupDraft): boolean {
  return draftIssues(draft).length === 0;
}

/**
 * QUÉ ENSEÑA EL SELECTOR DE CATEGORÍA PREESTABLECIDA, y por qué son cuatro.
 *
 * - `all`: `null`, «Todas» — sin preselección. Es un valor, no una ausencia.
 * - `loading`: hay una guardada y el catálogo AÚN no ha llegado (vacío: siempre
 *   hay categorías de sistema). Se conserva su identidad y se dice que carga;
 *   no se la declara inutilizable ni se convierte en «Todas».
 * - `unavailable`: el catálogo llegó y no la contiene. Se conserva la
 *   identidad, se enseña el estado, y guardar espera a que se elija otra.
 * - `chosen`: la fila real, con su nombre e icono del catálogo.
 *
 * Pura, para poder afirmar las cuatro sin renderer.
 */
export type PresetDisplay =
  | { readonly kind: 'all' }
  | { readonly kind: 'loading'; readonly id: string }
  | { readonly kind: 'unavailable'; readonly id: string }
  | { readonly kind: 'chosen'; readonly id: string };

export function presetDisplay(
  defaultCategoryId: string | null,
  usableIds: readonly string[],
): PresetDisplay {
  if (defaultCategoryId === null) return { kind: 'all' };
  if (usableIds.length === 0) return { kind: 'loading', id: defaultCategoryId };
  if (!usableIds.includes(defaultCategoryId)) return { kind: 'unavailable', id: defaultCategoryId };
  return { kind: 'chosen', id: defaultCategoryId };
}

/**
 * SI HAY QUE ADOPTAR AHORA LA PREFERENCIA QUE LLEGA DEL PERFIL.
 *
 * Sólo cuando el perfil CAMBIA respecto al último recibido, y sólo si la
 * persona no ha tocado el selector: una elección manual manda sobre un perfil
 * que llegue después. Pura, por lo mismo.
 */
export function presetToAdopt(args: {
  readonly incoming: string | null;
  readonly lastIncoming: string | null;
  readonly touched: boolean;
}): { readonly adopt: boolean; readonly value: string | null } {
  if (args.incoming === args.lastIncoming) return { adopt: false, value: args.incoming };
  return { adopt: !args.touched, value: args.incoming };
}

/**
 * EL NOMBRE QUE SE MOSTRARÍA AL CREADOR, o la ausencia de uno.
 *
 * **Nunca el correo.** `identity.displayName` es `user_metadata`, que puede no
 * estar; cuando no está, la respuesta es «no se sabe» y quien pinta decide qué
 * decir. Sustituirlo en silencio por el correo mostraría una dirección de
 * correo como nombre de participante dentro de un grupo compartido, que es
 * precisamente el dato que F03/ADR-009 §1 no quiere correlacionable.
 */
export function ownerName(displayName: string | null): string | null {
  if (displayName === null) return null;
  const clean = normaliseName(displayName);
  return clean === '' ? null : clean;
}
