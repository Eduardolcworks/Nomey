import { describe, expect, it } from 'vitest';

import BAR from '../../src/features/groups/group-identity-bar.tsx?raw';
import CARD from '../../src/features/groups/group-card.tsx?raw';
import PILLS from '../../src/ui/components/option-pills.tsx?raw';
import SUMMARY from '../../src/features/groups/group-summary-card.tsx?raw';
import SYMBOLS from '../../src/ui/theme/symbols.ts?raw';
import PLATE from '../../src/ui/components/amount-plate.tsx?raw';
import INSIDE from '../../src/app/group/[id].tsx?raw';
import LIST from '../../src/app/(tabs)/groups.tsx?raw';
import PROJECTION from '../../src/features/groups/group-projection.ts?raw';
import SERVICE from '../../src/features/groups/group-service.ts?raw';
import USE_GROUPS from '../../src/features/groups/use-groups.ts?raw';

/**
 * LA LISTA DE GRUPOS, SU TARJETA Y LA PANTALLA DE DENTRO.
 *
 * Sin renderer de React no hay árbol al que preguntar, así que lo estructural
 * se fija aquí y el comportamiento de la proyección se interroga aparte, en
 * `tests/lib/group-projection.test.ts`, donde es una función pura.
 */

describe('la tarjeta', () => {
  it('es UNA sola superficie pulsable, sin objetivos sueltos dentro', () => {
    /*
     * Un segundo `Pressable` dentro sería un control que un lector de pantalla
     * anunciaría aparte, y una zona de la tarjeta que hace otra cosa.
     */
    expect(CARD.match(/<Pressable/g) ?? []).toHaveLength(1);
    expect(CARD).not.toContain('<TouchableOpacity');
  });

  it('anuncia nombre, participantes, estado e importe en UNA sola etiqueta', () => {
    expect(CARD).toContain("accessibilityLabel={t('groups.cardLabel'");
    expect(CARD).toContain('name: group.displayName');
    expect(CARD).toContain('participants,');
    expect(CARD).toContain('position: `${t(positionLabel(state))} ${amount}`');
    // Y una sola: nada dentro vuelve a ser anunciado por su cuenta.
    expect(CARD.match(/accessibilityLabel/g) ?? []).toHaveLength(1);
    expect(CARD.match(/accessibilityRole/g) ?? []).toHaveLength(1);
  });

  it('lleva el icono de persona con la cuenta, y el galón de entrar', () => {
    expect(CARD).toContain('Symbols.person');
    expect(CARD).toContain('Symbols.forward');
  });

  it('y NO distingue lo pendiente: la cola no es asunto de quien mira', () => {
    /*
     * F07/ADR-001, invariante 13. Un color, un contador o una etiqueta distintos
     * sugerirían que hay algo que hacer, y no lo hay: el grupo o existe ya o va
     * a existir, y en ninguno de los dos casos se le pide nada a nadie.
     */
    expect(CARD).not.toContain('group.pending');
  });

  it('usa la misma pieza que las tarjetas de Inicio, no un material propio', () => {
    expect(CARD).toContain('homeCardSurface(theme.surface)');
    expect(CARD).toContain('HomeCardRelief');
  });

  it('el nombre baja un escalón REAL de la escala y conserva el peso', () => {
    /*
     * `subheading` (20/25/600) -> `bodyStrong` (17/22/500). Un escalón por debajo
     * en tamaño, no un `fontSize` suelto, y con peso suficiente para seguir
     * mandando sobre el contador, que es `caption` (12/16/500) en gris terciario.
     */
    expect(CARD).toContain('variant="bodyStrong"');
    expect(CARD).not.toContain('variant="subheading"');
    // Y el estilo de la columna no lleva tamaño propio: lo pone el rol.
    const columna = CARD.slice(CARD.indexOf('identity: {'), CARD.indexOf('count: {'));
    expect(columna).not.toContain('fontSize');
    expect(columna).not.toContain('fontWeight');
  });

  it('y el nombre se recorta: nunca empuja al oblongo ni al galón', () => {
    expect(CARD).toContain('numberOfLines={1}');
    const columna = CARD.slice(CARD.indexOf('identity: {'), CARD.indexOf('count: {'));
    expect(columna).toContain('flex: 1');
    /*
     * `minWidth: 0` no es decorativo: sin él, el ancho mínimo de un contenedor
     * flexible es el de su contenido, así que un nombre largo ensancharía la
     * columna y expulsaría el oblongo en vez de truncarse.
     */
    expect(columna).toContain('minWidth: 0');
  });

  it('el orden interno es emoji · identidad · posición · galón', () => {
    const orden = ['{group.emoji}', 'styles.identity', '<AmountPlate', 'Symbols.forward'].map(
      (pieza) => CARD.indexOf(pieza),
    );
    expect(orden.every((i) => i >= 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });

  it('la columna del medio apila nombre ARRIBA y contador debajo', () => {
    const columna = CARD.slice(
      CARD.indexOf('<View style={styles.identity}>'),
      CARD.indexOf('<AmountPlate'),
    );
    expect(columna.indexOf('{group.displayName}')).toBeLessThan(columna.indexOf('Symbols.person'));
  });

  it('en pantalla el contador es SÓLO el número, sin ninguna palabra', () => {
    /*
     * El icono ya dice de qué se está contando, y la palabra consumía el ancho
     * que la columna necesita para el nombre: medido a 360 dp con la fuente al
     * 150 %, «participantes» se truncaba con elipsis.
     */
    const fila = CARD.slice(
      CARD.indexOf('<View style={styles.count}'),
      CARD.indexOf('</View>\n\n'),
    );
    expect(fila).toContain('{String(group.participantCount)}');
    expect(fila).not.toContain('{participants}');
    expect(fila).not.toMatch(/participante/);
  });

  it('pero la frase pluralizada sobrevive en la etiqueta accesible', () => {
    /*
     * Un icono no se lee en voz alta. Quitar la palabra de la pantalla no puede
     * quitársela a quien escucha, así que la pluralización sigue viva y alimenta
     * exactamente un sitio: la etiqueta de la tarjeta.
     */
    expect(CARD).toContain('pluralCategory(locale, group.participantCount)');
    expect(CARD).toContain("'group.participantsOne'");
    expect(CARD).toContain("'group.participantsOther'");
    // `participants` se usa una vez: en la etiqueta, y en ningún nodo visible.
    expect(CARD.match(/\bparticipants,/g) ?? []).toHaveLength(1);
    expect(CARD).not.toContain('>{participants}<');
  });

  it('y el número no se anuncia suelto por su cuenta', () => {
    const fila = CARD.slice(
      CARD.indexOf('<View style={styles.count}'),
      CARD.indexOf('</View>\n\n'),
    );
    expect(fila).toContain('accessible={false}');
  });

  it('la subtarjeta es la MISMA pieza que la de Deudas de Inicio', () => {
    /*
     * No se importa desde `features/personal` —rompería el aislamiento— ni se
     * copia: el primitivo neutral vive en `ui/` y lo usan los dos.
     */
    expect(CARD).toContain("from '@/ui/components'");
    expect(CARD).not.toContain('features/personal');
    expect(PLATE).toContain('level="regular"');
    expect(PLATE).toContain('depth="flat"');
    expect(PLATE).toContain('radius={Radius.md}');
    // Y no es un botón, ni aquí ni allí. Sobre el JSX, no sobre el comentario
    // que precisamente explica por qué no lo lleva.
    expect(PLATE).not.toContain('<Pressable');
    expect(PLATE).not.toContain('accessibilityRole=');
  });

  it('la moneda es la del GRUPO, nunca la del Modo Personal', () => {
    expect(CARD).toContain('code: group.currencyCode');
    expect(CARD).toContain('scale: group.currencyScale');
    expect(CARD).toContain('id: group.currencyDefinitionId');
  });

  it('no hay ninguna cifra escrita a mano en el JSX', () => {
    expect(CARD).not.toContain('0,00');
    expect(CARD).not.toContain('0.00');
    expect(CARD).toContain('format.money(');
  });
});

describe('la pantalla Grupos', () => {
  it('pinta la proyección, y el estado vacío sólo cuando no hay ninguno', () => {
    expect(LIST).toContain('useGroups(actorId, state.status)');
    expect(LIST).toContain('groups.length === 0 ?');
    expect(LIST).toContain('<GroupCard');
  });

  it('y NO afirma «no tienes grupos» antes de saberlo', () => {
    /*
     * Medido en el emulador: al montar la pestaña por primera vez, el estado
     * vacío aparecía un instante y después salían los grupos. Es una afirmación
     * sobre la cuenta, y no se hace mientras es justo lo que no se sabe.
     */
    expect(LIST).toContain('{loading ? null : groups.length === 0 ? (');
  });

  it('la cabecera es la de Inicio —la monta el layout— y el título debajo', () => {
    // La barra ya no se monta aquí: viajaba con la transición. Vive en el layout.
    expect(LIST).not.toContain('<AppTopBar');
    expect(LIST).toContain("<ScreenTitle>{t('groups.title')}</ScreenTitle>");
    // El título va DENTRO del scroll, igual que el saludo de Inicio.
    expect(LIST.indexOf('<ScrollView')).toBeLessThan(LIST.indexOf('<ScreenTitle>'));
  });

  it('deslizar la tarjeta descubre «Salir del grupo»: icono de salida, misma confirmación, sin ejecutar', () => {
    expect(LIST).toContain('<SwipeToDelete');
    expect(LIST).toMatch(
      /label=\{t\('groups\.menuLeave'\)\}\s*icon=\{Symbols\.leave\}\s*enabled=\{!group\.pending\}\s*busy=\{leaving\.leaving\}/,
    );
    // No es una papelera ni se llama eliminar.
    expect(LIST).not.toMatch(/groups\.menuDelete|deleteGroup|Eliminar grupo/);
    // Pulsar el control abre la MISMA confirmación que la opción del menú.
    expect(LIST.match(/askLeave\(group\.scopeId, group\.displayName\)/g) ?? []).toHaveLength(3);
    // El menú al mantener pulsado y el toque siguen ahí, dentro del gesto.
    expect(LIST).toMatch(
      /<SwipeToDelete[\s\S]*<LongPressMenu[\s\S]*<GroupCard[\s\S]*<\/LongPressMenu>\s*<\/SwipeToDelete>/,
    );
    // La vía accesible, sólo cuando la tarjeta permite salir.
    expect(CARD).toContain("[{ name: 'leave', label: t('groups.menuLeave') }]");
    expect(LIST).toMatch(/onLeave=\{\s*group\.pending\s*\?\s*undefined/);
  });

  it('abre el grupo por su identidad definitiva', () => {
    expect(LIST).toContain("pathname: '/group/[id]', params: { id: group.scopeId }");
  });

  it('y sin conexión lo dice, en vez de esconder la lista o vaciarla', () => {
    expect(LIST).toContain("t('groups.stale')");
    // El aviso es un añadido, nunca una condición para pintar los grupos.
    expect(LIST).not.toContain('stale ? null :');
  });
});

describe('de dónde salen los grupos confirmados', () => {
  it('de la vista `security_invoker`, SIN filtro de actor en el cliente', () => {
    /*
     * Quien decide qué filas se ven es la RLS de `core.membership` bajo la
     * identidad real. Un `.eq('user_id', …)` aquí sería una optimización
     * disfrazada de autorización: el atacante sencillamente lo omite.
     */
    expect(SERVICE).toContain("from('group_profile')");
    expect(SERVICE).toContain('sería una optimización disfrazada de seguridad');

    /*
     * **Hay `.eq`, y todos son de ÁMBITO.** Los gastos y el resumen de un grupo
     * se piden por `scope_id`, que es la pregunta —«los de este grupo»— y no una
     * autorización: quién puede ver ese ámbito lo decide la RLS de la membresía.
     * Un `.eq` sobre la identidad de quien mira sería lo otro, y no hay ninguno.
     */
    // Sobre el CÓDIGO: el filtro por actor se nombra en los comentarios, que es
    // justamente donde se explica por qué no está.
    const codigo = SERVICE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    /*
     * Los filtros que hay son de ÁMBITO y de CONTENIDO —el grupo, y lo que el
     * panel de filtros acota—, nunca de identidad. Quién puede ver un ámbito
     * lo decide la RLS de la membresía, y un `.eq` sobre quien mira sería una
     * optimización disfrazada de autorización.
     */
    const permitidos = [
      ".eq('scope_id'",
      ".eq('category_id'",
      ".eq('payer_participant_id'",
      ".eq('version_id'",
    ];
    for (const filtro of codigo.match(/\.eq\('[a-z_]+'/g) ?? []) {
      expect(permitidos, filtro).toContain(filtro);
    }
    expect(codigo).not.toContain("eq('user_id'");
    expect(codigo).not.toContain("eq('owner_user_id'");
    expect(codigo).not.toContain('actorId');
  });

  it('y las filas incompletas se descartan, no se rellenan con nada', () => {
    expect(SERVICE).toContain('row.scope_id === null');
    expect(SERVICE).toContain('row.currency_scale === null');
  });
});

describe('la proyección y su marca', () => {
  it('la marca se lee ANTES de la consulta', () => {
    /*
     * Es lo que hace que `confirm_seq <= snapshot.seq` signifique «el servidor
     * ya la tenía cuando esto arrancó». Leerla después incluiría confirmaciones
     * ocurridas durante el viaje, y el grupo parpadearía: dejaría de pintarse un
     * instante antes de aparecer en el snapshot.
     */
    expect(USE_GROUPS.indexOf('confirmSequence(actorId)')).toBeLessThan(
      USE_GROUPS.indexOf('Promise.allSettled(['),
    );
  });

  /**
   * **Las dos lecturas se resuelven por separado, y eso es deliberado.**
   *
   * Con `Promise.all`, un fallo al leer las posiciones tiraría también la lista
   * de grupos: quedarse sin ver los grupos porque no se pudo saber cuánto se
   * debe es perder lo que sí se sabía. `allSettled` deja pintar la lista con la
   * posición no disponible, que es la verdad de lo que se ha leído.
   */
  it('un fallo de las posiciones no se lleva por delante la lista', () => {
    expect(USE_GROUPS).toContain('Promise.allSettled(');
    expect(USE_GROUPS).not.toContain('Promise.all([fetchGroups()');
    // Y fresco sólo si llegaron las dos: media lectura no es una lectura.
    expect(USE_GROUPS).toMatch(
      /profiles\.status === 'fulfilled' &&\s*nets\.status === 'fulfilled' &&\s*debts\.status === 'fulfilled'/,
    );
  });

  it('la regla de retirada es la de §9, y no otra', () => {
    expect(PROJECTION).toContain('entry.confirmSeq <= snapshotSeq');
    expect(PROJECTION).toContain('snapshot !== null');
  });

  it('las dos mitades viajan CON su actor, así que no hay fuga entre cuentas', () => {
    expect(USE_GROUPS).toContain('type Owned<T> = { readonly actorId: string; readonly value: T }');
    expect(USE_GROUPS).toContain("owned.actorId === actorId && actorId !== ''");
  });
});

describe('dentro de un grupo', () => {
  it('lee la MISMA proyección que la lista, no una consulta propia', () => {
    /*
     * Es lo que hace que funcione sin red y que el nombre, el emoji, la cuenta y
     * la divisa sean exactamente los que enseña la tarjeta.
     */
    expect(INSIDE).toContain('useGroups(actorId, session.status)');
    expect(INSIDE).not.toContain('supabase');
    expect(INSIDE).not.toContain('fetchGroups');
  });

  it('conserva arriba la cabecera compartida, la misma de Inicio y Grupos', () => {
    expect(INSIDE).toContain('<AppTopBar alerts=');
    // La identidad del grupo va DEBAJO, en su propia fila.
    expect(INSIDE.indexOf('<AppTopBar')).toBeLessThan(INSIDE.indexOf('<GroupIdentityBar'));
  });

  it('la fila de identidad lleva sus piezas en el orden pedido', () => {
    /*
     * Volver · emoji · nombre · participantes · compartir · editar. Se mide
     * sobre el JSX, no sobre el fichero: la lista de las tres pendientes se
     * declara antes como constante, y eso no es su posición en pantalla.
     */
    const jsx = BAR.slice(BAR.indexOf('export function GroupIdentityBar'));
    const orden = [
      'Symbols.back',
      '{emoji}',
      '{name}',
      'Symbols.groups',
      'Symbols.share',
      'Symbols.edit',
    ].map((pieza) => jsx.indexOf(pieza));
    expect(orden.every((i) => i >= 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });

  /**
   * EL CONTADOR DE PARTICIPANTES: un dato accesible, no un control.
   *
   * Enseña el número REAL de participantes —del contrato vigente, con cuenta o
   * sin ella— y lo anuncia; pero no es botón, porque la pantalla a la que
   * llevaría no existe todavía.
   */
  it('el contador de participantes es un dato con etiqueta, no un botón', () => {
    expect(BAR).toContain('readonly participantCount: number | null;');
    const contador = BAR.slice(BAR.indexOf('EL CONTADOR'), BAR.indexOf('Compartir: pendiente'));
    expect(contador).toContain('accessibilityLabel={countLabel}');
    expect(contador).not.toContain('accessibilityRole');
    expect(contador).not.toContain('<Pressable');
    // Sin dato no hay cero: el icono solo.
    expect(contador).toContain('participantCount === null ? null :');
    // Y la etiqueta lleva el número, en singular y en plural.
    expect(BAR).toContain("t('group.participantCountOne')");
    expect(BAR).toContain("t('group.participantCount', { count: String(participantCount) })");
    // La ruta cuenta PARTICIPANTES del contrato vigente, no membresías.
    expect(INSIDE).toContain('participants.participants.length');
  });

  it('editar es un LÁPIZ, nunca un engranaje', () => {
    /*
     * Un engranaje son ajustes de la aplicación; esto cambia el nombre y el
     * emoji de UN grupo. `Symbols.edit` ya resuelve el par pencil/edit.
     */
    expect(BAR).toContain('Symbols.edit');
    // Y el par que ese símbolo resuelve es lápiz en las dos plataformas.
    expect(SYMBOLS).toContain("edit: { ios: 'pencil', android: 'edit' }");
    expect(BAR).not.toContain('Symbols.diagnostics');
  });

  it('compartir y el lápiz son botones reales, apagados sin fila autoritativa', () => {
    /*
     * Desde F09/ADR-004 compartir tiene flujo (share-group-surface): ya no es un
     * dibujo. Tres controles reales: volver, compartir y editar; los dos
     * últimos se anuncian apagados mientras el grupo no está en el servidor.
     */
    expect(BAR).not.toContain('Compartir: pendiente');
    expect(BAR.match(/<IconButton/g) ?? []).toHaveLength(3);
    expect(BAR).toContain('Symbols.back');
    expect(BAR).toContain('name={Symbols.share}');
    expect(BAR).toContain('disabled={onEdit === undefined}');
    // Y la ruta sólo los conecta con fila autoritativa.
    expect(INSIDE).toMatch(/onShare=\{\s*group\.pending\s*\?\s*undefined/);
    expect(INSIDE).toMatch(/onEdit=\{\s*group\.pending\s*\?\s*undefined/);
    expect(INSIDE).toContain("pathname: '/edit-group'");
  });

  it('y el nombre se trunca antes de empujar los botones', () => {
    const nombre = BAR.slice(BAR.indexOf('name: {'), BAR.indexOf('actions: {'));
    expect(nombre).toContain('flex: 1');
    expect(nombre).toContain('minWidth: 0');
    expect(BAR).toContain('numberOfLines={1}');
  });

  it('las dos pestañas vacías cambian sin navegar a otra ruta', () => {
    expect(INSIDE).toContain('<OptionPills');
    expect(INSIDE).toContain("useState<Tab>('movements')");
    expect(INSIDE).toContain("t('group.noMovements')");
    expect(INSIDE).toContain("t('group.allSettled')");
    // Cambiar de pestaña no navega: no hay router en el manejador.
    expect(INSIDE).toContain('onChange={setTab}');
  });

  it('y ningún movimiento ficticio llega al JSX', () => {
    for (const inventado of ['Cena', 'Taxi', 'Hotel', 'Ana', 'Luis', '42,50', '190,00', '684,20']) {
      expect(INSIDE, inventado).not.toContain(inventado);
      expect(SUMMARY, inventado).not.toContain(inventado);
    }
  });

  it('el  es un control de verdad, y abre SU ventana y no la de Personal', () => {
    /*
     * `/add` es el alta del Modo Personal: selector de clase, categoría, ámbito
     * personal y una cola de `personal_expense.create`. Abrirla desde un grupo
     * habría arrancado aquel flujo con otro rótulo, que es exactamente lo que
     * separa una operación de otra.
     */
    expect(INSIDE).toContain("pathname: '/group-expense'");
    expect(INSIDE).toContain('params: { groupId: group.scopeId }');
    expect(INSIDE).not.toContain("'/add'");

    // Se anuncia, y enciende el mismo fondo desenfocado que el `+` de Inicio.
    expect(INSIDE).toContain('accessibilityRole="button"');
    expect(INSIDE).toContain("accessibilityLabel={t('group.expenseTitle')}");
    expect(INSIDE).toContain('backdrop.show()');

    // Y ya no queda nada fingiendo: ni dibujo inerte, ni nadie fuera del
    // recorrido accesible.
    expect(INSIDE).not.toContain('pointerEvents="none"');
    expect(INSIDE).not.toContain('accessibilityElementsHidden');
  });

  it('y si el grupo no está en este aparato, lo dice en vez de inventarlo', () => {
    expect(INSIDE).toContain('group === undefined');
    expect(INSIDE).toContain("t('group.unknown')");
  });

  it('la tarjeta tripartita es UNA sola superficie, con separadores de pelo', () => {
    expect(SUMMARY.match(/<GlassSurface/g) ?? []).toHaveLength(1);
    expect(SUMMARY).toContain('level="regular"');
    expect(SUMMARY).toContain('radius={Radius.lg}');
    expect(SUMMARY).toContain('StyleSheet.hairlineWidth');
    // Ni resplandores, ni degradados, ni tamaños a mano.
    expect(SUMMARY).not.toContain('shadow');
    expect(SUMMARY).not.toContain('Gradient');
  });

  it('las tres zonas van en su orden y sólo el Total lleva el acento', () => {
    const orden = ["key: 'position'", "key: 'spent'", "key: 'total'"].map((k) =>
      SUMMARY.indexOf(k),
    );
    expect(orden.every((i) => i >= 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
    // El amarillo aparece una vez, y es el del Total.
    expect(SUMMARY.match(/'accent'/g) ?? []).toHaveLength(1);
    expect(SUMMARY.slice(SUMMARY.indexOf("key: 'total'"))).toContain("'accent'");
  });

  it('y se apila cuando tres columnas no caben, sin achicar la letra', () => {
    /*
     * El umbral es el ancho POR COLUMNA que el contenido necesita, con el factor
     * de tipografía del sistema dentro: a 411 dp con la letra al 150 % se apila
     * igual que en una pantalla estrecha, porque el problema es el mismo.
     */
    expect(SUMMARY).toContain('const MIN_COLUMN = 88');
    expect(SUMMARY).toContain('usable / 3 < MIN_COLUMN * fontScale');
    expect(SUMMARY).toContain('useWindowDimensions');
    // Apilada, cada zona sigue siendo etiqueta + cifra, no una cifra suelta.
    expect(SUMMARY).toContain('stackedFigure');
  });

  it('las opciones son DOS oblongos independientes, sin caja que los una', () => {
    /*
     * Cada uno con su propia superficie, su contorno y extremos completamente
     * redondeados. La fila que los sostiene no pinta fondo, ni borde, ni radio:
     * lo que los agrupa es compartir fila, anchura y separación.
     */
    expect(PILLS).toContain('borderRadius: Radius.full');
    expect(PILLS).toContain('borderWidth: StyleSheet.hairlineWidth');
    const fila = PILLS.slice(PILLS.indexOf('row: {'), PILLS.indexOf('pill: {'));
    expect(fila).not.toContain('backgroundColor');
    expect(fila).not.toContain('borderWidth');
    expect(fila).not.toContain('borderRadius');
    expect(fila).toContain('gap: Spacing.sm');
  });

  it('y reutilizan el material y los tokens ya aprobados', () => {
    expect(PILLS).toContain('<ControlMaterial radius={Radius.full} />');
    // Ningún color, sombra ni halo nuevos: todo sale del tema.
    expect(PILLS).toContain('theme.surfaceRaised');
    expect(PILLS).toContain('theme.surfaceSunken');
    expect(PILLS).toContain('theme.border');
    expect(PILLS).not.toContain('rgba(');
    expect(PILLS).not.toContain('boxShadow');
  });

  it('cada opción es UN objetivo accesible y anuncia si está elegida', () => {
    expect(PILLS).toContain('accessibilityRole="tab"');
    expect(PILLS).toContain('accessibilityState={{ selected }}');
    expect(PILLS.match(/<Pressable/g) ?? []).toHaveLength(1);
    expect(PILLS).toContain('flex: 1');
    expect(PILLS).toContain('minHeight: 44');
    expect(PILLS).toContain("selected ? 'bodyStrong' : 'bodySmall'");
    expect(PILLS).toContain("selected ? 'accent' : 'textSecondary'");
  });

  it('el + toma su altura del dock de Inicio, no de un número suelto', () => {
    /*
     * En Inicio el `+` no se coloca: lo empuja lo que el dock apila debajo —el
     * borde, la fila de destinos y el hueco—. Esta pantalla no lleva dock, así
     * que reproduce esa misma pila con los mismos tokens.
     */
    expect(INSIDE).toContain('const ADD_BOTTOM = DOCK.edge + DOCK.bar + DOCK.gap');
    expect(INSIDE).toContain('bottom: ADD_BOTTOM + insets.bottom');
    expect(INSIDE).toContain('width: DOCK.add');
    expect(INSIDE).not.toContain('NomeyDock');
  });

  /**
   * **Dos destinos, no tres.** Editar un gasto abre la MISMA ruta que añadirlo,
   * con la operación que corrige: no hay una segunda pantalla de edición, y por
   * eso las dos llamadas comparten `pathname`.
   */
  it('sólo hay CUATRO destinos: volver, la ventana del gasto, el editor y compartir', () => {
    expect(INSIDE).toContain('router.back()');
    expect(INSIDE.match(/router\.push/g) ?? []).toHaveLength(4);
    expect(INSIDE.match(/pathname: '\/group-expense'/g) ?? []).toHaveLength(2);
    expect(INSIDE.match(/pathname: '\/edit-group'/g) ?? []).toHaveLength(1);
    expect(INSIDE.match(/pathname: '\/share-group'/g) ?? []).toHaveLength(1);
    // Nada deshace la pila entera: esta pantalla no cierra ventanas ajenas.
    expect(INSIDE).not.toContain('dismissAll');
  });
});
