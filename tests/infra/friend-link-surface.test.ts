import { describe, expect, it } from 'vitest';

import ADD from '../../src/app/friends/add.tsx?raw';
import INTENT from '../../src/app/+native-intent.tsx?raw';
import LAYOUT from '../../src/app/_layout.tsx?raw';
import PROFILE from '../../src/app/profile.tsx?raw';
import REQUEST_ROUTE from '../../src/app/friend-request.tsx?raw';
import LINK_ROUTE from '../../src/app/friend-link.tsx?raw';
import TABS from '../../src/app/(tabs)/_layout.tsx?raw';
import ACTIONS from '../../src/features/friends/friend-link-actions.tsx?raw';
import AVATAR from '../../src/features/auth/account-avatar.tsx?raw';
import NAME_EDITOR from '../../src/features/auth/display-name-editor.tsx?raw';
import HANDLE_EDITOR from '../../src/features/auth/username-editor.tsx?raw';
import ROUND from '../../src/ui/components/round-trigger.tsx?raw';
import ARRIVAL from '../../src/features/friends/friend-link-arrival.ts?raw';
import LINK from '../../src/features/friends/friend-link.ts?raw';
import REQUEST_WINDOW from '../../src/features/friends/friend-link-request-window.tsx?raw';
import RESPONSE from '../../src/features/friends/use-friend-link-response.ts?raw';
import SERVICE from '../../src/features/friends/friend-service.ts?raw';
import STATE from '../../src/features/friends/friend-link-state.ts?raw';
import WINDOW from '../../src/features/friends/friend-link-window.tsx?raw';
import MY_LINK from '../../src/features/friends/use-my-friend-link.ts?raw';
import LISTENER from '../../src/lib/linking/incoming-links.ts?raw';
import SCANNER from '../../src/ui/components/qr-scanner.tsx?raw';
import MIGRATION from '../../supabase/migrations/20260930120000_friendships.sql?raw';

/**
 * F12.E.C — COMPARTIR AMISTAD, QR Y ENLACE.
 *
 * El circuito entero contra el contrato REAL de E.A, y lo que vigila son las
 * cinco cosas que se rompen sin que nada falle a la vista: que el QR y el
 * enlace sean **el mismo token**, que el `@username` **no viaje** en él, que
 * no se pregunte al servidor **antes de poder responder**, que rotar **no
 * sea optimista**, y que siga habiendo **un solo oyente** de enlaces.
 */

const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('el contrato de E.A del enlace', () => {
  it('las cuatro funciones existen y el cliente llama exactamente a ésas', () => {
    expect(MIGRATION).toContain('create function api.my_friend_link()');
    expect(MIGRATION).toContain('create function api.rotate_friend_link()');
    expect(MIGRATION).toContain('create function api.preview_friend_link(p_token text)');
    expect(MIGRATION).toContain('create function api.respond_friend_link(payload jsonb)');
    expect(SERVICE).toContain("supabase.rpc('my_friend_link')");
    expect(SERVICE).toContain("supabase.rpc('rotate_friend_link')");
    expect(SERVICE).toContain("supabase.rpc('preview_friend_link', {\n    p_token: token,\n  })");
    expect(SERVICE).toContain(
      "supabase.rpc('respond_friend_link', {\n    payload: { token, action } as never,\n  })",
    );
  });

  /**
   * Los siete estados del preview, ni uno inventado. `incoming_pending` es
   * «ya me pidió» y `mutual_pending` es «yo ya le pedí»: el servidor los
   * distingue para resolver `accepted_via_link`, y la pantalla no.
   */
  it('los estados son los del servidor, y sólo ésos', () => {
    for (const state of ['ok', 'friends', 'incoming_pending', 'mutual_pending']) {
      expect(MIGRATION, state).toContain(`'${state}'`);
    }
    expect(STATE).toContain(
      "export const FRIEND_LINK_RELATIONS: readonly FriendLinkRelation[] = [\n  'ok',\n  'incoming_pending',\n  'mutual_pending',\n];",
    );
    expect(SERVICE).toContain(
      "if (state === 'own' || state === 'invalid' || state === 'throttled') return { state };",
    );
    // `respond` añade sus dos: `declined` y `dismissed`.
    expect(MIGRATION).toContain("'state', 'dismissed'");
    expect(SERVICE).toContain(
      "if (state === 'declined') return { state, requestId: text(body?.request_id) };",
    );
  });

  it('rechazar sin solicitud previa NO crea una para poder rechazarla', () => {
    expect(MIGRATION).toContain(
      "    return jsonb_build_object('state', 'dismissed', 'already_processed', false);",
    );
    expect(STATE).toContain("| { readonly state: 'dismissed' }");
  });
});

