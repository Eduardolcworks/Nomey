import { describe, expect, it } from 'vitest';

import SCREEN from '../../src/app/group/[id].tsx?raw';
import ROW from '../../src/features/groups/group-balance-row.tsx?raw';
import GROUPS_INDEX from '../../src/features/groups/index.ts?raw';
import ACTIONS from '../../src/features/friends/group-friend-actions.ts?raw';
import MODEL from '../../src/features/friends/group-friend.ts?raw';
import SERVICE from '../../src/features/friends/friend-service.ts?raw';
import STATUS_HOOK from '../../src/features/friends/use-group-friend-status.ts?raw';
import ADD_HOOK from '../../src/features/friends/use-add-participant-friend.ts?raw';
import PARTICIPANT_VIEW from '../../src/features/groups/use-group-participants.ts?raw';
import TYPES from '../../src/types/database.ts?raw';
import ES from '../../src/lib/i18n/messages/es-ES.ts?raw';
import EN from '../../src/lib/i18n/messages/en.ts?raw';
import MIGRATION from '../../supabase/migrations/20261004120000_friends_from_group_participants.sql?raw';
import CHECK from '../../supabase/checks/group-friends.sql?raw';
import RACE from '../../scripts/group-friend-race-evidence.sh?raw';
import CI from '../../.github/workflows/ci.yml?raw';
import { friendMenuEntries } from '../../src/features/friends/group-friend-actions';
import { GROUP_FRIEND_STATES } from '../../src/features/friends/group-friend';
import { hasFriendAction, parseGroupFriendRow } from '../../src/features/friends/group-friend';

/**
 * F12.E.D — AMISTAD DESDE UN PARTICIPANTE DE GRUPO.
 *
 * Lo que se fija aquí es, por orden de importancia:
 *
 *   1 · que el cliente NO conozca ni pida la identidad global de nadie;
 *   2 · qué se ofrece en cada estado, y qué NO se ofrece;
 *   3 · que lo que ya había en esa fila —Asociar, Retirar— siga entero;
 *   4 · que las escrituras pasen por las señales de siempre.
 *
 * Sin renderer: se lee el fuente y se afirma sobre su estructura, como el
 * resto de los tests de superficie del repositorio. Las dos funciones puras
 * sí se ejecutan.
 */

/**
 * LO QUE SE AFIRMA ES EL CODIGO, no la prosa. Estos ficheros explican en sus
 * comentarios exactamente lo que NO hacen —«sin realtime», «sin publicar el
 * @handle de nadie»— y una busqueda literal encontraria la explicacion en vez
 * del defecto. Se quitan los comentarios antes de mirar.
 */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('1 · el cliente nunca traduce un participante a una cuenta', () => {
  /*
   * EL PIN DE PRIVACIDAD DEL LADO DEL CLIENTE. El del servidor está en
   * supabase/checks/group-friends.sql §B; éste impide que, por comodidad,
   * algún día el cliente empiece a pedir o a guardar el @handle de alguien
   * del grupo para poder pedirle amistad.
   */
  it('lo que se manda es el participant_id, y lo que vuelve es una palabra', () => {
    expect(SERVICE).toContain("supabase.rpc('create_friend_request_to_participant'");
    expect(SERVICE).toContain('participant_id: string;');
    // Por esta puerta NO viaja un handle.
    const call = code(SERVICE).slice(code(SERVICE).indexOf('CreateToParticipantPayload'));
    expect(call).not.toMatch(/handle/);
  });

  it('el modelo del estado social no tiene uid, correo, handle ni nombre público', () => {
    expect(code(MODEL)).not.toMatch(/uid|user_id|userId|email|handle|publicName|public_name/);
    // Sólo tres cosas: de quién, qué estado y —si hay— qué solicitud.
    expect(MODEL).toContain('readonly participantId: string;');
    expect(MODEL).toContain('readonly state: GroupFriendState;');
    expect(MODEL).toContain('readonly requestId: string | null;');
  });

  it('api.group_friend_status devuelve tres columnas y ninguna es identidad', () => {
    const fn = TYPES.slice(TYPES.indexOf('group_friend_status:'));
    expect(fn.slice(0, 400)).toContain('participant_id: string');
    expect(fn.slice(0, 400)).toContain('state: string');
    expect(fn.slice(0, 400)).toContain('request_id: string');
    expect(fn.slice(0, 400)).not.toMatch(/handle|email|user_id|public_name/);
  });

  /**
   * Y la fila del grupo NO gana ni una columna. El nombre que se enseña sigue
   * siendo `display_name`, que es del participante y ya lo publicaba el grupo
   * desde F9 (F03/ADR-009 §1: qué cuenta global hay detrás de una identidad
   * contextual no se publica nunca).
   */
  it('api.group_participant no publica identidad de cuenta nueva', () => {
    const view = TYPES.slice(TYPES.indexOf('group_participant: {'), TYPES.indexOf('group_payment'));
    expect(view).not.toMatch(/\bhandle\b|\bemail\b|\buser_id\b|\bpublic_name\b|\buid\b/);
    expect(view).toContain('display_name');
    // Y el hook que la lee tampoco pide nada nuevo.
    expect(PARTICIPANT_VIEW).not.toMatch(/handle|email|public_name/);
  });
});

