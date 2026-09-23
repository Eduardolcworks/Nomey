import { describe, expect, it } from 'vitest';

import ADD from '../../src/app/add.tsx?raw';
import PICKER from '../../src/features/friends/friend-picker.tsx?raw';
import LAYOUT from '../../src/features/friends/friend-picker-layout.ts?raw';
import SEARCH from '../../src/features/friends/friend-search.ts?raw';
import FRIEND_SERVICE from '../../src/features/friends/friend-service.ts?raw';
import FIELD from '../../src/features/transfers/recipient-field.tsx?raw';
import FORM from '../../src/features/transfers/transfer-form.tsx?raw';
import RECIPIENT from '../../src/features/transfers/recipient.ts?raw';
import LOOKUP from '../../src/features/transfers/use-resolve-recipient.ts?raw';
import TRANSFER_SERVICE from '../../src/features/transfers/transfer-service.ts?raw';
import MOVEMENT from '../../src/features/personal/movement-form.tsx?raw';
import SYMBOLS from '../../src/ui/theme/symbols.ts?raw';
import MIGRATION from '../../supabase/migrations/20260926120000_transfer_proposals.sql?raw';

/**
 * F12.E.E — EL SELECTOR DE AMIGOS EN TRANSFERENCIA.
 *
 * Un SEGUNDO camino hasta el mismo destinatario, y el contrato es
 * exactamente ése: la lupa no cambia de significado, no aparece una clase
 * nueva de destinatario, no se guarda ningún uid y el servidor sigue
 * resolviendo el handle él mismo. Lo que este fichero vigila es que ninguna
 * de esas cuatro cosas se rompa sin que nada falle a la vista.
 *
 * La lógica pura —el filtro local, el orden, el mapeo a `found`— vive en
 * `tests/lib/friend-picker.test.ts`.
 */

const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('los dos botones de la fila del destinatario', () => {
  it('la lupa sigue donde estaba, con su etiqueta y su acento', () => {
    expect(FIELD).toContain("label={t('transfer.recipientSearch')}");
    expect(FIELD).toContain('onPress={lookup.search}');
    expect(FIELD).toContain('name={Symbols.search}');
    expect(FIELD).toContain('colour={lookup.canSearch ? theme.accent : theme.textDisabled}');
  });

  it('y a su lado, en la misma fila, el de dos personas', () => {
    expect(FIELD).toContain("label={t('transfer.recipientFriends')}");
    expect(FIELD).toContain('name={Symbols.friends}');
    expect(FIELD).toContain('onPress={onPickFriend}');
    // Mismo primitivo y mismo círculo que la lupa: ninguno pesa más.
    expect(FIELD.match(/<GlassPressable/g) ?? []).toHaveLength(3);
    expect(FIELD.match(/<View style={styles.circle}>/g) ?? []).toHaveLength(3);
  });

  it('el icono sale del registro que ya existe, sin dependencias nuevas', () => {
    expect(SYMBOLS).toContain("friends: { ios: 'person.2.fill', android: 'group' }");
    expect(strip(PICKER) + strip(FIELD)).not.toMatch(/react-native-vector-icons|@expo\/vector/);
  });

  it('sin `onPickFriend` la fila es la de antes: campo y lupa', () => {
    expect(FIELD).toContain('{onPickFriend === undefined ? null : (');
    expect(FIELD).toContain('readonly onPickFriend?: () => void;');
  });

  /**
   * El botón es del formulario de Transferencia y de ningún otro: Gasto e
   * Ingreso no tienen destinatario que elegir.
   */
  it('ningún otro tipo de movimiento lo enseña', () => {
    expect(strip(MOVEMENT)).not.toMatch(/onPickFriend|FriendPicker|recipientFriends/);
  });
});

describe('quién compone el selector', () => {
  /**
   * `features/transfers` no puede importar `features/friends` —la misma
   * frontera por la que `add.tsx` compone el segmento entero—, así que el
   * formulario recibe el selector y decide cuándo enseñarlo.
   */
  it('la ruta, porque una feature no importa a otra', () => {
    expect(strip(FORM)).not.toMatch(/@\/features\/friends/);
    expect(ADD).toContain("import { FriendPicker } from '@/features/friends';");
    expect(ADD).toContain('friendPicker={({ onSelect, onClose }) => (');
    expect(ADD).toContain('<FriendPicker');
    expect(ADD).toContain('actorId={actorId}');
  });

  it('el formulario sólo lo monta mientras está abierto', () => {
    expect(FORM).toContain('const [picking, setPicking] = useState(false);');
    expect(FORM).toContain('{picking && friendPicker !== undefined');
    expect(FORM).toContain('setPicking(true);');
  });
});

