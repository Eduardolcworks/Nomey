import { describe, expect, it } from 'vitest';

import LAYOUT from '../../src/app/_layout.tsx?raw';
import ROUTE from '../../src/app/create-group.tsx?raw';
import SELECTOR from '../../src/app/group-action.tsx?raw';
import SHEET from '../../src/features/groups/group-action-sheet.tsx?raw';
import FORM from '../../src/features/groups/group-form.tsx?raw';
import WINDOW from '../../src/features/groups/group-window.tsx?raw';
import PICKER from '../../src/features/groups/emoji-picker.tsx?raw';
import CURRENCY from '../../src/features/groups/currency-field.tsx?raw';
import SERVICE from '../../src/features/groups/group-service.ts?raw';
import CATALOGO from '../../src/lib/currency/catalogue.ts?raw';
import CATALOGUE from '../../src/features/groups/emoji-catalogue.ts?raw';
import ADD from '../../src/app/add.tsx?raw';
import ES from '../../src/lib/i18n/messages/es-ES.ts?raw';
import EN from '../../src/lib/i18n/messages/en.ts?raw';

/**
 * LA VENTANA DE CREAR GRUPO: cableado, y lo que deliberadamente NO hace.
 *
 * Sin renderer de React no hay árbol al que preguntar, así que lo que se fija
 * aquí es lo estructural. Las reglas del borrador y del catálogo de emojis son
 * funciones puras y se interrogan por comportamiento en `tests/lib/`.
 */

describe('la ventana se presenta como las otras cuatro', () => {
  it('está declarada como modal transparente y con fondo transparente', () => {
    const bloque = LAYOUT.slice(LAYOUT.indexOf('name="create-group"'));
    expect(bloque).toContain("presentation: 'transparentModal'");
    expect(bloque).toContain("animation: 'fade'");
    expect(bloque).toContain("contentStyle: { backgroundColor: 'transparent' }");
  });

  it('y REUTILIZA el armazón de la ventana de Personal, no lo copia', () => {
    /*
     * `SheetWindow` es lo que le da el mismo material, tamaño, posición,
     * entrada y desplazamiento por teclado que «Añadir movimiento». Copiar su
     * geometría habría sido tener dos que se separan al primer retoque.
     */
    expect(WINDOW).toContain('SheetWindow');
    expect(ADD).toContain('SheetWindow');
    expect(WINDOW).not.toContain('useWindowDimensions');
    expect(WINDOW).not.toContain('StyleSheet');
  });
});

