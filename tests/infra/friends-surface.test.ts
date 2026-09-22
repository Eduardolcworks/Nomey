import { describe, expect, it } from 'vitest';

import ADD from '../../src/app/friends/add.tsx?raw';
import LIST from '../../src/app/friends/index.tsx?raw';
import LAYOUT from '../../src/app/_layout.tsx?raw';
import TABS from '../../src/app/(tabs)/_layout.tsx?raw';
import GROUP from '../../src/app/group/[id].tsx?raw';
import NOTIFICATIONS from '../../src/app/notifications.tsx?raw';
import PROFILE from '../../src/app/profile.tsx?raw';
import CANDIDATE from '../../src/features/friends/friend-candidate.ts?raw';
import EVENTS from '../../src/features/friends/friend-events.ts?raw';
import FRIEND from '../../src/features/friends/friend.ts?raw';
import SERVICE from '../../src/features/friends/friend-service.ts?raw';
import ACTIONS from '../../src/features/friends/use-friend-actions.ts?raw';
import CREATE from '../../src/features/friends/use-create-friend-request.ts?raw';
import LOOKUP from '../../src/features/friends/use-lookup-candidate.ts?raw';
import REQUESTS from '../../src/features/friends/use-my-friend-requests.ts?raw';
import FRIENDS from '../../src/features/friends/use-my-friends.ts?raw';
import MIGRATION from '../../supabase/migrations/20260930120000_friendships.sql?raw';

/**
 * AMIGOS, F12.E.B: la interfaz base contra el contrato REAL de E.A.
 *
 * Lo que este fichero fija es la frontera, no el aspecto: qué funciones se
 * llaman y con qué forma exacta de payload, qué se lee y de qué vista, quién
 * puede llegar a las pantallas, y —lo más fácil de romper sin que nada
 * falle— **que nada se dé por hecho sin que el servidor lo confirme**.
 *
 * Se lee el fuente en vez de renderizarlo, como el resto de `tests/infra`:
 * no hay renderer de React en el proyecto, y lo que importa aquí está en el
 * código. La lógica pura vive en `tests/lib/friends.test.ts`, y lo que sólo
 * la base puede demostrar, en `supabase/checks/friends.sql`.
 */

const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('el contrato de E.A, tal y como la migración lo dejó', () => {
  it('las seis funciones y las dos vistas existen con el nombre que el cliente usa', () => {
    for (const fn of [
      'create function api.lookup_friend_candidate(p_handle text)',
      'create function api.create_friend_request(payload jsonb)',
      'create function api.accept_friend_request(payload jsonb)',
      'create function api.decline_friend_request(payload jsonb)',
      'create function api.cancel_friend_request(payload jsonb)',
      'create function api.remove_friend(payload jsonb)',
    ]) {
      expect(MIGRATION, fn).toContain(fn);
    }
    expect(MIGRATION).toContain('create view api.my_friends');
    expect(MIGRATION).toContain('create view api.my_friend_requests');
  });

  it('y el cliente llama exactamente a ésas, con el payload que cada una admite', () => {
    expect(SERVICE).toContain(
      "supabase.rpc('lookup_friend_candidate', {\n    p_handle: handle,\n  })",
    );
    expect(SERVICE).toContain("supabase.rpc('create_friend_request'");
    expect(SERVICE).toContain(
      "supabase.rpc('accept_friend_request', {\n    payload: { request_id: requestId } as never,\n  })",
    );
    expect(SERVICE).toContain(
      "supabase.rpc('decline_friend_request', {\n    payload: { request_id: requestId } as never,\n  })",
    );
    expect(SERVICE).toContain(
      "supabase.rpc('cancel_friend_request', {\n    payload: { request_id: requestId } as never,\n  })",
    );
    expect(SERVICE).toContain(
      "supabase.rpc('remove_friend', {\n    payload: { friendship_id: friendshipId } as never,\n  })",
    );
    // `create` es el único con clave de idempotencia, y con la forma exacta
    // que `sec.assert_payload_shape` admite: ni un campo más.
    expect(SERVICE).toContain('readonly client_command_id: string;');
    expect(SERVICE).toContain('readonly command_contract_version: 1;');
    expect(SERVICE).toContain('readonly handle: string;');
    expect(MIGRATION).toContain(
      "c_allowed constant text[] := array['client_command_id', 'command_contract_version', 'handle'];",
    );
  });

  it('se leen las vistas y sus columnas, no las tablas de `core`', () => {
    expect(SERVICE).toContain(".from('my_friends')");
    expect(SERVICE).toContain("'friendship_id,counterpart_handle,counterpart_public_name,since'");
    expect(SERVICE).toContain(".from('my_friend_requests')");
    expect(SERVICE).toContain(
      "'request_id,direction,counterpart_handle,counterpart_public_name,created_at,expires_at'",
    );
    // Ni una tabla de `core`, ni un uid: la identidad que llega es la pública.
    expect(strip(SERVICE)).not.toMatch(/core\.\w+|\buser_id\b|\buid\b/);
  });

  /**
   * F12.E.C todavía no existe. Las cuatro funciones del enlace están en la
   * base desde E.A y **nadie las llama**: ni enlace, ni QR, ni Share, ni
   * ruta de llegada.
   */
  it('nada del enlace de amistad se usa todavía', () => {
    for (const fn of [
      'my_friend_link',
      'rotate_friend_link',
      'preview_friend_link',
      'respond_friend_link',
    ]) {
      expect(MIGRATION, fn).toContain(`create function api.${fn}`);
    }
    const client = [SERVICE, LIST, ADD, LAYOUT, PROFILE, NOTIFICATIONS].join('\n');
    expect(client).not.toMatch(/friend_link|friendLink|Share\.share|QrCode|friend-link/);
  });
});