describe('la cabecera de Perfil', () => {
  /*
   * Lo que se fija es la ESTRUCTURA y las constantes, no coordenadas: sin
   * renderer no hay geometría que medir, y una prueba de píxeles sobre un
   * layout de Flexbox sería una copia frágil de lo que el motor decide.
   */
  const HEADER_AT = PROFILE.indexOf('<View style={styles.identity}>');
  // La primera `<Section` del fichero es la de la rama de INVITADO, que va
  // antes: se busca la siguiente A PARTIR de la cabecera.
  const HEADER = PROFILE.slice(HEADER_AT, PROFILE.indexOf('<Section title={t(', HEADER_AT));

  it('el avatar es lo primero, pegado a la izquierda y centrado en vertical', () => {
    // Primer hijo de la fila: antes que la columna de identidad.
    expect(HEADER.indexOf('<AccountAvatar')).toBeLessThan(
      HEADER.indexOf('<View style={styles.identityWho}>'),
    );
    expect(PROFILE).toContain("identity: {\n    flexDirection: 'row',\n    alignItems: 'center',");
    /*
     * Y con AIRE entre la foto y el nombre: a `md` se tocaban y el nombre
     * se leía como un pie de la foto. El avatar mide 96; la separación va
     * a la escala de lo que separa, no a la de una fila de lista.
     */
    const fila = PROFILE.slice(
      PROFILE.indexOf('  identity: {'),
      PROFILE.indexOf('  identityWho: {'),
    );
    expect(fila).toContain('gap: Spacing.lg,');
    // Sin relleno horizontal propio: el de la pantalla es el que manda.
    const identity = PROFILE.slice(
      PROFILE.indexOf('  identity: {'),
      PROFILE.indexOf('  identityWho: {'),
    );
    expect(identity).not.toMatch(/paddingHorizontal|paddingLeft|marginLeft/);
  });

  it('nombre y username comparten columna a la derecha del avatar, y el nombre va antes', () => {
    expect(HEADER).toContain('<View style={styles.identityWho}>');
    expect(HEADER.indexOf('<DisplayNameEditor')).toBeLessThan(HEADER.indexOf('<UsernameEditor'));
    // El mismo eje X para los dos: la columna alinea a la izquierda…
    expect(PROFILE).toContain(
      "identityWho: {\n    flex: 1,\n    minWidth: 0,\n    alignItems: 'flex-start',",
    );
    // …y los editores dejaron de centrar su contenido.
    expect(NAME_EDITOR).toContain("block: { alignItems: 'flex-start', gap: Spacing.xxs },");
    expect(NAME_EDITOR).toContain("justifyContent: 'flex-start',");
    expect(HANDLE_EDITOR).toContain("reading: { alignItems: 'flex-start', gap: Spacing.xxs },");
  });

  /**
   * LA DERECHA ES UNA COLUMNA, y el orden importa: el lápiz arriba, QR y
   * Compartir debajo. Editar tus datos es lo que haces sobre lo que tienes
   * al lado; repartir tu enlace es otra cosa, y va después.
   */
  it('el lápiz va arriba y QR y Compartir debajo, en la columna de la derecha', () => {
    expect(HEADER).toContain('<View style={styles.identityActions}>');
    const acciones = HEADER.slice(HEADER.indexOf('<View style={styles.identityActions}>'));
    expect(acciones).toContain('name={Symbols.edit}');
    expect(acciones).toContain('<FriendLinkActions');
    expect(acciones.indexOf('name={Symbols.edit}')).toBeLessThan(
      acciones.indexOf('<FriendLinkActions'),
    );
    // Y QR y Compartir siguen ahí, los dos, debajo del lápiz.
    expect(ACTIONS).toContain('name={Symbols.qr}');
    expect(ACTIONS).toContain('name={Symbols.share}');
    // `flex-end` es lo que los pega al borde; sin `flex`, no compiten por el ancho.
    expect(PROFILE).toContain(
      "identityActions: {\n    alignItems: 'flex-end',\n    gap: Spacing.xs,\n  },",
    );
    // Ni el nombre ni el `@username` se han ido con ellos: siguen en el centro.
    const centro = HEADER.slice(
      HEADER.indexOf('<View style={styles.identityWho}>'),
      HEADER.indexOf('<View style={styles.identityActions}>'),
    );
    expect(centro).toContain('<DisplayNameEditor');
    expect(centro).toContain('<UsernameEditor');
    expect(centro).not.toContain('<FriendLinkActions');
  });

  /**
   * UN LÁPIZ, NO DOS. Cada editor tenía el suyo, y en un bloque de dos
   * líneas eran dos controles para una sola intención — «cambiar mis
   * datos». El de la cabecera abre LOS DOS; los editores conservan todo lo
   * demás, que es lo que el test de abajo comprueba que no se rompió.
   */
  it('hay UN solo lápiz en la cabecera, y ninguno dentro de los editores', () => {
    const veces = (texto: string, fuente: string) => fuente.split(texto).length - 1;
    expect(veces('name={Symbols.edit}', PROFILE)).toBe(1);
    expect(NAME_EDITOR).not.toContain('Symbols.edit');
    expect(HANDLE_EDITOR).not.toContain('Symbols.edit');
    // Y abre los dos de una vez.
    expect(PROFILE).toContain("label={t('profile.editIdentity')}");
    expect(PROFILE).toContain('onPress={editIdentity}');
    expect(PROFILE).toContain('setEditingName(true);');
    expect(PROFILE).toContain('setEditingHandle(true);');
  });

  /**
   * EL AVATAR SE VE. Llevaba el borde del material sobre `surfaceSunken`,
   * y a ese contraste el círculo desaparecía: se leían las iniciales
   * flotando. Relleno gris de tarjeta y borde de acento a dos puntos.
   */
  it('el avatar es una tarjeta gris con borde amarillo, no un hueco plano', () => {
    expect(AVATAR).toContain('backgroundColor: pressed ? theme.surface : theme.surfaceRaised');
    expect(AVATAR).toContain('borderColor: theme.accent');
    expect(AVATAR).toContain('borderWidth: 2');
    // Y ya no toma el borde del material: es una excepción nombrada.
    expect(AVATAR).not.toContain('controlEdge');
  });

  it('con un nombre o un handle largo se recorta el texto, nunca los botones', () => {
    // El centro cede el ancho; la columna de la derecha no participa en el reparto.
    expect(PROFILE).toContain('identityWho: {\n    flex: 1,\n    minWidth: 0,');
    const acciones = PROFILE.slice(
      PROFILE.indexOf('  identityActions: {'),
      PROFILE.indexOf('  identityEdit: {'),
    );
    expect(acciones).not.toMatch(/flex: 1|flexGrow/);
    // Y los dos editores truncan a una línea.
    expect(NAME_EDITOR).toContain('numberOfLines={1}');
    expect(HANDLE_EDITOR).toContain('numberOfLines={1}');
    // Los botones no llevan flex: su tamaño es una constante.
    expect(ACTIONS).not.toMatch(/flex: 1|flexGrow/);
  });

  it('no rompe los editores ni el avatar', () => {
    expect(PROFILE).toContain('<AccountAvatar name={publicName} />');
    expect(PROFILE).toContain('<DisplayNameEditor');
    expect(PROFILE).toContain('name={publicName}');
    expect(PROFILE).toContain('onSave={savePublicName}');
    expect(PROFILE).toContain('<UsernameEditor');
    expect(PROFILE).toContain('identity={identity.identity}');
    /*
     * LO QUE CAMBIÓ ES QUIÉN ABRE, y nada más: los dos reciben la bandera y
     * quien la baja, y siguen siendo dueños de su borrador, su validación y
     * su envío. El borrador se DERIVA mientras nadie haya escrito, así que
     * abrir no siembra estado desde un efecto.
     */
    expect(PROFILE).toContain('editing={editingName}');
    expect(PROFILE).toContain('onEditingChange={setEditingName}');
    expect(PROFILE).toContain('editing={editingHandle}');
    expect(PROFILE).toContain('onEditingChange={setEditingHandle}');
    expect(NAME_EDITOR).toContain("const draft = touched ?? name ?? '';");
    expect(HANDLE_EDITOR).toContain("const draft = touched ?? identity.handle ?? '';");
    // El cooldown sigue mandando: sin poder cambiar, abrir no abre.
    expect(HANDLE_EDITOR).toContain('canChangeUsername(identity, new Date())');
    expect(HANDLE_EDITOR).toContain('if (!editing || !canChange) {');
  });

  /** Las acciones NO son filas de ajustes, y «Amigos» sigue donde estaba. */
  it('QR y Compartir no son OptionRow, y la entrada Amigos se conserva', () => {
    expect(HEADER).not.toContain('<OptionRow');
    expect(PROFILE).toContain("label={t('friends.title')}");
    expect(PROFILE).toContain("router.push('/friends');");
  });

  it('los dos botones son cuadrados, del mismo tamaño, radio y material', () => {
    // La medida táctil que Nomey ya tiene, no un número inventado aquí.
    expect(ACTIONS).toContain('export const FRIEND_ACTION_SIZE = ROUND_TRIGGER;');
    expect(ROUND).toContain('export const ROUND_TRIGGER = 44;');
    expect(ACTIONS).toContain(
      'square: {\n    width: FRIEND_ACTION_SIZE,\n    height: FRIEND_ACTION_SIZE,',
    );
    // Un solo estilo para los dos, el mismo primitivo y el mismo radio.
    const veces = (texto: string) => ACTIONS.split(texto).length - 1;
    expect(veces('style={styles.square}')).toBe(2);
    expect(veces('<GlassPressable')).toBe(2);
    expect(veces('radius={Radius.lg}')).toBe(2);
    expect(veces('size={20}')).toBe(2);
  });

  /**
   * EL AVATAR SIGUE SIENDO LO MÁS GRANDE de la cabecera, y por bastante: el
   * orden de lectura es quién eres primero, qué puedes hacer después.
   */
  it('y no compiten con el avatar: son bastante más pequeños que él', () => {
    const avatar = Number(/const SIZE = (\d+);/.exec(AVATAR)?.[1]);
    const action = Number(/export const ROUND_TRIGGER = (\d+);/.exec(ROUND)?.[1]);
    expect(avatar).toBe(96);
    expect(action).toBe(44);
    expect(action).toBeLessThan(avatar);
    // Y menores que los 60 que tuvieron al nacer.
    expect(action).toBeLessThan(60);
  });

  it('cada uno dice lo que es, y conserva su acción', () => {
    expect(ACTIONS).toContain("label={t('friendLink.qrAction')}");
    expect(ACTIONS).toContain("label={t('friendLink.shareAction')}");
    expect(ACTIONS).toContain('name={Symbols.qr}');
    expect(ACTIONS).toContain('name={Symbols.share}');
    expect(ACTIONS).toContain('onPress={onOpenQr}');
    expect(ACTIONS).toContain('void share();');
  });
});