describe('la navegación entre el selector y la ventana', () => {
  it('cerrar la ventana aterriza en GRUPOS, no en el selector', () => {
    /*
     * `dismissAll` deshace TODAS las ventanas a la vez, así que la hoja no
     * llega a reaparecer entre medias y no queda ninguna ruta modal invisible
     * en la pila — con `back` se veía un instante y el siguiente Atrás la
     * descubría.
     */
    expect(ROUTE).toContain('router.dismissAll()');
    expect(ROUTE).not.toContain('router.back');
    // Y Atrás sale por la MISMA puerta, no deshaciendo una ruta por su cuenta.
    expect(WINDOW).toContain('<CloseOnBack close={close} />');
    expect(WINDOW).toContain("BackHandler.addEventListener('hardwareBackPress'");
  });

  it('`Crear grupo` APILA la ventana; no deshace la ruta del selector', () => {
    // Apilar es lo que permite volver al selector para escoger la otra opción.
    const bloque = SELECTOR.slice(SELECTOR.indexOf('<GroupActionSheet'));
    expect(bloque).toContain("router.push('/create-group')");
    // Y ya dentro (F09/ADR-004) la hoja se SUSTITUYE por el grupo: volver no la reabre.
    expect(bloque).toContain(
      "router.replace({ pathname: '/group/[id]', params: { id: scopeId } });",
    );
    expect(bloque).toContain('onClosed={dismiss}');
  });

  it('la hoja se RETIRA mientras hay otra ventana encima', () => {
    // Dos superficies modales apiladas a la vez se leen como un error, y el
    // velo de la de abajo se quedaría por delante del fondo.
    // `useFocusEffect` y no `useIsFocused`: con una ventana `transparentModal`
    // encima, el segundo se quedaba en `false` después de cerrarla y dejaba la
    // hoja retirada con un velo invisible a pantalla completa sobre Grupos.
    expect(SELECTOR).toContain('useFocusEffect');
    // Se busca el USO, no la palabra: el comentario nombra el hook descartado
    // justamente para explicar por qué ya no está.
    expect(SELECTOR).not.toMatch(/useIsFocused\(\)/);
    expect(SELECTOR).toContain('hidden={!focused}');
    expect(SHEET).toContain('if (hidden) return null;');
    // Y retirada NO puede quedarse con el botón Atrás: era la suscripción más
    // reciente y cerraba las dos superficies de golpe.
    expect(SHEET).toContain('if (hidden) return;');
    expect(SHEET).toContain('}, [hidden]);');
  });

  it('y la ventana NO toca el fondo desenfocado', () => {
    /*
     * El dueño del fondo es el selector, que sigue montado debajo. Un `hide()`
     * en la limpieza de esta ruta apagaría el desenfoque al volver atrás, con
     * el dock asomando entre las dos superficies durante la transición.
     */
    expect(ROUTE).not.toContain('useAddBackdrop');
    expect(ROUTE).not.toContain('backdrop');
    expect(SELECTOR).toContain('useEffect(() => hideBackdrop, [hideBackdrop])');
  });
});