describe('2 · qué se ofrece en cada estado', () => {
  it('sin relación: «Añadir amigo», y nada más', () => {
    const entries = friendMenuEntries('none');
    expect(entries.map((e) => e.id)).toEqual(['friend-add']);
    expect(entries[0].labelKey).toBe('friends.add');
  });

  it('solicitud mía pendiente: «Solicitud enviada» y «Cancelar solicitud»', () => {
    const entries = friendMenuEntries('outgoing_pending');
    expect(entries.map((e) => e.id)).toEqual(['friend-state', 'friend-cancel']);
    expect(entries[0].labelKey).toBe('friends.requestSent');
    expect(entries[1].labelKey).toBe('friends.cancelRequest');
    expect(entries[1].destructive).toBe(true);
  });

  it('solicitud suya pendiente: «Aceptar solicitud» y «Rechazar»', () => {
    const entries = friendMenuEntries('incoming_pending');
    expect(entries.map((e) => e.id)).toEqual(['friend-accept', 'friend-decline']);
    expect(entries[0].labelKey).toBe('friends.acceptRequest');
    expect(entries[1].labelKey).toBe('friends.decline');
    expect(entries[1].destructive).toBe(true);
  });

  it('ya amigos: «Amigos», y NINGUNA acción más', () => {
    const entries = friendMenuEntries('friends');
    expect(entries.map((e) => e.id)).toEqual(['friend-state']);
    expect(entries[0].labelKey).toBe('friends.title');
    /*
     * «Eliminar amigo» NO está aquí. Deshacer una amistad se hace en
     * Perfil → Amigos, donde están todas y donde la confirmación tiene
     * sitio; en este menú quedaría a un toque de «Aceptar», su opuesto.
     */
    expect(code(ACTIONS)).not.toContain('friends.remove');
    expect(code(ACTIONS)).not.toContain('removeFriend');
  });

  /**
   * NI UNA ACCIÓN DESHABILITADA. Una fila en gris que dijera «Añadir amigo»
   * contaría algo de esa persona —que no tiene cuenta, que es un invitado,
   * que no tiene username— cada vez que alguien abriera el menú.
   */
  it('uno mismo, el fantasma, el invitado y el no apto: NADA', () => {
    expect(friendMenuEntries('self')).toEqual([]);
    expect(friendMenuEntries('unavailable')).toEqual([]);
    expect(hasFriendAction('self')).toBe(false);
    expect(hasFriendAction('unavailable')).toBe(false);
    expect(hasFriendAction('none')).toBe(true);
    expect(hasFriendAction('friends')).toBe(true);
    // Y no existe un «disabled» que reintroducirlo sea fácil.
    expect(code(ACTIONS)).not.toMatch(/disabled/);
  });

  it('el defecto mientras no se sabe es «sin acción», nunca una acción que el servidor rehusaría', () => {
    expect(STATUS_HOOK).toContain("?.state ?? 'unavailable'");
    // Un estado que este cliente no entiende se descarta en vez de pintarse.
    expect(parseGroupFriendRow({ participant_id: 'p1', state: 'sarasa' })).toBeNull();
    expect(parseGroupFriendRow({ participant_id: 'p1', state: 'none' })).toEqual({
      participantId: 'p1',
      state: 'none',
      requestId: null,
    });
    expect(parseGroupFriendRow({ state: 'none' })).toBeNull();
  });
});