describe('Compartir: sin pantalla intermedia y sin token viejo', () => {
  it('revalida ANTES de compartir, y no abre la hoja si no lo consigue', () => {
    expect(ACTIONS).toContain('const url = await revalidate();');
    expect(ACTIONS).toContain('if (url === null) {');
    expect(ACTIONS).toContain("Alert.alert(t('friendLink.shareFailed')");
    // La hoja del sistema se abre DESPUÉS, y con el enlace confirmado.
    const share = ACTIONS.slice(ACTIONS.indexOf('const url = await revalidate();'));
    expect(share).toContain('await Share.share({');
    expect(share.indexOf('await Share.share({')).toBeGreaterThan(
      share.indexOf('if (url === null)'),
    );
  });

  it('no se cachea el enlace entre aperturas: el token es rotable desde otro aparato', () => {
    expect(MY_LINK).toContain('const revalidate = useCallback(async () => {');
    expect(strip(MY_LINK)).not.toMatch(/CACHE|AsyncStorage|SecureStore/);
  });

  it('doble toque bloqueado, y la frase lleva el handle y el enlace', () => {
    expect(ACTIONS).toContain('if (sharing || handle === null) return;');
    expect(ACTIONS).toContain("t('friendLink.shareMessage', { handle, link: url })");
  });
});

