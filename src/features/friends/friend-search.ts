import type { Friend } from './friend';

/**
 * BUSCAR ENTRE LOS AMIGOS QUE YA ESTÁN CARGADOS. En local, y nada más.
 *
 * Esto **no** es el buscador de `/friends/add`. Aquél resuelve un
 * `@username` exacto contra el servidor, gasta una de las veinte consultas
 * que el resolver permite cada diez minutos y puede encontrar a cualquiera.
 * Esto sólo acota una lista que ya se tiene: cero llamadas, cero RPC por
 * tecla, y nunca `lookup_friend_candidate` ni `resolve_username`.
 *
 * La regla es deliberadamente tonta —subcadena sobre el nombre y sobre el
 * handle, sin acentos que normalizar, sin fuzzy y sin ranking—, porque una
 * lista de amigos es corta y lo que se busca es teclear tres letras y verlo.
 * Un orden «inteligente» aquí sería una jerarquía que nadie ha pedido.
 */

/**
 * ALGUIEN A QUIEN SE PUEDE DIRIGIR ALGO **HOY**.
 *
 * El handle es obligatorio, y por eso este tipo existe en vez de pasear un
 * `Friend` suelto: la identidad pública actual de una cuenta puede no tener
 * handle definitivo en un momento dado (`sec.public_identity` lo publica
 * como nulo), y sin handle no hay forma de nombrar a esa persona en un
 * comando — `api.create_transfer_proposal` toma un handle, nunca un uid.
 *
 * `publicName` no puede faltar en la práctica: `core.account_identity.public_name`
 * es `not null` y toda amistad es entre dos cuentas normales. El respaldo al
 * handle está para que el tipo no mienta, no porque se espere verlo.
 */
export type FriendChoice = {
  readonly friendshipId: string;
  readonly handle: string;
  readonly publicName: string;
};

/** `trim` + minúsculas. Lo único que se normaliza. */
export function normalizeFriendQuery(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Los amigos a los que se puede dirigir algo ahora mismo, en el orden en que
 * se leen: `publicName` alfabético y, si empatan, `@handle`.
 *
 * Quien no tenga handle definitivo **no aparece**. Enseñarlo sólo podría
 * acabar en una fila que no se puede pulsar, o peor, en una propuesta sin
 * destinatario que nombrar.
 *
 * La comparación es insensible a la locale a propósito: tiene que dar el
 * mismo orden en todos los aparatos, y el catálogo no fija ninguna
 * intercalación.
 */
export function friendChoices(friends: readonly Friend[]): readonly FriendChoice[] {
  return friends
    .filter((one): one is Friend & { counterpartHandle: string } => one.counterpartHandle !== null)
    .map((one) => ({
      friendshipId: one.friendshipId,
      handle: one.counterpartHandle,
      publicName: one.counterpartPublicName ?? one.counterpartHandle,
    }))
    .sort((a, b) => {
      const left = a.publicName.toLowerCase();
      const right = b.publicName.toLowerCase();
      if (left !== right) return left < right ? -1 : 1;
      return a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0;
    });
}

/**
 * ¿Coincide este amigo con lo que se ha escrito?
 *
 * Sin texto, todos. Con texto, subcadena sobre el nombre o sobre el handle,
 * en minúsculas. Y si la consulta empieza por `@` se compara **también** sin
 * él, que es lo que hace que `aitor13` y `@aitor13` encuentren lo mismo:
 * nadie tiene que acordarse de cuál quiere Nomey.
 */
export function matchesFriendQuery(choice: FriendChoice, query: string): boolean {
  const normalized = normalizeFriendQuery(query);
  if (normalized === '') return true;
  const bare = normalized.startsWith('@') ? normalized.slice(1) : normalized;
  const name = choice.publicName.toLowerCase();
  const handle = choice.handle.toLowerCase();
  return (
    name.includes(normalized) ||
    name.includes(bare) ||
    handle.includes(normalized) ||
    handle.includes(bare)
  );
}

/** La lista ya ordenada, acotada por lo escrito. El orden no cambia al filtrar. */
export function filterFriendChoices(
  choices: readonly FriendChoice[],
  query: string,
): readonly FriendChoice[] {
  return choices.filter((one) => matchesFriendQuery(one, query));
}