describe('3 · lo que ya había en esa fila sigue entero', () => {
  it('Asociar y Retirar conservan su condición, su palabra y su confirmación', () => {
    expect(SCREEN).toContain("id: 'associate',");
    expect(SCREEN).toContain("id: 'retire',");
    expect(SCREEN).toContain('linkedOf.get(balance.participantId) === false &&');
    expect(SCREEN).toMatch(/=== false &&\s*!inactive &&/);
    expect(SCREEN).toContain("? 'group.retireParticipant'");
    expect(SCREEN).toContain(": 'group.removeParticipant'");
    expect(SCREEN).toContain('askAssociate(balance.participantId, balance.displayName);');
    expect(SCREEN).toContain('askRetire(');
  });

  /**
   * LOS DOS CONJUNTOS SON DISJUNTOS POR CONSTRUCCIÓN: el ciclo de vida exige
   * `is_linked === false` y lo social sólo aparece sobre alguien CON cuenta.
   * Por eso concatenarlos no puede mezclar un «Retirar» con un «Añadir
   * amigo» en el mismo menú.
   */
  it('el menú es la unión de dos conjuntos disjuntos, y vacío es sin menú', () => {
    expect(SCREEN).toContain('const all = [...lifecycle, ...socialEntries];');
    expect(SCREEN).toContain('return all.length > 0 ? all : undefined;');
    expect(SCREEN).toContain('friendMenuEntries(');
    expect(SCREEN).toContain('icon: Symbols[entry.iconKey],');
    // La fila sigue recibiendo el mismo contrato que ya sabía tomar.
    expect(ROW).toContain('readonly menu?: readonly LongPressMenuAction[];');
    expect(ROW).toContain('readonly onMenuSelect?: (id: string) => void;');
  });

  /**
   * LA FRONTERA DE DEPENDENCIAS. `features/groups` y `features/friends` no
   * se conocen —feature → feature está prohibido y lo comprueba ESLint sobre
   * la ruta RESUELTA— y quien los junta es la pantalla, que está en `app/`.
   */
  it('grupos no importa amigos ni al revés: los junta la pantalla', () => {
    expect(GROUPS_INDEX).not.toContain('features/friends');
    expect(code(ROW)).not.toMatch(/friends|friend/i);
    expect(SCREEN).toContain("} from '@/features/friends';");
    expect(SCREEN).toContain("} from '@/features/groups';");
  });
});