describe('UNA llamada por búsqueda, y ninguna de más', () => {
  it('se usa `lookup_friend_candidate` y NUNCA `resolve_username` junto a ella', () => {
    expect(SERVICE).toContain("supabase.rpc('lookup_friend_candidate'");
    expect(SERVICE).not.toContain('resolve_username');
    expect(LOOKUP).toContain('void lookupCandidate(handle).then((result) => {');
    expect(strip(LOOKUP)).not.toMatch(/resolve_username|resolveUsername/);
  });

  it('no se busca por tecla, ni en parcial, ni por correo, ni por uid', () => {
    // La búsqueda es un acto explícito: `search`, y `setText` sólo invalida.
    expect(LOOKUP).toContain('const search = useCallback(() => {');
    expect(strip(LOOKUP)).not.toMatch(/debounce|setTimeout|autocomplete/i);
    expect(strip(ADD)).not.toMatch(/email|correo|uid|contains|ilike/i);
  });

  it('un handle imposible no cuesta una búsqueda', () => {
    expect(LOOKUP).toContain("if (!('handle' in next)) {");
    expect(LOOKUP).toContain("setState({ kind: 'invalid', problem: next.problem });");
    expect(CANDIDATE).toContain("import { validateHandle } from '@/domain';");
  });

  it('los estados del servidor son filas y no excepciones, y se leen los ocho', () => {
    expect(SERVICE).toContain(
      "if (state === 'not_found' || state === 'self' || state === 'throttled') return { state };",
    );
    expect(MIGRATION).toContain("state := 'throttled'; return next; return;");
    expect(MIGRATION).toContain("state := 'self'; return next; return;");
    expect(MIGRATION).toContain("state := 'not_found'; return next; return;");
  });
});

describe('la pantalla de Amigos', () => {
  it('lista recibidas, enviadas y amigos, cada una con su acción', () => {
    expect(LIST).toContain("{t('friends.incomingTitle')}");
    expect(LIST).toContain("{t('friends.outgoingTitle')}");
    expect(LIST).toContain("{t('friends.listTitle')}");
    expect(LIST).toContain('requests.incoming.map((request) => (');
    expect(LIST).toContain('requests.outgoing.map((request) => (');
    expect(LIST).toContain('friends.friends.map((friend) => (');
  });

  it('una sección vacía no se pinta, y sin amigos hay un estado compacto y la CTA', () => {
    expect(LIST).toContain('{requests.incoming.length === 0 ? null : (');
    expect(LIST).toContain('{requests.outgoing.length === 0 ? null : (');
    expect(LIST).toContain("<EmptyState symbol={Symbols.friends} title={t('friends.empty')} />");
    expect(LIST).toContain(
      '<ActionButton label={t(\'friends.add\')} tone="brand" onPress={addFriend} />',
    );
    expect(LIST).toContain("router.push('/friends/add');");
  });

  /**
   * **No hay filtro de cliente de lo terminal, y su ausencia es el contrato.**
   * Las vistas publican sólo lo vivo; escribir aquí un `!== 'declined'` sería
   * una segunda copia más débil de una regla que ya tiene dueño en la base.
   */
  it('nada de cliente filtra estados terminales: las vistas ya publican sólo lo vivo', () => {
    expect(MIGRATION).toContain(
      "and sec.friend_request_state(r.accepted_at, r.declined_at, r.cancelled_at, r.expired_at, r.expires_at) = 'pending'",
    );
    expect(MIGRATION).toContain('where f.ended_at is null');
    for (const source of [LIST, REQUESTS, FRIENDS, FRIEND]) {
      expect(strip(source)).not.toMatch(/'accepted'|'declined'|'cancelled'|'expired'|'ended'/);
    }
  });

  it('eliminar un amigo pide confirmación y dice a quién', () => {
    expect(LIST).toContain(
      "t('friends.removeTitle'), t('friends.removeBody', { name: nameOf(friend) })",
    );
    expect(LIST).toContain("text: t('action.delete'),");
    expect(LIST).toContain("style: 'destructive',");
    expect(LIST).toContain('void actions.remove(friend.friendshipId).then(explain);');
  });
});

