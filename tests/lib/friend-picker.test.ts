import { describe, expect, it } from 'vitest';

import type { Friend } from '../../src/features/friends/friend';
import {
  filterFriendChoices,
  type FriendChoice,
  friendChoices,
  matchesFriendQuery,
  normalizeFriendQuery,
} from '../../src/features/friends/friend-search';
import {
  FRIEND_ROW_HEIGHT,
  friendListHeight,
  MAX_VISIBLE_FRIENDS,
  visibleFriendRows,
} from '../../src/features/friends/friend-picker-layout';
import { recipientFromChoice } from '../../src/features/transfers/recipient';

/**
 * LA BÚSQUEDA LOCAL DEL SELECTOR DE AMIGOS, sin React y sin servidor.
 *
 * Lo que se fija aquí es que este filtro **no es** el buscador de
 * `/friends/add`: no llama a nada, no gasta el freno del resolver y no
 * puede encontrar a quien no sea ya amigo. Acota una lista que ya está en
 * memoria, y lo hace de la manera más tonta que funcione — subcadena sobre
 * el nombre y sobre el handle—, porque cualquier cosa más lista sería un
 * orden que nadie pidió.
 */

function friend(friendshipId: string, publicName: string | null, handle: string | null): Friend {
  return {
    friendshipId,
    counterpartHandle: handle,
    counterpartPublicName: publicName,
    since: '2026-09-01T00:00:00Z',
  };
}

const AITOR = friend('f1', 'Aitor', 'aitor13');
const ANA = friend('f2', 'Ana', 'ana');
const EDU = friend('f3', 'Eduardo', 'edu13');

describe('a quién se puede elegir', () => {
  it('sólo a quien tiene handle definitivo: sin él no hay a quién nombrar', () => {
    const list = friendChoices([AITOR, friend('f9', 'Sin handle', null), ANA]);
    expect(list.map((one) => one.friendshipId)).toEqual(['f1', 'f2']);
  });

  it('el orden por defecto es el nombre, alfabético, y el handle desempata', () => {
    const list = friendChoices([EDU, AITOR, ANA]);
    expect(list.map((one) => one.publicName)).toEqual(['Aitor', 'Ana', 'Eduardo']);

    const tie = friendChoices([friend('f5', 'Ana', 'zzz'), friend('f6', 'Ana', 'aaa')]);
    expect(tie.map((one) => one.handle)).toEqual(['aaa', 'zzz']);
  });

  it('el orden no depende de mayúsculas ni de la locale del aparato', () => {
    const list = friendChoices([friend('f7', 'ana', 'a1'), friend('f8', 'Aitor', 'a2')]);
    expect(list.map((one) => one.publicName)).toEqual(['Aitor', 'ana']);
  });

  /**
   * `core.account_identity.public_name` es `not null` y toda amistad es
   * entre dos cuentas normales, así que esto no debería verse nunca. El
   * respaldo existe para que el tipo no mienta, no porque se espere.
   */
  it('sin nombre público, el handle hace de nombre y la fila sigue siendo elegible', () => {
    const list = friendChoices([friend('f4', null, 'solohandle')]);
    expect(list).toEqual([{ friendshipId: 'f4', handle: 'solohandle', publicName: 'solohandle' }]);
  });
});

describe('lo que se escribe en el buscador', () => {
  const CHOICES: readonly FriendChoice[] = friendChoices([AITOR, ANA, EDU]);
  const names = (query: string) => filterFriendChoices(CHOICES, query).map((one) => one.publicName);

  it('sin texto, están todos', () => {
    expect(names('')).toEqual(['Aitor', 'Ana', 'Eduardo']);
    expect(names('   ')).toEqual(['Aitor', 'Ana', 'Eduardo']);
  });

  it('el nombre completo', () => {
    expect(names('Aitor')).toEqual(['Aitor']);
  });

  it('un trozo del nombre', () => {
    expect(names('ait')).toEqual(['Aitor']);
    // Subcadena de verdad: «an» está en «Ana» y no en «Aitor» ni en «Eduardo».
    expect(names('an')).toEqual(['Ana']);
  });

  it('da igual cómo se escriba', () => {
    expect(names('AITOR')).toEqual(['Aitor']);
    expect(names('aItOr')).toEqual(['Aitor']);
    expect(names('  Ana  ')).toEqual(['Ana']);
  });

  it('el handle, con arroba y sin ella', () => {
    expect(names('aitor13')).toEqual(['Aitor']);
    expect(names('@aitor13')).toEqual(['Aitor']);
    expect(names('@edu')).toEqual(['Eduardo']);
    // Sólo la arroba: no es una consulta, así que no acota nada.
    expect(names('@')).toEqual(['Aitor', 'Ana', 'Eduardo']);
  });

  it('sin resultados es una lista vacía, no todos', () => {
    expect(names('zzz')).toEqual([]);
    expect(names('@nadie')).toEqual([]);
  });

  it('el orden se conserva al filtrar', () => {
    expect(names('a')).toEqual(['Aitor', 'Ana', 'Eduardo']);
  });

  it('no hay fuzzy: las letras sueltas no valen si no están seguidas', () => {
    expect(matchesFriendQuery(friendChoices([AITOR])[0], 'atr')).toBe(false);
    expect(matchesFriendQuery(friendChoices([AITOR])[0], 'ito')).toBe(true);
  });

  it('lo único que se normaliza es el espacio y la caja', () => {
    expect(normalizeFriendQuery('  AiTor ')).toBe('aitor');
    expect(normalizeFriendQuery('@Edu13')).toBe('@edu13');
  });
});