describe('la hoja', () => {
  it('tiene arriba un campo con lupa que dice qué hace', () => {
    expect(PICKER).toContain("placeholder={t('friends.pickerSearch')}");
    expect(PICKER).toContain("accessibilityLabel={t('friends.pickerSearch')}");
    expect(PICKER).toContain('name={Symbols.search}');
    expect(PICKER).toContain("t('friends.pickerTitle')");
  });

  it('enseña todos los amigos por defecto, en el orden del módulo puro', () => {
    expect(PICKER).toContain('const choices = useMemo(() => friendChoices(friends.friends)');
    expect(PICKER).toContain('filterFriendChoices(choices, query)');
    expect(SEARCH).toContain('export function friendChoices(');
  });

  it('cada fila es el nombre con el @username debajo, y toda ella se pulsa', () => {
    expect(PICKER).toContain('<IdentityLine');
    expect(PICKER).toContain('name={choice.publicName}');
    expect(PICKER).toContain('handle={choice.handle}');
    expect(PICKER).toContain('accessibilityRole="button"');
    expect(PICKER).toContain('accessibilityLabel={`${choice.publicName} @${choice.handle}`}');
  });

  it('reutiliza `useMyFriends` y no duplica el hook ni sus señales', () => {
    expect(PICKER).toContain("import { useMyFriends } from './use-my-friends';");
    expect(PICKER).toContain("const friends = useMyFriends(actorId, actorId !== '');");
    expect(strip(PICKER)).not.toMatch(/useEffect|fetchMyFriends|supabase/);
  });
});