describe('el QR', () => {
  it('codifica EXACTAMENTE el enlace que comparte el otro botón', () => {
    // Los dos salen del mismo hook y del mismo constructor: un solo token.
    expect(WINDOW).toContain("import { useMyFriendLink } from './use-my-friend-link';");
    expect(ACTIONS).toContain("import { useMyFriendLink } from './use-my-friend-link';");
    expect(WINDOW).toContain('value={link.state.url}');
    expect(MY_LINK).toContain(
      'export function friendLinkHere(token: string): string {\n  return Linking.createURL(FRIEND_PATH, { queryParams: { t: token } });\n}',
    );
    // Y no hay un segundo token ni un segundo camino.
    expect(strip(WINDOW)).not.toMatch(/qrToken|secondToken/i);
  });

  it('sin enlace no hay QR ficticio: carga, o el motivo y reintentar', () => {
    expect(WINDOW).toContain("<LoadingState label={t('friendLink.loading')} />");
    expect(WINDOW).toContain("label={t('action.retry')}");
    expect(WINDOW).toContain("t('friendLink.qrHint')");
  });
});

describe('regenerar', () => {
  it('pide confirmación y dice lo que cuesta', () => {
    expect(WINDOW).toContain("Alert.alert(t('friendLink.rotateTitle'), t('friendLink.rotateBody')");
    expect(WINDOW).toContain("text: t('friendLink.rotateConfirm')");
    expect(WINDOW).toContain("style: 'destructive'");
  });

  /** Si el servidor no confirma, lo que se ve sigue siendo el token de antes. */
  it('no es optimista: sin confirmación, el enlace anterior sigue valiendo', () => {
    expect(MY_LINK).toContain('if (!result.ok) {');
    expect(MY_LINK).toContain('setRotateFailure(');
    // La rama de fallo no toca `state`: el QR no cambia.
    const rotate = MY_LINK.slice(MY_LINK.indexOf('const rotate = useCallback'));
    const failure = rotate.slice(
      rotate.indexOf('if (!result.ok) {'),
      rotate.indexOf('return false;'),
    );
    expect(failure).not.toContain('setState(');
  });

  it('y el tope de cinco al día se dice con su propia frase', () => {
    expect(MY_LINK).toContain("result.code === 'FRIEND_LINK_ROTATION_LIMITED'");
    expect(WINDOW).toContain("? 'friendLink.rotateLimited'");
    expect(MIGRATION).toContain("sec.raise_boundary('FRIEND_LINK_ROTATION_LIMITED'");
  });

  it('nunca se regenera solo', () => {
    expect(strip(WINDOW)).not.toMatch(/useEffect\([^)]*rotate/);
    expect(WINDOW).toContain('onPress={confirmRotate}');
  });
});