describe('«Añadir amigo»: un estado, una oferta', () => {
  it('el resultado se pinta con la relación que el servidor dijo', () => {
    expect(ADD).toContain('relation={lookup.state.relation}');
    expect(ADD).toContain('requestId={lookup.state.requestId}');
  });

  /**
   * LA CRUZADA. `create_friend_request` no inserta una segunda fila cuando la
   * otra parte ya pidió: contesta `incoming_pending` con SU id. La pantalla
   * aplica esa respuesta literalmente en vez de pintar una saliente que no
   * existe.
   */
  it('una solicitud cruzada se convierte en «te ha enviado una solicitud», no en «enviada»', () => {
    expect(MIGRATION).toContain(
      "return jsonb_build_object('state', 'incoming_pending', 'request_id', v_rel.request_id, 'already_processed', false);",
    );
    expect(CANDIDATE).toContain("case 'incoming_pending':");
    expect(CANDIDATE).toContain(
      "return { ...state, relation: 'incoming_pending', requestId: answer.requestId };",
    );
    expect(ADD).toContain('lookup.applyCreate(outcome.answer);');
    // Nada convierte un envío en una saliente sin mirar lo que contestaron.
    expect(strip(ADD)).not.toMatch(/relation = 'outgoing_pending'|setState\(/);
  });

  it('el cooldown se dice sin explicar qué pasó ni quién lo decidió', () => {
    const copy = ['friends.cooldown'];
    for (const key of copy) expect(ADD + LIST + CANDIDATE).not.toContain(`${key}Reason`);
    expect(MIGRATION).toContain(
      "return jsonb_build_object('state', 'cooldown', 'already_processed', false);",
    );
  });
});

describe('nada se da por hecho sin el servidor', () => {
  it('una respuesta 2xx que no trae el sobre es un rechazo, no un éxito', () => {
    expect(SERVICE).toContain('if (data === null) return { ok: false, status, code: null };');
  });

  it('sólo un `ok` publica el cambio; sin red no se publica nada', () => {
    expect(ACTIONS).toContain('if (result.ok) {');
    expect(ACTIONS).toContain('if (settles) publishFriendRequestSettled(id);');
    expect(ACTIONS).toContain('publishFriendsChanged();');
    expect(ACTIONS).toContain("if (reason !== 'offline') publishFriendsChanged();");
    expect(CREATE).toContain('if (result.ok) {');
    expect(CREATE).toContain('publishFriendsChanged();');
  });

  it('un fallo de transporte conserva la clave para que el reintento SEA un replay', () => {
    expect(CREATE).toContain("if (reason !== 'offline') keys.current.delete(handle);");
    expect(MIGRATION).toContain(
      'select * into v_r from core.friend_request r\n   where r.requester_user_id = v_actor and r.client_command_id = v_command;',
    );
  });

  /**
   * Dos aparatos aceptando la misma solicitud no es un error que enseñar: el
   * segundo recibe `already_processed` con el mismo `friendship_id`. Sólo un
   * estado terminal DISTINTO es un 409 con su código.
   */
  it('aceptar dos veces es idempotente por estado, y el cliente no inventa otra semántica', () => {
    expect(MIGRATION).toContain(
      "return jsonb_build_object('request_id', v_id, 'state', 'accepted', 'friendship_id', v_f, 'already_processed', true);",
    );
    expect(SERVICE).toContain('alreadyProcessed: body.already_processed === true,');
    expect(ACTIONS).toContain("return { kind: 'done' };");
    expect(strip(ACTIONS)).not.toMatch(/alreadyProcessed\s*\?/);
  });

  it('nada de esto pasa por la cola offline ni se persiste', () => {
    for (const source of [SERVICE, ACTIONS, CREATE, LOOKUP, REQUESTS, FRIENDS]) {
      expect(strip(source)).not.toMatch(
        /AsyncStorage|SecureStore|enqueue|sqlite|offlineCatalogueCache/i,
      );
    }
  });
});

describe('el refresco: un evento en proceso y el primer plano', () => {
  it('hay UNA fuente de verdad para «algo cambió», con la forma de la de transferencias', () => {
    expect(EVENTS).toContain('export function publishFriendsChanged(): void {');
    expect(EVENTS).toContain('export function wakeFriends(): void {');
    expect(EVENTS).toContain(
      'export function publishFriendRequestSettled(requestId: string): void {',
    );
  });

  it('las dos lecturas se suscriben a las dos señales, y ninguna hace polling', () => {
    for (const source of [REQUESTS, FRIENDS]) {
      expect(source).toContain('subscribeFriendsChanged(() => {');
      expect(source).toContain('onFriendsWake(() => {');
      expect(strip(source)).not.toMatch(/setInterval|setTimeout/);
    }
    expect(REQUESTS).toContain('subscribeFriendRequestSettled((requestId) => {');
  });

  it('el primer plano sale del MISMO seam que la cola, la identidad y las transferencias', () => {
    expect(LAYOUT).toContain('wakeFriends();');
    expect(LAYOUT).not.toMatch(/AppState\.addEventListener/);
    // Una sola llamada, dentro del único `wakeOnForeground`.
    expect(strip(LAYOUT).match(/wakeFriends\(\)/g) ?? []).toHaveLength(1);
  });

  it('volver a Amigos vuelve a preguntar', () => {
    expect(LIST).toContain('useFocusEffect(');
    expect(LIST).toContain('refreshRequests();');
    expect(LIST).toContain('refreshFriends();');
  });
});

describe('Notificaciones y la campana', () => {
  it('Notificaciones lista SÓLO las entrantes accionables', () => {
    expect(NOTIFICATIONS).toContain("{t('notifications.friends')}");
    expect(NOTIFICATIONS).toContain('friendRequests.incoming.map((request) => (');
    expect(NOTIFICATIONS).toContain(
      "headline={t('friends.wantsToAdd', { name: friendName(request) })}",
    );
    // Las salientes viven en Perfil → Amigos, donde además se cancelan.
    expect(strip(NOTIFICATIONS)).not.toContain('friendRequests.outgoing');
  });

  it('entrar NO marca nada de amistad: no hay marca de visto en el servidor y no se inventa', () => {
    expect(strip(NOTIFICATIONS)).not.toMatch(/friendRequests\.(markSeen|markRead)/);
    expect(strip(REQUESTS)).not.toMatch(/markSeen|markRead|unread|seenAt|readAt/i);
    expect(strip(MIGRATION)).not.toMatch(/friend_request_seen|seen_at/);
  });

  it('rechazar no crea ningún aviso para quien la envió', () => {
    expect(strip(MIGRATION)).not.toMatch(/group_notice.*friend|friend.*notice/i);
    expect(strip(NOTIFICATIONS)).not.toMatch(/declineNotice|friendDeclineNotice/);
  });

  it('la campana suma las entrantes, en las dos barras, y conserva lo de antes', () => {
    for (const source of [TABS, GROUP]) {
      expect(source).toContain('friends.incoming.length > 0;');
      expect(source).toContain('incidents.unseen > 0 ||');
      expect(source).toContain('notices.unread > 0 ||');
      expect(source).toContain('proposals.incoming.length > 0 ||');
      expect(source).toContain('declined.unseen.length > 0 ||');
      // Las salientes NUNCA la encienden, y una amistad corriente tampoco.
      expect(code(source)).not.toMatch(/friends\.outgoing|friends\.friends/);
    }
  });
});

/** El fuente sin comentarios: lo que se ejecuta, no lo que se explica. */
function code(source: string): string {
  return strip(source);
}

describe('quién llega a Amigos', () => {
  it('cuenta normal, con username definitivo, y nunca un invitado', () => {
    expect(LAYOUT).toContain(
      'guard={isSignedIn(state) && !recovering && !gate && !isGuest(state)}',
    );
    expect(LAYOUT).toContain('<Stack.Screen name="friends/index" />');
    expect(LAYOUT).toContain('<Stack.Screen name="friends/add" />');
    // Y el servidor lo exige por su cuenta: la guarda es navegación.
    expect(MIGRATION).toContain(
      "perform sec.raise_boundary('NOT_AUTHORIZED', 'una sesion anonima no ' || p_what, 403);",
    );
    expect(MIGRATION).toContain(
      "perform sec.raise_boundary('USERNAME_REQUIRED', p_what || ' exige tener username definitivo', 409);",
    );
  });

  it('Perfil lleva a Amigos, con un contador de lo que espera y sin foto inventada', () => {
    expect(PROFILE).toContain("label={t('friends.title')}");
    expect(PROFILE).toContain('icon={Symbols.friends}');
    expect(PROFILE).toContain("router.push('/friends');");
    expect(PROFILE).toContain('badge={pendingFriends}');
    expect(PROFILE).toContain('const pendingFriends = friendRequests.incoming.length;');
    // El avatar sigue siendo el de iniciales, y no hay QR ni Share aquí: eso es E.C.
    expect(PROFILE).toContain('<AccountAvatar name={publicName} />');
    expect(code(PROFILE)).not.toMatch(/QrCode|Share\.share|friend_link/);
  });
});