describe('lo que el selector NO hace', () => {
  /**
   * Ésta es la diferencia con `/friends/add`, y la razón de ser del bloque:
   * aquél resuelve un `@username` contra el servidor y gasta una de las
   * veinte consultas del resolver; éste acota lo que ya está en memoria.
   */
  it('no llama a `resolve_username` ni a `lookup_friend_candidate`', () => {
    for (const source of [PICKER, SEARCH]) {
      expect(strip(source)).not.toMatch(/resolve_username|lookup_friend_candidate|rpc\(/);
    }
  });

  it('no hay una llamada por tecla: el filtro es una función pura', () => {
    expect(SEARCH).toContain('export function matchesFriendQuery(');
    expect(SEARCH).toContain('export function filterFriendChoices(');
    expect(strip(SEARCH)).not.toMatch(/supabase|async|await|fetch/);
  });

  it('lee de `api.my_friends`, que es lo único que necesita', () => {
    expect(FRIEND_SERVICE).toContain(".from('my_friends')");
  });

  it('ni recientes, ni favoritos, ni orden por última transferencia', () => {
    for (const source of [PICKER, SEARCH]) {
      expect(strip(source)).not.toMatch(/recent|favourite|favorite|lastTransfer/i);
    }
  });
});

describe('un amigo elegido es el MISMO destinatario', () => {
  it('no hay una clase nueva de destinatario', () => {
    expect(RECIPIENT).toContain('export function recipientFromChoice(');
    expect(RECIPIENT).toContain("return { kind: 'found', handle, publicName };");
    expect(strip(RECIPIENT)).not.toMatch(/kind: 'friend'|'friend';/);
  });

  it('elegir deja el `found` sin preguntar nada al servidor', () => {
    expect(LOOKUP).toContain(
      'const choose = useCallback((handle: string, publicName: string) => {',
    );
    expect(LOOKUP).toContain('setState(recipientFromChoice(handle, publicName));');
    expect(FORM).toContain('lookup.choose(chosen.handle, chosen.publicName);');
    expect(FORM).toContain('setPicking(false);');
  });

  it('el importe y el concepto no se tocan: son del borrador del alta', () => {
    const chooseBlock = FORM.slice(
      FORM.indexOf('onSelect: (chosen)'),
      FORM.indexOf('onClose: () => {', FORM.indexOf('onSelect: (chosen)')),
    );
    expect(chooseBlock).not.toMatch(/setEntry|onChangeEntry|onChangeConcept|setConcept/);
  });

  it('la X sigue limpiando el destinatario y sólo el destinatario', () => {
    expect(FIELD).toContain("label={t('transfer.recipientChange')}");
    expect(FORM).toContain('onChange={() => {\n              lookup.reset();\n            }}');
  });
});

describe('ni un uid, ni un cambio de backend', () => {
  it('lo que viaja del selector al formulario es handle y nombre', () => {
    expect(FORM).toContain(
      'readonly onSelect: (chosen: { readonly handle: string; readonly publicName: string }) => void;',
    );
    expect(ADD).toContain('onSelect({ handle: choice.handle, publicName: choice.publicName });');
    expect(strip(PICKER)).not.toMatch(/\buid\b|user_id/);
  });

  it('`create_transfer_proposal` se llama igual que antes, con el handle', () => {
    expect(TRANSFER_SERVICE).toContain("supabase.rpc('create_transfer_proposal'");
    expect(TRANSFER_SERVICE).toContain('readonly handle: string;');
    expect(strip(TRANSFER_SERVICE)).not.toMatch(/recipient_user_id|\buid\b/);
  });

  it('y el servidor lo sigue resolviendo él, una sola vez', () => {
    expect(MIGRATION).toContain('v_target := sec.handle_owner(v_raw);');
  });
});

describe('sin amigos, y cuando la lectura falla', () => {
  it('estado vacío compacto y la salida a Amigos', () => {
    expect(PICKER).toContain("title={t('friends.empty')}");
    expect(PICKER).toContain("label={t('friends.seeFriends')}");
    expect(ADD).toContain("router.replace('/friends');");
  });

  it('un fallo se dice y se puede reintentar; no se finge una lista vacía', () => {
    expect(PICKER).toContain('{friends.failed ? (');
    expect(PICKER).toContain("title={t('friends.loadFailed')}");
    expect(PICKER).toContain("retry={{ label: t('action.retry'), onPress: friends.refresh }}");
    // El vacío sólo se pinta cuando la lectura fue bien.
    expect(PICKER).toContain('friends.loading ? null : (');
  });

  it('y la lupa global sigue existiendo pase lo que pase con los amigos', () => {
    expect(FIELD).toContain('onPress={lookup.search}');
    expect(strip(FIELD)).not.toMatch(/friends\.(failed|loading)/);
  });
});

describe('la hoja no oscurece lo que hay detrás', () => {
  /**
   * El `Modal` es `transparent` y no atenúa por su cuenta: el único velo era
   * el `backgroundColor` del área exterior, copiado de `DateSheet`. Sin él,
   * Transferencia se ve igual con la hoja abierta que sin ella — que importa
   * porque el importe y el concepto que se acaban de escribir siguen ahí
   * mientras se elige a quién enviárselos.
   */
  it('el área exterior sigue cerrando, y ya no pinta', () => {
    expect(PICKER).toContain('<Modal visible transparent');
    expect(PICKER).toContain('style={styles.outside}');
    expect(PICKER).toContain('onPress={onClose}');
    expect(PICKER).toContain('outside: {\n    flex: 1,\n  },');
  });

  it('ni color, ni alfa, ni opacidad, ni desenfoque en toda la hoja', () => {
    const code = strip(PICKER);
    expect(code).not.toMatch(/rgba\(/);
    expect(code).not.toMatch(/backdrop|dimming|veil/i);
    expect(code).not.toMatch(/\bopacity\b/);
    expect(code).not.toMatch(/BlurView|blurRadius|intensity=/);
    // Y no quedó el estilo viejo con otro nombre.
    expect(code).not.toContain('styles.veil');
  });

  it('y el fondo de Transferencia no se toca', () => {
    expect(strip(ADD)).not.toMatch(/backdrop\.(show|hide)\(\)[\s\S]{0,40}FriendPicker/);
    expect(strip(FORM)).not.toMatch(/backdrop|Scrim/);
  });
});

describe('la hoja crece con lo que hay', () => {
  it('el alto sale de la función pura, sobre lo FILTRADO', () => {
    expect(PICKER).toContain('maxHeight: friendListHeight(shown.length)');
    expect(PICKER).toContain(
      "import { FRIEND_ROW_HEIGHT, friendListHeight } from './friend-picker-layout';",
    );
    // Sobre `shown` y no sobre `choices`: buscar tiene que encoger la hoja.
    expect(PICKER).not.toContain('friendListHeight(choices.length)');
  });

  it('ya no hay un alto máximo fijo', () => {
    expect(strip(PICKER)).not.toMatch(/LIST_MAX_HEIGHT|maxHeight: \d/);
  });

  it('la fila declara el MISMO número que usa la cuenta', () => {
    expect(PICKER).toContain('minHeight: FRIEND_ROW_HEIGHT,');
    expect(LAYOUT).toContain('export const FRIEND_ROW_HEIGHT = 56;');
    expect(LAYOUT).toContain('export const MAX_VISIBLE_FRIENDS = 6;');
  });

  /**
   * Un relleno al final haría que seis filas no cupieran en el alto de seis
   * filas, y la lista se desplazaría cuando no debe.
   */
  it('la lista no lleva relleno que falsee la cuenta', () => {
    expect(strip(PICKER)).not.toMatch(/contentContainerStyle/);
    expect(PICKER).toContain('list: {},');
  });

  it('la cabecera queda fuera de lo que se desplaza', () => {
    const scrollAt = PICKER.indexOf('<ScrollView');
    expect(scrollAt).toBeGreaterThan(-1);
    // El título y el buscador se declaran ANTES, como hermanos, no dentro.
    expect(PICKER.indexOf("t('friends.pickerTitle')")).toBeLessThan(scrollAt);
    expect(PICKER.indexOf("placeholder={t('friends.pickerSearch')}")).toBeLessThan(scrollAt);
    expect(PICKER.slice(scrollAt)).not.toMatch(/pickerSearch|pickerTitle/);
  });

  /** Vacío, error y «ninguno coincide» son ramas SIN `ScrollView`: no reservan alto. */
  it('vacío, error y sin coincidencias no reservan altura de lista', () => {
    const scrollBlock = PICKER.slice(PICKER.indexOf('<ScrollView'));
    for (const branch of ['friends.empty', 'friends.loadFailed', 'friends.pickerNoMatches']) {
      expect(scrollBlock).not.toContain(branch);
    }
    expect(PICKER.match(/<ScrollView/g) ?? []).toHaveLength(1);
  });
});