describe('la creación es real, y sale por la barrera durable', () => {
  it('el dominio de grupos escribe SÓLO por la frontera atómica', () => {
    /*
     * DOS llamadas, y las dos son funciones de la frontera autoritativa:
     * `api.create_group` y `api.record_group_expense`. Lo que sigue prohibido es
     * tocar tablas directamente: eso es lo que dejaría medio grupo creado —o un
     * gasto sin sus efectos— si algo fallara a mitad.
     */
    /*
     * El catálogo de divisas BAJÓ a `lib/currency` en F11: lo necesitan
     * también el alta de un movimiento personal y el control de moneda de
     * `AmountSheet`, y una feature no puede leer de otra. Sigue siendo la
     * misma vista de `api` y el mismo `select`; lo que cambió es dónde vive.
     */
    expect(CATALOGO).toContain("from('currency_definition')");
    expect(SERVICE).toContain("from '@/lib/currency'");
    expect(SERVICE).toContain("supabase.rpc('create_group'");
    expect(SERVICE).toContain("supabase.rpc('record_group_expense'");
    /* Anular es la MISMA función que usa el Modo Personal: no elige la clase,
     * la lee de la operación. Un `annul_group_expense` propio habría sido una
     * segunda regla de anulación que mantener en paralelo. */
    expect(SERVICE).toContain("supabase.rpc('annul_operation'");
    // Y editar el perfil, directo a la frontera: F07/ADR-001 no cubre ediciones.
    expect(SERVICE).toContain("supabase.rpc('update_group_profile'");
    /*
     * Y la QUINTA, de F11: la conversión congelada de un gasto se lee por su
     * función lectora —`SECURITY DEFINER` que autoriza por membresía— y nunca
     * consultando `core.frozen_conversion`, a la que el cliente no tiene ni
     * debe tener acceso.
     */
    expect(SERVICE).toContain("supabase.rpc('group_operation_conversion'");
    expect(SERVICE.match(/supabase\.rpc\(/g) ?? []).toHaveLength(5);
    expect(SERVICE).not.toContain('.insert(');
    expect(SERVICE).not.toContain('.update(');
    expect(SERVICE).not.toContain('.upsert(');
  });

  it('el FORMULARIO no llama a la frontera: entrega el borrador y ya', () => {
    /*
     * La regla entera de F07/ADR-001 §1 en una línea: el formulario no conoce la
     * red. Si pudiera llamar a `api.create_group` habría dos rutas de escritura
     * —una encolada y otra directa— y la segunda no dejaría rastro en disco.
     */
    expect(FORM).not.toContain('supabase');
    expect(FORM).not.toContain('rpc(');
    // La única mención a la función escritora es la del comentario que lo dice.
    expect(FORM.match(/create_group/g) ?? []).toHaveLength(1);
    expect(FORM).toContain('* **La acción de abajo no llama a `api.create_group`.**');
    expect(FORM).toContain('onSubmit(draft, currency)');
  });

  it('la acción se apaga sin borrador completo, sin divisa o mientras guarda', () => {
    // Las tres condiciones, en una sola expresión que la interfaz lee.
    // En edición, además, con fila autoritativa: un grupo sin confirmar no se edita.
    // Y con una preestablecida que ya no se puede usar, tampoco: se elige otra.
    expect(FORM).toMatch(
      /const enabled =\s*complete && currency !== null && !saving && edit\?\.pending !== true && !presetUnusable;/,
    );
    expect(FORM).toContain('disabled={!enabled}');
  });

  it('y la ventana se cierra SÓLO con una identidad en la mano', () => {
    /*
     * `create` devuelve la identidad definitiva del grupo si —y sólo si— la
     * clave y el payload quedaron en disco. Sin ella se vuelve sin cerrar, así
     * que el formulario conserva todos sus datos y nada finge que el grupo
     * exista.
     */
    const cierre = WINDOW.slice(WINDOW.indexOf('const groupId = await create('));
    expect(cierre).toContain('if (groupId === null) return false;');
    expect(cierre.indexOf('close();')).toBeGreaterThan(
      cierre.indexOf('if (groupId === null) return false;'),
    );
    expect(WINDOW).toContain('{(close) => (');
  });
});

describe('la primera fila: emoji y nombre', () => {
  it('el disco es el emblema de la hoja, sin el halo exterior', () => {
    expect(FORM).toContain('level="action"');
    expect(FORM).toContain('lens="inner"');
    expect(FORM).toContain('radius={Radius.full}');
  });

  it('el nombre usa el campo establecido, no un estilo propio', () => {
    // Misma superficie que el concepto de un movimiento: control, `well`, pill.
    expect(FORM).toContain('material="control"');
    expect(FORM).toContain('depth="well"');
    expect(FORM).toContain('rim="soft"');
  });

  it('y NO se inventa un límite de longitud', () => {
    /*
     * `core.scope` no tiene columna de nombre todavía —su migración dice que los
     * atributos de Grupo llegan en su fase—, así que no hay contrato del que
     * derivar un tope. Ponerlo aquí sería inventarlo.
     */
    expect(FORM).not.toMatch(/maxLength=/);
  });
});

describe('el selector de emojis', () => {
  it('se monta sólo mientras está abierto, y FUERA de la ventana', () => {
    /*
     * Dentro no cabe: el panel de `SheetWindow` mide lo que mide su contenido y
     * recorta, así que un teclado absoluto de media pantalla salía con altura
     * NEGATIVA — medido en el emulador, el buscador con `h = -73` y sin poder
     * enfocarse. Son hermanos sobre el lienzo de la ruta.
     *
     * Y montado sólo mientras está abierto: así empieza limpio cada vez y su
     * suscripción a Atrás es la última, que es lo que le hace ganar.
     */
    expect(WINDOW).toContain('{picking ? (');
    expect(WINDOW.indexOf('</SheetWindow>')).toBeLessThan(WINDOW.indexOf('<EmojiPicker'));
    expect(FORM).not.toContain('EmojiPicker');
    expect(PICKER).not.toContain('visible');
  });

  it('cierra el teclado de texto al abrirse', () => {
    // Los dos paneles ocupan el mismo sitio: no pueden estar los dos.
    expect(PICKER).toContain('Keyboard.dismiss()');
  });

  it('y Atrás lo cierra a ÉL, no a la ventana', () => {
    expect(PICKER).toContain("BackHandler.addEventListener('hardwareBackPress'");
    expect(PICKER).toContain('return true;');
  });

  it('tiene cuadrícula desplazable, categorías, recientes y buscador', () => {
    expect(PICKER).toContain('<FlatList');
    expect(PICKER).toContain('numColumns={columns}');
    expect(PICKER).toContain('EMOJI_GROUPS.map');
    expect(PICKER).toContain("t('emoji.recent')");
    expect(PICKER).toContain("t('emoji.search')");
  });

  it('un solo toque elige, actualiza y cierra', () => {
    const seleccion = WINDOW.slice(WINDOW.indexOf('onSelect={(chosen)'));
    expect(seleccion).toContain('setEmoji(chosen)');
    expect(seleccion).toContain('remember(chosen)');
    expect(seleccion).toContain('setPicking(false)');
  });

  it('los glifos son los del sistema: no se descarga ninguna imagen', () => {
    expect(PICKER).not.toContain('<Image');
    expect(PICKER).not.toContain('http');
    expect(CATALOGUE).not.toContain('http');
  });
});

describe('la divisa', () => {
  it('NO se presupone ninguna: sale del catálogo real', () => {
    /*
     * Ni `EUR` ni ningún código escrito a mano. El valor por defecto es el del
     * Modo Personal del actor, y mientras no se sepa el apartado lo dice.
     */
    expect(CURRENCY).not.toContain("'EUR'");
    expect(FORM).not.toContain("'EUR'");
    expect(ROUTE).toContain('usePersonalScope');
    expect(ROUTE).toContain("state.status === 'ready'");
    /*
     * Y sale RESUELTA: id, código y escala. Las tres, porque las tres se
     * congelan en el comando y porque `usePersonalScope` las tiene cacheadas —
     * que es lo que permite crear un grupo sin red. Con sólo el id habría que
     * consultar el catálogo para conocer la escala, y presuponerla es justo lo
     * que F02/ADR-001 §3 prohíbe.
     */
    expect(ROUTE).toContain('code: state.currencyCode');
    expect(ROUTE).toContain('scale: state.currencyScale');
  });

  it('cargando se dice, no se rellena', () => {
    expect(CURRENCY).toContain("t('groups.currencyLoading')");
    expect(CURRENCY).toContain("t('groups.currencyUnknown')");
  });

  it('y se puede cambiar antes de crear el grupo', () => {
    /*
     * El desplegable es ahora `CurrencyList`, en `ui/`: lo comparte con el
     * control de moneda de `AmountSheet`, que es por donde F11 elige la moneda
     * de una operación. Elegir sigue llamando a `onSelect` con la opción
     * RESUELTA del catálogo —la lista no conoce la escala, y crear el grupo la
     * necesita (F02/ADR-001 §3)—.
     */
    expect(CURRENCY).toContain('<CurrencyList');
    expect(CURRENCY).toContain('onSelect(full)');
    // La elegida se guarda RESUELTA, no como un id que luego habría que volver
    // a buscar en un catálogo que sin red no llega.
    expect(FORM).toContain('setChosenCurrency(option)');
  });

  it('el catálogo sólo hace falta para elegir OTRA, no para saber cuál hay', () => {
    /*
     * Medido en el emulador con Kong y PostgREST parados: con la divisa
     * representada por un id suelto, el apartado decía «no se ha podido saber tu
     * divisa» y la acción de crear se quedaba apagada. La del Modo Personal viene
     * cacheada con su código y su escala, así que ahora se enseña y se congela
     * sin red, y lo único que exige catálogo es cambiarla.
     */
    expect(CURRENCY).toContain('{selected.code}');
    // En edición manda la divisa REAL del grupo, y no se puede cambiar.
    expect(FORM).toContain(
      'const currency = edit?.currency ?? chosenCurrency ?? personalCurrency;',
    );
    expect(FORM).toContain('locked={edit !== undefined}');
    expect(FORM).toContain('useCurrencies(currency !== null && edit === undefined)');
  });
});

describe('los participantes', () => {
  it('la fila del creador se DERIVA del perfil, no es estado', () => {
    // Guardarla en estado la habría congelado con el nombre que hubiera al
    // montar, y el perfil llega por su cuenta.
    expect(FORM).toContain('const owner = ownerName(displayName);');
    expect(FORM).toContain("{ id: 'owner', name: owner ?? '', owner: true }");
  });

  it('y NO se puede quitar: no existe la acción, no hay guarda que saltarse', () => {
    const creador = FORM.slice(
      FORM.indexOf('if (row.owner) {'),
      FORM.indexOf(
        'return (\n    <View style={styles.participantRow}>\n      <View style={styles.participantColumn}>',
      ),
    );
    expect(creador).not.toContain('onRemove');
    expect(creador).not.toContain('<TextInput');
  });

  it('sin nombre de perfil se dice eso, NUNCA el correo', () => {
    // Una dirección de correo como nombre de participante en un grupo
    // compartido es el dato correlacionable que F03/ADR-009 §1 deja fuera.
    expect(FORM).toContain("t('groups.participantNoName')");
    expect(FORM).not.toContain('email');
    expect(ROUTE).not.toContain('email');
  });

  it('se añaden y se quitan filas, sin tope de interfaz', () => {
    expect(FORM).toContain('addParticipant');
    expect(FORM).toContain('removeParticipant');
    expect(FORM).not.toMatch(/participants\.length\s*[<>]=?\s*\d/);
  });

  it('y los problemas de cada fila salen de la función pura', () => {
    expect(FORM).toContain('participantIssues(participants)');
    expect(FORM).toContain("issue === 'blank'");
  });
});

/**
 * LOS OBLONGOS CONSECUTIVOS.
 *
 * No hay acción de «añadir»: el siguiente campo ya está ahí. La regla del hueco
 * final es pura y se interroga en `tests/lib/group-draft.test.ts`; aquí queda
 * cómo la usa el formulario y lo que se anuncia.
 */
describe('los oblongos de participante', () => {
  it('NO hay botón ni acción de añadir', () => {
    // Ni manejador, ni pulsable propio, ni fila de acción.
    expect(FORM).not.toMatch(/onPress=\{addParticipant\}/);
    expect(FORM).not.toContain('const addParticipant');
    expect(FORM).not.toContain('styles.addRow');
    // La cadena sobrevive como MARCADOR del hueco, que es su nuevo trabajo.
    expect(FORM).toContain("t('groups.addParticipant')");
  });

  it('el hueco final se mantiene con la regla pura, en cada edición', () => {
    expect(FORM.match(/withTrailingBlank\(/g) ?? []).toHaveLength(2);
    expect(FORM).toContain('isTrailingBlank(participants, index)');
  });

  it('las identidades son locales y estables, NUNCA el índice', () => {
    /*
     * Con el índice como identidad, quitar una fila de en medio desplaza a las
     * de abajo y React reutiliza el texto, el error y el foco de una fila en
     * otra. Es el intercambio que la regla 11 nombra.
     */
    expect(FORM).toContain('key={row.id}');
    expect(FORM).not.toMatch(/key=\{index\}/);
    /*
     * Y son UUID, no un contador local: la identidad de la fila ES el
     * `client_participant_id` que se congela en el comando, y la cola rechaza por
     * forma cualquier otra cosa. Medido en el emulador: con `p1`, `p2`, el
     * comando se rechazaba antes de llegar al disco y la ventana se quedaba
     * abierta diciendo que no se pudo guardar.
     */
    expect(FORM).toContain('const nextId = () => newClientOperationId();');
    expect(FORM).toContain("{ id: newClientOperationId(), name: '', owner: false }");
    expect(FORM).not.toContain('useRef(0)');
  });

  it('«Siguiente» valida antes de avanzar, y no cierra el teclado', () => {
    expect(FORM).toContain('returnKeyType="next"');
    expect(FORM).toContain('submitBehavior="submit"');
    expect(FORM).toContain('onSubmitEditing={onSubmit}');
    // Con la fila mal puesta el foco se queda: saltar la dejaría atrás.
    expect(FORM).toContain('if (issues[index] !== null) return;');
  });

  it('el foco se guarda por identidad, no por posición', () => {
    expect(FORM).toContain('fields.current.get(siguiente.id)?.focus()');
    expect(FORM).toContain('fields.current.set(row.id, node)');
  });

  it('el hueco final no se anuncia como si ya hubiera alguien', () => {
    expect(FORM).toContain("t('groups.participantNew')");
    expect(FORM).toContain("t('groups.participantLabel', { position })");
  });

  it('ni lleva error ni control de quitar', () => {
    expect(FORM).toContain('{trailing || aviso === null ? null : (');
    expect(FORM).toContain('{trailing ? (');
  });

  it('y el error queda asociado a SU campo', () => {
    expect(FORM).toContain('accessibilityHint={trailing ? undefined : (aviso ?? undefined)}');
  });

  it('el creador sigue sin campo y sin quitar', () => {
    const creador = FORM.slice(FORM.indexOf('if (row.owner) {'), FORM.indexOf('El aviso viaja'));
    expect(creador).not.toContain('<TextInput');
    expect(creador).not.toContain('onRemove');
  });
});

describe('teclado, desplazamiento y pantallas pequeñas', () => {
  it('la lista se desplaza y conserva su barra', () => {
    expect(FORM).toContain('<ScrollView');
    expect(FORM).not.toContain('showsVerticalScrollIndicator={false}');
  });

  it('tocar otro campo con el teclado abierto no gasta el toque en cerrarlo', () => {
    expect(FORM).toContain('keyboardShouldPersistTaps="handled"');
    expect(PICKER).toContain('keyboardShouldPersistTaps="handled"');
  });

  it('y el área segura la pone quien la conoce, no un margen inventado', () => {
    expect(PICKER).toContain('useSafeAreaInsets');
    expect(PICKER).toContain('insets.bottom');
  });
});

describe('las cadenas existen en los dos idiomas', () => {
  it('el formulario entero', () => {
    for (const key of [
      'groups.createTitle',
      'groups.nameLabel',
      'groups.namePlaceholder',
      'groups.currency',
      'groups.currencyLoading',
      'groups.participants',
      'groups.addParticipant',
      'groups.participantNoName',
      'groups.nameBlank',
      'groups.nameDuplicate',
    ]) {
      expect(ES, key).toContain(`'${key}'`);
      expect(EN, key).toContain(`'${key}'`);
    }
  });

  it('y las nueve categorías de emojis, con nuestra voz', () => {
    for (const key of [
      'emoji.group.smileys',
      'emoji.group.people',
      'emoji.group.nature',
      'emoji.group.food',
      'emoji.group.places',
      'emoji.group.activities',
      'emoji.group.objects',
      'emoji.group.symbols',
      'emoji.group.flags',
    ]) {
      expect(ES, key).toContain(`'${key}'`);
      expect(EN, key).toContain(`'${key}'`);
    }
  });

  it('ninguna frase del formulario está escrita en el componente', () => {
    expect(FORM).not.toContain('Participantes');
    expect(FORM).not.toContain('Añadir participante');
    expect(PICKER).not.toContain('Buscar');
  });
});