describe('4 · escribir, y lo que se cuenta al hacerlo', () => {
  it('una clave por participante, guardada sólo mientras el servidor calla', () => {
    expect(ADD_HOOK).toContain('keys.current.get(participantId)');
    expect(ADD_HOOK).toContain('key = newClientOperationId();');
    expect(ADD_HOOK).toContain("if (reason !== 'offline') keys.current.delete(participantId);");
    expect(ADD_HOOK).toContain('command_contract_version: 1,');
  });

  it('las cuatro acciones publican friendsChanged, y offline no publica nada', () => {
    expect(ADD_HOOK).toContain('publishFriendsChanged();');
    // El publicado va DESPUÉS del ok del servidor, nunca antes.
    const add = ADD_HOOK.slice(ADD_HOOK.indexOf('if (result.ok)'));
    expect(add.indexOf('publishFriendsChanged();')).toBeGreaterThan(-1);
    expect(add.indexOf('publishFriendsChanged();')).toBeLessThan(add.indexOf('const reason'));
    // Aceptar, rechazar y cancelar son las de E.B, sin una segunda versión.
    expect(SCREEN).toContain('friendActions.accept(requestId)');
    expect(SCREEN).toContain('friendActions.decline(requestId)');
    expect(SCREEN).toContain('friendActions.cancel(requestId)');
    expect(SCREEN).not.toContain('sendCreateFriendRequest(');
  });

  it('el mapa se relee con las MISMAS tres señales del resto de Amigos', () => {
    expect(STATUS_HOOK).toContain('subscribeFriendsChanged(');
    expect(STATUS_HOOK).toContain('onFriendsWake(');
    expect(code(STATUS_HOOK)).not.toMatch(/setInterval|setTimeout|realtime|channel\(/);
  });

  it('un invitado no pregunta: la misma condición que la campana', () => {
    expect(SCREEN).toContain('const social = useGroupFriendStatus(');
    expect(SCREEN).toMatch(
      /useGroupFriendStatus\(\s*id \?\? '',\s*session\.status === 'signed-in' && !session\.identity\.isAnonymous,/,
    );
  });

  it('sólo el cooldown se cuenta con una frase; el resto se ve en el menú', () => {
    expect(SCREEN).toContain("if (outcome.answer.state === 'cooldown')");
    expect(SCREEN).toContain("t('friends.cooldown')");
    expect(SCREEN).toContain("t('friends.actionFailedTitle')");
    expect(SCREEN).toContain('FRIEND_FAILURE_KEY[');
  });

  it('el doble toque se impide en el MANEJADOR, no vaciando el menú', () => {
    expect(SCREEN).toContain('if (adding.busy !== null || friendActions.busy !== null) return;');
  });
});

/**
 * LA IDENTIDAD DE LA FILA NO SE MUEVE MIENTRAS CAMBIA EL ESTADO SOCIAL.
 *
 * El defecto que esto fija, medido: mientras un comando estaba en vuelo la
 * pantalla vaciaba las entradas sociales, y para un participante CON cuenta
 * las de ciclo de vida están vacías por definición — así que el menú entero
 * quedaba en `undefined`. `GroupBalanceRow` decide con eso si envuelve la
 * identidad en `ActionMenu` o la pinta suelta, y cambiar de envoltorio cambia
 * el TIPO del padre: React desmonta el avatar y el nombre y los vuelve a
 * montar dentro de otra caja. Eso era el parpadeo.
 *
 * No era press feedback, ni un cambio de `key`, ni una sustitución del
 * contenido por un estado de carga: era un REMONTAJE, y se veía como un
 * salto porque la caja que envuelve la identidad también cambiaba.
 */
describe('6 · la identidad de la fila es estable durante la mutación', () => {
  it('la key es la identidad del participante, y el estado social no entra en ella', () => {
    expect(SCREEN).toContain('key={balance.participantId}');
    const key = SCREEN.slice(
      SCREEN.indexOf('key={balance.participantId}'),
      SCREEN.indexOf('key={balance.participantId}') + 60,
    );
    expect(key).not.toMatch(/social|friend|pending|busy|state/i);
  });

  /**
   * EL PIN QUE IMPIDE QUE VUELVA. Mientras cada estado accionable devuelva
   * al menos una entrada Y la pantalla no las vacíe en vuelo, `hasMenu` no
   * puede cambiar por una transición social: `self` y `unavailable` son los
   * únicos vacíos, y de ésos no se sale pulsando nada.
   */
  it('ninguna transición social puede dejar el menú vacío', () => {
    for (const state of GROUP_FRIEND_STATES) {
      const entries = friendMenuEntries(state);
      if (state === 'self' || state === 'unavailable') {
        expect(entries, state).toHaveLength(0);
      } else {
        expect(entries.length, state).toBeGreaterThan(0);
      }
    }
    // Y la pantalla ya no las vacía por tener algo en vuelo.
    expect(code(SCREEN)).not.toContain('const settling =');
    expect(code(SCREEN)).not.toMatch(/socialEntries\s*=\s*settling/);
    expect(code(SCREEN)).toContain('const socialEntries = friendMenuEntries(');
  });

  it('el estado de carga social no sustituye ni el avatar ni el nombre', () => {
    // La pantalla no lee `loading` ni `failed` del mapa: no hay nada que
    // sustituir mientras se espera.
    expect(code(SCREEN)).not.toMatch(/social\.loading|social\.failed/);
    // Y el hook conserva lo anterior mientras relee: no vacía su estado.
    expect(STATUS_HOOK).not.toMatch(/setHeld\(null\)/);
  });

  /**
   * UNA SOLA IDENTIDAD EN LA FILA: el mismo elemento en las dos ramas, no
   * dos variantes de JSX. Una segunda copia para «pendiente» sería otro
   * remontaje con otro nombre.
   */
  it('la fila construye avatar y nombre UNA vez, y no tiene variante para pendiente', () => {
    expect(ROW.split('const identity = (').length - 1).toBe(1);
    expect(ROW.split('styles.badge').length - 1).toBe(1);
    expect(ROW).toContain('<ActionMenu actions={menu} onSelect={onMenuSelect}>');
    expect(ROW).toContain('{identity}');
    // Nada de la amistad llega hasta aquí: la fila no sabe que existe.
    expect(code(ROW)).not.toMatch(/pending|busy|loading/i);
  });

  /**
   * NI OPACIDAD NI ESCALA NI TRANSFORMACIÓN sobre la identidad. El feedback
   * táctil de abrir el menú es del primitivo nativo; esta fila no añade uno
   * propio que pudiera confundirse con un salto al terminar la acción.
   */
  it('la fila no aplica opacity, scale ni transform a la identidad', () => {
    expect(code(ROW)).not.toMatch(/opacity|scale|transform|translate/i);
    expect(code(ROW)).not.toContain('Animated');
  });

  it('y el aviso queda escrito donde se rompería otra vez', () => {
    expect(ROW).toContain('no puede vaciar `menu` de forma');
  });
});

describe('5 · las frases, y la evidencia', () => {
  it('las seis frases existen en ES y EN, y cinco son de E.B sin duplicar', () => {
    for (const key of [
      'friends.add',
      'friends.requestSent',
      'friends.cancelRequest',
      'friends.acceptRequest',
      'friends.decline',
      'friends.title',
      'friends.cooldown',
    ]) {
      expect(ES, key).toContain(`'${key}':`);
      expect(EN, key).toContain(`'${key}':`);
    }
    // La única nueva es el sustantivo del menú; el resto ya estaban.
    expect(ES).toContain("'friends.acceptRequest': 'Aceptar solicitud',");
    expect(EN).toContain("'friends.acceptRequest': 'Accept request',");
    // Ningún código técnico llega a la pantalla.
    for (const cat of [ES, EN]) expect(cat).not.toMatch(/FRIEND_REQUEST_[A-Z_]+/);
  });

  /**
   * NI UNA SEGUNDA SEMÁNTICA DE SOLICITUDES: las dos puertas —por @handle y
   * por participante— terminan en el mismo núcleo, y eso se comprueba sobre
   * el cuerpo VIVO de las funciones en el check §C.
   */
  it('la migración comparte núcleo en vez de copiarlo', () => {
    expect(MIGRATION).toContain('create function sec.create_friend_request_core(');
    expect(MIGRATION).toContain('sec.create_friend_request_core(v_actor, v_target, v_command,');
    expect(MIGRATION).toContain("'username');");
    expect(MIGRATION).toContain("'group');");
    expect(MIGRATION).toContain('create function sec.friend_request_replay(');
    // El resolutor participante → cuenta es del writer y no lo alcanza el cliente.
    expect(MIGRATION).toContain(
      'alter function sec.participant_account(uuid) owner to nomey_writer;',
    );
    expect(MIGRATION).toContain(
      'grant execute on function sec.participant_account(uuid) to nomey_provisioner;',
    );
    expect(MIGRATION).not.toMatch(
      /grant execute on function sec\.participant_account\(uuid\) to authenticated/,
    );
    // Y api.group_participant no se recrea aquí: no cambia.
    expect(MIGRATION).not.toContain('create or replace view api.group_participant');
  });

  it('el check y la carrera están escritos y registrados en CI', () => {
    expect(CHECK).toContain('api.group_friend_status(');
    expect(CHECK).toContain('api.create_friend_request_to_participant(');
    expect(CHECK).toContain('rollback;');
    expect(RACE).toContain('NO ES UNA MIGRACION');
    expect(CI).toContain('supabase/checks/group-friends.sql');
    expect(CI).toContain('scripts/group-friend-race-evidence.sh');
  });
});