describe('un amigo elegido es un destinatario corriente', () => {
  /**
   * No hay una clase `friend` de destinatario. Lo que sale del selector es
   * EXACTAMENTE el mismo `found` que sale de la lupa, con el handle que
   * `api.my_friends` publica como actual — y ningún uid por detrás.
   */
  it('produce el mismo `found` que el resolver, sin un tipo nuevo', () => {
    expect(recipientFromChoice('aitor13', 'Aitor')).toEqual({
      kind: 'found',
      handle: 'aitor13',
      publicName: 'Aitor',
    });
  });

  it('lo que viaja es handle y nombre, y nada más', () => {
    const chosen = friendChoices([AITOR])[0];
    const recipient = recipientFromChoice(chosen.handle, chosen.publicName);
    expect(Object.keys(recipient).sort()).toEqual(['handle', 'kind', 'publicName']);
    expect(JSON.stringify(recipient)).not.toMatch(/uid|user_id|friendship/i);
  });
});

/**
 * EL ALTO DE LA LISTA. Aritmética, que es lo único de una hoja que se puede
 * comprobar sin renderizarla.
 *
 * Lo que se fija es que la hoja **crece con lo que hay** y se para en seis:
 * con un amigo no reserva seis filas de hueco, y con veinte no crece sin
 * fin. Que el número se aplique como `maxHeight` sobre la lista —y que la
 * cabecera quede fuera de lo que se desplaza— lo vigila
 * `tests/infra/transfer-friends-picker-surface.test.ts`.
 */
describe('cuánto mide la lista', () => {
  it('una fila por amigo, hasta seis', () => {
    expect(visibleFriendRows(1)).toBe(1);
    expect(visibleFriendRows(2)).toBe(2);
    expect(visibleFriendRows(3)).toBe(3);
    expect(visibleFriendRows(6)).toBe(6);
  });

  it('a partir de siete se queda en seis y el resto se desplaza', () => {
    expect(visibleFriendRows(7)).toBe(MAX_VISIBLE_FRIENDS);
    expect(visibleFriendRows(20)).toBe(MAX_VISIBLE_FRIENDS);
    expect(visibleFriendRows(500)).toBe(MAX_VISIBLE_FRIENDS);
  });

  it('el tope es seis, declarado y no repartido por el código', () => {
    expect(MAX_VISIBLE_FRIENDS).toBe(6);
  });

  it('el alto es las filas que se ven por lo que mide una fila', () => {
    expect(friendListHeight(1)).toBe(FRIEND_ROW_HEIGHT);
    expect(friendListHeight(3)).toBe(3 * FRIEND_ROW_HEIGHT);
    expect(friendListHeight(6)).toBe(6 * FRIEND_ROW_HEIGHT);
    // Siete y veinte miden lo mismo que seis: el resto se desplaza.
    expect(friendListHeight(7)).toBe(friendListHeight(6));
    expect(friendListHeight(20)).toBe(friendListHeight(6));
  });

  /** Sin filas no hay lista: ni un punto de caja vacía que dejar. */
  it('sin nada que enseñar, el alto es cero', () => {
    expect(visibleFriendRows(0)).toBe(0);
    expect(friendListHeight(0)).toBe(0);
    expect(visibleFriendRows(-1)).toBe(0);
  });

  /**
   * EL FILTRO ENCOGE LA HOJA. El alto se calcula sobre lo que queda tras
   * buscar, no sobre la lista entera: diez amigos abren a seis filas, y dos
   * coincidencias dejan una hoja de dos.
   */
  it('con diez amigos y dos coincidencias, la lista mide dos filas', () => {
    const ten = friendChoices(
      Array.from({ length: 10 }, (_, i) => friend(`f${i}`, `Persona ${i}`, `persona${i}`)),
    );
    expect(friendListHeight(ten.length)).toBe(6 * FRIEND_ROW_HEIGHT);

    const two = filterFriendChoices(ten, 'persona1');
    // «persona1» está en persona1 y en ninguno más de los diez (0..9).
    expect(two).toHaveLength(1);

    const pair = filterFriendChoices(ten, 'Persona 3').concat(
      filterFriendChoices(ten, 'Persona 4'),
    );
    expect(friendListHeight(pair.length)).toBe(2 * FRIEND_ROW_HEIGHT);
  });

  it('sin coincidencias no queda una caja de seis filas', () => {
    const ten = friendChoices(
      Array.from({ length: 10 }, (_, i) => friend(`f${i}`, `Persona ${i}`, `persona${i}`)),
    );
    expect(friendListHeight(filterFriendChoices(ten, 'zzz').length)).toBe(0);
  });
});