describe('la llegada', () => {
  it('UN solo oyente, en infraestructura, y la raíz le da los sumideros', () => {
    expect(LISTENER).toContain('Linking.getInitialURL()');
    expect(LISTENER).toContain("Linking.addEventListener('url'");
    expect(LAYOUT).toContain('const LINK_SINKS = [arriveInvitation, arriveFriendLink] as const;');
    expect(LAYOUT).toContain('useIncomingLinks(LINK_SINKS);');
    // Y ninguna feature monta el suyo.
    expect(strip(ARRIVAL)).not.toMatch(/Linking\./);
  });

  it('`/friend` no es una ruta para el router, y `/join` sigue sin serlo', () => {
    expect(INTENT).toContain('if (withoutQuery.endsWith(`/${FRIEND_PATH}`)) return null;');
    expect(INTENT).toContain('if (withoutQuery.endsWith(`/${JOIN_PATH}`)) return null;');
  });

  it('se abre desde las pestañas, y NUNCA para un invitado', () => {
    expect(TABS).toContain('useOpenPendingFriendLink(isSignedIn(state) && !isGuest(state));');
    // La invitación conserva su puerta, más ancha.
    expect(TABS).toContain('useOpenPendingInvitation(isSignedIn(state));');
  });

  it('el token no viaja en la ruta', () => {
    expect(REQUEST_ROUTE).toContain('const token = peekFriendLink();');
    expect(strip(REQUEST_ROUTE)).not.toMatch(/useLocalSearchParams|params:/);
    expect(LAYOUT).toContain('<Stack.Screen name="friend-request" />');
  });
});

describe('sólo se pregunta cuando se puede responder', () => {
  it('sin sesión, como invitado o sin username, no hay preview', () => {
    expect(REQUEST_ROUTE).toContain(
      "const eligible =\n    session.status === 'signed-in' && !isGuest(session) && !needsUsernameGate(identity);",
    );
    expect(REQUEST_ROUTE).toContain('useFriendLinkResponse(token, eligible)');
    expect(RESPONSE).toContain('if (!enabled || token === null) return;');
    // Y el servidor lo exige por su cuenta: la guarda es cortesía, no la ley.
    expect(MIGRATION).toContain(
      "perform sec.assert_friend_actor(v_actor, 'abre enlaces de amistad');",
    );
  });

  it('el token se consume al RESOLVER, no al abrir', () => {
    expect(RESPONSE).toContain(
      "if (result.ok && result.data.state === 'invalid') takeFriendLink();",
    );
    expect(RESPONSE).toContain("if (answer.state !== 'throttled') takeFriendLink();");
    expect(REQUEST_ROUTE).toContain('takeFriendLink();');
  });
});

describe('responder', () => {
  it('los tres estados contestables se ofrecen igual, y los otros no se contestan', () => {
    expect(REQUEST_WINDOW).toContain('if (!isAnswerable(preview)) {');
    expect(REQUEST_WINDOW).toContain("t('friendLink.wantsToAdd', { name })");
    expect(REQUEST_WINDOW).toContain("label={t('friends.accept')}");
    expect(REQUEST_WINDOW).toContain("label={t('friends.decline')}");
  });

  it('un enlace inválido no revela identidad', () => {
    // El servidor no la publica…
    expect(MIGRATION).toContain("state := 'invalid'; return next; return;");
    // …y la pantalla sólo pinta identidad cuando el estado la trae.
    expect(REQUEST_WINDOW).toContain("{preview.state === 'friends' ? (");
    expect(STATE).toContain("| { readonly state: 'invalid' }");
  });

  it('no se enseña nada que el servidor no publique', () => {
    expect(strip(REQUEST_WINDOW)).not.toMatch(/\buid\b|email|correo|balance|amount|group/i);
  });

  it('aceptar avisa a las listas SÓLO tras confirmar, y retira la solicitud reutilizada', () => {
    expect(RESPONSE).toContain("if (answer.state === 'friends' || answer.state === 'declined') {");
    expect(RESPONSE).toContain(
      'if (answer.requestId !== null) publishFriendRequestSettled(answer.requestId);',
    );
    expect(RESPONSE).toContain('publishFriendsChanged();');
    // `dismissed` no persistió nada: no hay lista que refrescar.
    const block = RESPONSE.slice(RESPONSE.indexOf("if (answer.state === 'friends'"));
    expect(block.slice(0, block.indexOf('}'))).not.toContain("'dismissed'");
  });

  it('y reutiliza el bus de E.B, sin un segundo', () => {
    expect(RESPONSE).toContain(
      "import { publishFriendRequestSettled, publishFriendsChanged } from './friend-events';",
    );
    expect(strip(RESPONSE)).not.toMatch(/new Set\(|addEventListener/);
  });
});

describe('el escáner, ahora compartido', () => {
  it('vive en `ui/`, no sabe qué lee y recibe sus textos traducidos', () => {
    expect(SCANNER).toContain('readonly onScan: (text: string) => boolean;');
    expect(strip(SCANNER)).not.toMatch(/readInvitation|readFriendLink|useTranslation/);
    expect(SCANNER).toContain('readonly labels: {');
  });

  it('escanear un QR de amistad recorre el MISMO camino que un enlace pulsado', () => {
    expect(ADD).toContain('if (!arriveFriendLink(text)) return false;');
    expect(ADD).toContain("label={t('friendLink.scan')}");
    // Nada se resuelve en el escaneo: se deja en la llegada y ya está.
    expect(strip(ADD)).not.toMatch(/previewFriendLink|respondFriendLink/);
  });
});

describe('offline y errores', () => {
  it('nada se da por hecho: ni compartir, ni responder, ni rotar', () => {
    expect(ACTIONS).toContain('if (url === null) {');
    expect(RESPONSE).toContain("view: { kind: 'failed', offline: result.status === 0 },");
    expect(MY_LINK).toContain("result.status === 0\n            ? 'offline'");
    expect(REQUEST_WINDOW).toContain(
      "{t(view.offline ? 'friends.errorOffline' : 'friendLink.checkFailed')}",
    );
  });

  it('y el enlace propio no se persiste en disco', () => {
    for (const source of [MY_LINK, ARRIVAL, LINK, RESPONSE]) {
      expect(strip(source)).not.toMatch(/AsyncStorage|SecureStore|sqlite|offlineCatalogueCache/i);
    }
  });
});

describe('las dos rutas', () => {
  it('mi enlace saca la identidad de `core`, no de la sesión', () => {
    expect(LINK_ROUTE).toContain('const { state: identity } = useAccountIdentity();');
    expect(LINK_ROUTE).toContain("identity.status === 'ready' ? identity.identity.handle : null");
    expect(LINK_ROUTE).toContain('<FriendLinkWindow');
  });

  it('y nada de E.D: no hay amistad desde un participante de grupo', () => {
    const client = [PROFILE, ADD, LINK_ROUTE, REQUEST_ROUTE, ACTIONS, WINDOW].join('\n');
    expect(client).not.toMatch(/participant|group_scope|addFriendFromGroup/i);
  });
});
