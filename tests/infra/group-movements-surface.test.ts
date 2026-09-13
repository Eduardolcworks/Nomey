import { describe, expect, it } from 'vitest';

import SERVICE from '../../src/features/groups/group-service.ts?raw';
import HOOK from '../../src/features/groups/use-group-movements.ts?raw';
import ROW from '../../src/features/groups/group-movement-row.tsx?raw';
import ORDER from '../../src/features/groups/order-selector.tsx?raw';
import PANEL from '../../src/features/groups/filter-panel.tsx?raw';
import MODEL from '../../src/features/groups/movement-filters.ts?raw';
import SLIDER from '../../src/ui/components/range-slider.tsx?raw';
import EVENTS from '../../src/features/groups/group-events.ts?raw';
import SCREEN from '../../src/app/group/[id].tsx?raw';
import FORM from '../../src/features/groups/shared-expense-form.tsx?raw';
import CHECK from '../../supabase/checks/group-expense-flow.sql?raw';
import LAYOUT_ROOT from '../../src/app/_layout.tsx?raw';
import MIGRATION from '../../supabase/migrations/20260908120000_group_expense_flow.sql?raw';
import MIGRATION_FILTERS from '../../supabase/migrations/20260908130000_group_movement_filters.sql?raw';
import MIGRATION_SPLIT from '../../supabase/migrations/20260908140000_group_split_readable.sql?raw';

/**
 * MOVIMIENTOS DE UN GRUPO: la lista, las tres cifras y el orden.
 *
 * Propiedades **estructurales** sobre el fuente: de dónde sale cada cifra, qué no
 * se suma en el cliente y qué no se convierte en cero. Lo que sólo la base puede
 * demostrar —que los cuatro órdenes ordenan, que el resumen cuadra y que no se
 * fabrica un ingreso— vive en `supabase/checks/group-expense-flow.sql`, y aquí
 * se comprueba que ese fichero sigue afirmándolo.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('el orden lo hace el SERVIDOR, y sobre valores exactos', () => {
  it('son cuatro, y cada uno tiene su nombre en el catálogo', () => {
    // Sobre el fuente y no importando el módulo: `group-service` arrastra el
    // cliente de Supabase y, con él, React Native, que Vitest no transpila.
    expect(code(SERVICE)).toContain(
      "export type GroupOrder = 'dateDesc' | 'dateAsc' | 'amountDesc' | 'amountAsc'",
    );
    expect(code(SERVICE)).toContain(
      "GROUP_ORDERS: readonly GroupOrder[] = [\n  'dateDesc',\n  'dateAsc',\n  'amountDesc',\n  'amountAsc',\n]",
    );

    for (const key of [
      'group.orderDateDesc',
      'group.orderDateAsc',
      'group.orderAmountDesc',
      'group.orderAmountAsc',
    ]) {
      expect(code(ORDER)).toContain(key);
    }
  });

  /**
   * **La fecha del GASTO, no la de sincronización.** Registrar hoy una cena de
   * la semana pasada tiene que colocarla donde ocurrió.
   */
  it('las dos de fecha ordenan por `effective_date` Y por la hora, con nulos al final', () => {
    /*
     * El mismo criterio que Personal (F06/ADR-002 §3): la hora ordena dentro del
     * día y un gasto sin hora cierra su día en los dos sentidos. Nunca
     * `nulls first`, y nunca la sincronización como sustituto de la hora.
     */
    expect(code(SERVICE)).toContain(".order('effective_date', { ascending: false })");
    expect(code(SERVICE)).toContain(
      ".order('effective_time', { ascending: false, nullsFirst: false })",
    );
    expect(code(SERVICE)).toContain(".order('effective_date', { ascending: true })");
    expect(code(SERVICE)).toContain(
      ".order('effective_time', { ascending: true, nullsFirst: false })",
    );
    expect(code(SERVICE)).not.toContain('nullsFirst: true');
    expect(code(SERVICE)).not.toContain(
      "order('operation_created_at', { ascending: false })\n      : ",
    );
  });

  /**
   * **Y las dos de importe, por el ENTERO.** `total_amount` sale como texto
   * porque es dinero exacto; ordenar por él pondría `900` antes que `1500`.
   */
  it('las dos de importe ordenan por `total_order`, nunca por el texto', () => {
    expect(code(SERVICE)).toContain("query.order('total_order', { ascending: false })");
    expect(code(SERVICE)).toContain("query.order('total_order', { ascending: true })");
    expect(code(SERVICE)).not.toContain("order('total_amount'");
    // Y la vista publica esa columna como el entero que es.
    expect(MIGRATION).toContain('ov.original_amount        as total_order');
  });

  /** Dos gastos del mismo día no pueden cambiar de sitio entre dos consultas. */
  it('con desempate estable, siempre', () => {
    const cola = code(SERVICE).slice(
      code(SERVICE).indexOf('const { data, error } = await ordered'),
    );
    expect(cola).toContain("order('operation_created_at', { ascending: false })");
    expect(cola).toContain("order('operation_id', { ascending: true })");
  });

  /** El orden se pide en la CONSULTA: ordenar aquí ordenaría sólo una página. */
  it('y nunca se ordena la página ya traída', () => {
    const lectura = code(SERVICE).slice(
      code(SERVICE).indexOf('export async function fetchGroupOperations'),
    );
    expect(lectura).not.toContain('.sort(');
    for (const fuente of [HOOK, SCREEN, ROW]) {
      expect(code(fuente)).not.toContain('.sort(');
    }
  });
});

describe('las tres cifras salen de un agregado, no de la lista', () => {
  it('el resumen es su propia consulta a `api.group_summary`', () => {
    expect(code(SERVICE)).toContain("from('group_summary')");
    expect(code(SERVICE)).toContain(
      "select('total_amount,your_share,net_position,max_total,expense_count')",
    );
  });

  /**
   * **Sumar la página traída daría un total que parece correcto** y deja de
   * serlo en cuanto PostgREST corte en `max_rows`. Es el mismo defecto que F6.E
   * midió con `PGRST123`, y por eso el agregado vive en SQL.
   */
  it('y nadie las suma en el cliente', () => {
    for (const fuente of [HOOK, SCREEN, ROW]) {
      expect(code(fuente)).not.toContain('.reduce(');
      expect(code(fuente)).not.toContain('+= ');
    }
    expect(MIGRATION).toContain('create view api.group_summary');
    expect(MIGRATION).toContain('sum(e.economic_amount) filter');
  });

  /**
   * **Sin resumen leído se dice «no se sabe», nunca cero.** Cero es una
   * afirmación sobre el dinero de alguien y sólo se hace cuando se ha derivado.
   */
  it('sin leerlo todavía la tarjeta recibe «no disponible», no ceros', () => {
    expect(code(SCREEN)).toContain("? { kind: 'unavailable' }");
    expect(code(SCREEN)).toContain(
      'movements.totals === null ? null : [movements.totals.yourShareMinor]',
    );
    expect(code(SCREEN)).toContain(
      'movements.totals === null ? null : [movements.totals.totalMinor]',
    );
    // La posición ya no sale de la proyección de la lista, que valía cero por
    // estructura: las tres vienen del MISMO agregado y no pueden discrepar.
    expect(code(SCREEN)).not.toContain('groupSummary(group.position)');
  });
});

describe('la lista', () => {
  /**
   * **Cerrada dice quién puso el dinero, y es un hecho LEÍDO.** Sale de
   * `core.split` a través de la vista; no es quien registró la operación —que
   * ni se publica— ni quien tiene cuota ni el usuario actual.
   */
  it('la fila cerrada dice quién pagó, y la fecha', () => {
    expect(code(ROW)).toContain('participants.get(operation.payerParticipantId)');
    expect(code(ROW)).toContain("t('group.paidBy', { name: payerName })");
    expect(code(ROW)).toContain("format.date(operation.effectiveDate, 'short')");
    // Ni el autor ni el usuario actual entran en esa línea.
    expect(code(ROW)).not.toContain('created_by');
    expect(code(ROW)).not.toContain('actorId');
    expect(code(ROW)).not.toContain('isSelf');
  });

  /**
   * **La cifra grande es el gasto entero**, la distinción de `AGENTS.md` §2: la
   * cena costó 10 y quien mira consumió 2,50. La cuota baja al detalle, para que
   * la fila cerrada no ponga dos importes a competir.
   */
  it('y la cuota sólo aparece al desplegar, etiquetada', () => {
    expect(code(ROW)).toContain('money(BigInt(operation.totalMinor), currency)');
    const cabecera = code(ROW).slice(
      code(ROW).indexOf('<Pressable'),
      code(ROW).indexOf('</Pressable>'),
    );
    expect(cabecera).not.toContain('share');
    const detalle = code(ROW).slice(code(ROW).indexOf('{expanded ?'));
    expect(detalle).toContain("t('group.yourPart')");
    // Sin cuota NO se pinta un cero: quien no participó no gastó 0,00.
    expect(detalle).toContain("share === null ? t('group.notInSplit')");
    expect(code(ROW)).not.toContain("'0'");
  });

  /**
   * **El método DECLARADO, no una lectura de las cuotas.** «Igualmente» y «Por
   * partes» pueden resolver a los mismos importes: deducirlo del resultado
   * diría lo que no es.
   */
  it('el detalle enseña el método de reparto declarado', () => {
    expect(code(ROW)).toContain('modeOf(operation.splitMethod)');
    expect(code(ROW)).toContain('t(METHOD_KEY[mode])');
    expect(code(SERVICE)).toContain('splitMethod: row.split_method');
  });

  /**
   * Se despliega y se cierra sin navegar ni remontar la lista, y **los botones
   * de dentro no cierran la fila**: cada uno es su propio `Pressable` y el de la
   * cabecera no los envuelve.
   */
  it('se despliega en el sitio, y sus acciones no lo cierran', () => {
    expect(code(SCREEN)).toContain('expanded={openRow === operation.operationId}');
    expect(code(SCREEN)).toContain('LayoutAnimation.configureNext');
    const detalle = code(ROW).slice(code(ROW).indexOf('{expanded ?'));
    expect(detalle).toContain('<IconButton');
    expect(detalle).not.toContain('onToggle');
  });

  /**
   * **Guardar una corrección cierra la fila.** El desplegable enseña el detalle
   * de una versión; tras corregirla, dejarlo abierto mostraría el detalle viejo
   * hasta que la relectura lo pise. Se cierra por el MISMO aviso que dispara la
   * relectura, para que no haya una segunda forma de enterarse.
   */
  it('deslizar descubre la papelera de Inicio: misma pieza, misma confirmación, y no elimina', () => {
    expect(ROW).toContain('<SwipeToDelete');
    expect(ROW).toMatch(
      /label=\{t\('action\.delete'\)\}\s*enabled\s*busy=\{deleting === true\}\s*onDelete=\{onDelete\}/,
    );
    // La misma puerta que la papelera de la fila desplegada: askDelete, con su Alert.
    expect(ROW.match(/onPress=\{onDelete\}/g) ?? []).toHaveLength(1);
    expect(SCREEN).toMatch(/onDelete=\{\(\) => \{\s*askDelete\(operation\);/);
    expect(SCREEN).toContain(
      "Alert.alert(t('group.deleteExpense'), t('group.deleteExpenseBody'), [",
    );
    // Anulación autoritativa, nunca un borrado físico.
    expect(SCREEN).toContain('void writer.annul(operation)');
    expect(SCREEN).not.toMatch(/\.delete\(\)|\.remove\(/);
    // Y la vía accesible llama a la misma puerta.
    expect(ROW).toContain(
      "accessibilityActions={[{ name: 'delete', label: t('group.deleteExpense') }]}",
    );
  });

  it('y se cierra al escribir en el grupo, por el mismo aviso que relee', () => {
    const pantalla = code(SCREEN);
    const cierre = pantalla.indexOf('subscribeGroupRecorded((changed) => {');
    expect(cierre).toBeGreaterThan(-1);
    expect(pantalla.slice(cierre, cierre + 120)).toContain('if (changed === id) setOpenRow(null);');
  });

  /** El nombre de la categoría se resuelve; jamás se pinta un identificador. */
  it('resuelve la categoría contra el catálogo, sin copiarla en el gasto', () => {
    expect(code(ROW)).toContain("from '@/lib/categories'");
    expect(code(ROW)).toContain('categoryName(category, t)');
    /* El nombre resuelto sigue decidiendo si la categoría se COLOREA: sin nombre
     * que enseñar, el color saldría de un identificador que no sabemos leer. Lo
     * que ya no hay es una línea de texto con él — la ocupa el pagador. */
    expect(code(ROW)).toContain('categoryLabel !== null ? categoryColour(category.id)');
    expect(code(ROW)).not.toContain('operation.categoryId}<');
    /* Lo que se retiró de la fila cerrada es la LÍNEA de la categoría, no la
     * categoría: sigue siendo lo que colorea el círculo y resuelve su icono. */
    expect(code(ROW)).toContain('categoryColour(category.id)');
    expect(code(ROW)).toContain('categorySymbol(iconKey)');
    // Y la vista tampoco denormaliza el nombre: publica el identificador.
    expect(MIGRATION).toContain('ec.category_id');
    expect(MIGRATION).not.toContain('c.message_key as category_name');
  });

  /**
   * **Sin red no hay lista, y se dice.** Un gasto compartido no pasa por la cola
   * durable, así que no hay segunda fuente: enseñar una lista vacía parecería un
   * grupo sin gastos.
   */
  it('no finge un respaldo sin conexión que no existe', () => {
    expect(code(HOOK)).not.toContain('queueStore');
    expect(code(HOOK)).not.toContain('subscribeQueueChanges');
    expect(code(SCREEN)).toContain("t('group.movementsFailed')");
    expect(code(SCREEN)).toContain('movements.retry');
    // Un fallo no vacía lo que ya había.
    expect(code(HOOK)).toContain('if (alive) setFailed(true);');
  });
});

describe('se relee cuando se escribe, y sólo entonces', () => {
  it('el aviso es del ámbito, y no transporta el gasto', () => {
    expect(code(EVENTS)).toContain('publishGroupRecorded(scopeId: string)');
    expect(code(EVENTS)).not.toContain('amount');
    expect(code(HOOK)).toContain('subscribeGroupRecorded((changed) => {');
    expect(code(HOOK)).toContain('if (changed === scopeId)');
  });

  /**
   * **No al recuperar el foco.** Volver de la ventana sin haber guardado —
   * cancelar, el gesto del sistema, el Atrás de hardware— no cambia nada que
   * leer, y consultar entonces sería una petición por cada vez que alguien abre
   * y cierra el `+`.
   */
  it('y no por recuperar el foco', () => {
    for (const fuente of [HOOK, SCREEN]) {
      expect(code(fuente)).not.toContain('useFocusEffect');
    }
  });
});

describe('la categoría de un gasto compartido es de sistema, en los DOS lados', () => {
  it('el selector del grupo sólo ofrece las de Nomey', () => {
    expect(code(FORM)).toContain('sharedCategories(categories.rows)');
    expect(code(FORM)).toContain('categories={shareable}');
  });

  /**
   * **Y si el borrador ya trae una propia, se pide otra.** No se sustituye en
   * silencio: la eligió una persona a propósito, y cambiarla por su cuenta
   * guardaría el gasto clasificado en algo que nadie dijo.
   */
  it('y una propia ya elegida pide cambiarla, sin cambiarla sola', () => {
    expect(code(FORM)).toContain('categoryNotShared');
    expect(code(FORM)).not.toContain('setDraft((d) => ({ ...d, categoryId:');
  });

  /** El servidor exige lo mismo, que es quien manda. */
  it('y el servidor lo vuelve a exigir con su propio código', () => {
    expect(MIGRATION).toContain('create function sec.assert_shared_category_usable');
    expect(MIGRATION).toContain("'CATEGORY_NOT_SHAREABLE'");
    expect(MIGRATION).toContain('if v_owner is not null then');
  });

  /** Y no se abre la RLS de las categorías privadas para conseguirlo. */
  it('sin tocar la RLS de las categorías privadas', () => {
    expect(MIGRATION).not.toContain('policy category_');
    expect(MIGRATION).not.toContain('grant select on core.category');
  });
});

describe('lo que sólo la base puede demostrar, y el check lo afirma', () => {
  it('las presencias se abren al crear, y un reintento no las duplica', () => {
    expect(CHECK).toContain('B1 se esperaban 4 presencias abiertas');
    expect(CHECK).toContain('B3b el reintento dejo');
    expect(CHECK).toContain('B3c el reintento desplazo alguna presencia');
  });

  it('un gasto no fabrica un ingreso para compensar al pagador', () => {
    expect(CHECK).toContain('C5c a alguien le subio la caja con un gasto');
    expect(CHECK).toContain('C5d hay');
    expect(CHECK).toContain('C4b hay');
  });

  it('los cuatro órdenes se comprueban con importes y fechas distintos', () => {
    for (const seccion of ['E1 fecha desc', 'E2 fecha asc', 'E3 importe desc', 'E4 importe asc']) {
      expect(CHECK).toContain(seccion);
    }
    // Y la prueba DISTINGUE ordenar por valor de ordenar por texto.
    expect(CHECK).toContain('E5 ordenar por texto coincide con ordenar por valor');
  });

  /**
   * **El límite temporal queda escrito, no escondido.** Abrir las presencias en
   * `current_date` implica que un gasto anterior a la creación del grupo se
   * rechaza; la alternativa era afirmar que esas personas estaban en el grupo
   * antes de que existiera.
   */
  it('y el límite de fecha de las presencias está medido', () => {
    expect(CHECK).toContain('F1 se acepto un gasto anterior a la creacion del grupo');
    expect(CHECK).toContain('F2 el rechazo dejo reclamada la clave');
  });
});

describe('los dos controles de la lista', () => {
  /**
   * **Dos círculos y no un oblongo**, porque son dos preguntas: filtrar quita
   * filas, ordenar sólo las recoloca. El material es el de siempre — 44 pt, el
   * de `IconButton` y `RoundTrigger`—, sin tokens nuevos ni mapas de bits.
   */
  it('son botones redondos con los símbolos del catálogo, sin estilos nuevos', () => {
    expect(code(SCREEN)).toContain('<IconButton');
    expect(code(SCREEN)).toContain('Symbols.filter');
    expect(code(ORDER)).toContain('Symbols.sort');
    expect(code(ORDER)).toContain('<RoundTrigger');
    // Ni el oblongo de antes ni una altura de píldora en su sitio.
    expect(code(SCREEN)).not.toContain('filterBy');
    expect(code(ORDER)).not.toContain('MenuPill');
    expect(code(ORDER)).not.toContain('PILL_HEIGHT');
  });

  /** Los cuatro nombres salen del catálogo de símbolos, con su par. */
  it('y los dos símbolos declaran su pareja de plataforma', async () => {
    const { Symbols } = await import('../../src/ui/theme/symbols');
    expect(Symbols.filter).toEqual({ ios: 'line.3.horizontal.decrease', android: 'filter_alt' });
    expect(Symbols.sort).toEqual({ ios: 'arrow.up.arrow.down', android: 'swap_vert' });
  });

  /**
   * **Ordenar no toca los filtros ni abre su panel.** Abre directamente su menú
   * del sistema, con el disparador DENTRO — la única disposición que se
   * comprobó que recibe el toque.
   */
  it('ordenar abre su menú y no toca el panel', () => {
    expect(code(ORDER)).toContain('<OptionMenu');
    expect(code(ORDER)).not.toContain('setPanelOpen');
    expect(code(ORDER)).not.toContain('applied');
  });
});

describe('el panel: borrador, confirmación y restablecimiento', () => {
  /**
   * **Dos estados y no uno.** Editar el borrador no cambia los movimientos:
   * quien viaja a la consulta es `applied`, y `draft` es lo que hay tocado
   * dentro del panel. Es lo que permite abrir, mirar y arrepentirse.
   */
  it('lo que se consulta es lo APLICADO, no lo que hay tocado', () => {
    expect(code(SCREEN)).toContain("useGroupMovements(id ?? '', session.status, order, applied)");
    expect(code(SCREEN)).toContain('<FilterPanel');
    expect(code(SCREEN)).toContain('draft={draft}');
    // El panel escribe en el borrador y en nada más.
    expect(code(PANEL)).not.toContain('setApplied');
    expect(code(PANEL)).not.toContain('useGroupMovements');
  });

  it('abrir recupera lo aplicado; confirmar lo sustituye', () => {
    expect(code(SCREEN)).toContain('setDraft(applied);');
    expect(code(SCREEN)).toContain('if (pendingEdit) setApplied(draft);');
  });

  /**
   * El embudo se vuelve tick **en cuanto hay algo que confirmar**, y se compara
   * el borrador con lo aplicado en vez de guardar un «tocado»: mover un extremo
   * y devolverlo a su sitio no cambia nada.
   */
  it('el embudo se vuelve tick, y vuelve a ser embudo', () => {
    expect(code(SCREEN)).toContain('const pendingEdit = panelOpen && !sameFilters(draft, applied)');
    expect(code(SCREEN)).toContain('name={pendingEdit ? Symbols.confirm : Symbols.filter}');
  });

  /**
   * Amarillo cuando hay algo que confirmar y cuando lo aplicado deja gastos
   * fuera; apagado si la selección equivale a enseñarlo todo. Se pregunta por
   * el EFECTO, que es lo que `isUnrestricted` responde.
   */
  it('y el acento sigue al efecto, no al hecho de haber tocado', () => {
    expect(code(SCREEN)).toContain('const appliedFull = isUnrestricted(applied, maxMinor)');
    expect(code(SCREEN)).toContain(
      'colour={pendingEdit || !appliedFull ? theme.accent : undefined}',
    );
  });

  /** Cada acción se anuncia por lo que hace, no por dónde está. */
  it('con etiquetas accesibles distintas para cada acción', () => {
    for (const key of [
      'group.filterApply',
      'group.filterClose',
      'group.filterTitle',
      'group.filterActive',
    ]) {
      expect(code(SCREEN)).toContain(key);
    }
  });

  /** Restablecer devuelve el BORRADOR a todo; aplicar sigue siendo el tick. */
  it('restablecer actúa sobre el borrador y no aplica nada', () => {
    expect(code(PANEL)).toContain('onChange(allOf());');
    expect(code(PANEL)).toContain("t('group.filterReset')");
  });

  /** Empuja el listado: es una tarjeta del scroll, no una capa encima. */
  it('la tarjeta va en el flujo y se abre con una animación de disposición', () => {
    expect(code(SCREEN)).toContain('LayoutAnimation.configureNext');
    expect(code(PANEL)).not.toContain("position: 'absolute'");
    expect(code(PANEL)).not.toContain('<Modal');
    // Y no fija una altura que recorte sus controles.
    expect(code(PANEL)).not.toMatch(/height: \d/);
  });
});

describe('el intervalo de importe', () => {
  /**
   * **La barra decide una posición; la conversión a importe es explícita y
   * acotada.** `ui/` no puede importar `domain/` — y arrastrar un dedo es
   * geometría, que F02/ADR-001 no admite como origen de un valor de registro.
   */
  it('la barra no sabe de dinero, y la conversión vive en un solo sitio', () => {
    expect(code(SLIDER)).not.toContain('bigint');
    expect(code(SLIDER)).not.toContain('@/domain');
    expect(code(MODEL)).toContain('export function minorAt');
    expect(code(PANEL)).toContain('minMinor: minorAt(low, top, steps)');
    expect(code(PANEL)).toContain('maxMinor: high >= steps ? null : minorAt(high, top, steps)');
  });

  /** Y los dos extremos se piden al servidor como enteros, no como texto. */
  it('se acota por la columna entera, con los dos extremos dentro', () => {
    expect(code(SERVICE)).toContain(".gte('total_order', filters.minMinor.toString())");
    expect(code(SERVICE)).toContain(".lte('total_order', filters.maxMinor.toString())");
    expect(code(SERVICE)).not.toContain(".gte('total_amount'");
  });

  /**
   * **El máximo sale del conjunto completo**, no de la página ni del resultado
   * filtrado: si saliera de ahí, elegir una categoría encogería el tope y el
   * intervalo dejaría de tener sentido a mitad de uso.
   */
  it('el máximo viene del resumen sin filtrar, no de la lista', () => {
    expect(MIGRATION_FILTERS).toContain('max_total');
    expect(MIGRATION_FILTERS).toContain('from api.group_operation go');
    expect(code(SCREEN)).toContain('movements.totals?.maxTotalMinor');
    expect(code(SCREEN)).not.toContain('operations.map((o) => o.totalMinor)');
  });

  /** Sin máximo leído no se finge un cero: la barra se apaga. */
  it('un máximo ilegible no se sustituye por cero', () => {
    expect(code(SCREEN)).toContain('return null;');
    expect(code(MODEL)).toContain('if (maxMinor === null || maxMinor <= 0n) return 0;');
    expect(code(PANEL)).toContain('disabled={steps <= 0}');
  });

  /** Los dos extremos se mueven sin arrastrar nada. */
  it('con una vía accesible para los dos extremos', () => {
    expect(code(SLIDER)).toContain('accessibilityRole="adjustable"');
    expect(code(SLIDER)).toContain("{ name: 'increment' }");
    expect(code(SLIDER)).toContain("{ name: 'decrement' }");
  });

  /** Sin dependencias nuevas: la barra está escrita aquí. */
  it('y sin añadir ninguna dependencia', async () => {
    const pkg = JSON.parse((await import('../../package.json?raw')).default);
    for (const nombre of Object.keys(pkg.dependencies)) {
      expect(nombre).not.toMatch(/slider/i);
    }
  });
});

describe('categoría y participante', () => {
  /** Selección única, con su opción de quitar la restricción. */
  it('cada oblongo ofrece «todas» además de las suyas', () => {
    expect(code(PANEL)).toContain("t('group.filterAllCategories')");
    expect(code(PANEL)).toContain("t('group.filterAllParticipants')");
    expect(code(PANEL)).toContain('categoryId: id === ALL ? null : id');
    expect(code(PANEL)).toContain('payerId: id === ALL ? null : id');
  });

  /** El catálogo real de un gasto compartido: sólo las de sistema. */
  it('la categoría usa el catálogo aplicable a lo compartido', () => {
    expect(code(SCREEN)).toContain('sharedCategories(categories.rows)');
    expect(code(SCREEN)).toContain('categories={shareable}');
  });

  /**
   * **Participantes reales, incluidos los que no tienen cuenta.** Un
   * participante existe sin cuenta desde F03/ADR-009 §1, y dejarlos fuera haría
   * imposible filtrar por la mitad de la gente de un viaje.
   */
  it('y el usuario, los participantes del grupo, tengan cuenta o no', () => {
    expect(code(SCREEN)).toContain('useGroupParticipants(');
    expect(code(PANEL)).toContain('participants.map((one)');
    // Nada de vínculos con la cuenta global.
    expect(code(PANEL)).not.toContain('user_id');
    expect(code(PANEL)).not.toContain('participant_user_link');
  });

  /**
   * **EL FILTRO ES POR QUIÉN PAGÓ**, y estuvo siendo por quién participa en el
   * reparto. Un gasto que Marta pagó y que se repartió entre los cuatro salía al
   * filtrar por Sel sólo porque Sel tenía cuota — que no es lo que nadie quiere
   * preguntar. Tampoco es quién lo registró: son tres preguntas distintas sobre
   * el mismo gasto.
   *
   * **Y sólo queda una de las dos interpretaciones.** `participant_ids`
   * desapareció de la vista en vez de convivir con la columna nueva.
   */
  it('el filtro acota por el PAGADOR, y no por quién participa', () => {
    expect(code(SERVICE)).toContain(".eq('payer_participant_id', filters.payerId)");
    expect(code(SERVICE)).not.toContain('participant_ids');
    expect(MIGRATION_SPLIT).toContain('sp.payer_participant_id');
    /* Sobre el SQL, no sobre los comentarios: la nota que explica por qué se
     * retiró la columna la nombra, y esa nota es justamente lo que se quiere. */
    const sql = MIGRATION_SPLIT.split(String.fromCharCode(10))
      .filter((line) => !line.trimStart().startsWith('--'))
      .join(String.fromCharCode(10));
    expect(sql).not.toContain('participant_ids');
    expect(CHECK).toContain('H2 por pagador salen');
  });

  /** Y el nombre accesible dice que lo que se acota es el pagador. */
  it('con una etiqueta accesible que lo aclara', () => {
    expect(code(PANEL)).toContain("t('group.filterPayer')");
    expect(code(PANEL)).toContain("t('group.filterPayerChosen', { name: participantText })");
  });
});

describe('los tres estados, y el conjunto completo', () => {
  /**
   * «Este grupo no tiene movimientos», «ninguno coincide» y «no se pudo leer»
   * son tres cosas distintas. Lo que separa las dos primeras es `expenseCount`,
   * que el resumen publica SIN filtrar.
   */
  it('vacío, sin coincidencias y error se dicen distinto', () => {
    expect(code(SCREEN)).toContain('(movements.totals?.expenseCount ?? 0) > 0');
    expect(code(SCREEN)).toContain("t('group.noMatches')");
    expect(code(SCREEN)).toContain("t('group.noMovements')");
    expect(code(SCREEN)).toContain("t('group.movementsFailed')");
  });

  /** El filtro se aplica ANTES de paginar, y el check lo demuestra con 44. */
  it('se filtra sobre el conjunto, no sobre las filas descargadas', () => {
    expect(CHECK).toContain('G5 en la fila 41 hay');
    expect(CHECK).toContain('G5b filtrado, el mayor es');
    expect(CHECK).toContain('G6 max|cuenta');
  });

  /** Y el resumen NO se filtra: describe el grupo entero. */
  it('el resumen financiero sigue siendo el del grupo completo', () => {
    expect(CHECK).toContain('G6b el total del grupo es');
  });
});

/**
 * «EDITADO» BAJA A LA LÍNEA DE HISTORIA, y la cifra vigente se queda sola.
 *
 * Estaba a la izquierda del importe, en su misma fila, y le robaba el sitio
 * del borde derecho —donde se busca una cifra— en cuanto la tarjeta era
 * estrecha. Ahora la cifra ocupa su línea entera y la historia va debajo:
 * importe anterior tachado y «Editado», juntos cuando hay cambio de importe, y
 * sólo la palabra cuando la edición no lo tocó.
 */
describe('«Editado» debajo del importe', () => {
  it('la cifra vigente va sola en su línea, sin nada a su lado', () => {
    const columna = ROW.slice(
      ROW.indexOf('<View style={styles.amounts}>'),
      ROW.indexOf('</Pressable>'),
    );
    // Ya no existe la fila que juntaba cifra y palabra.
    expect(columna).not.toContain('styles.currentLine');
    expect(ROW).not.toContain('currentLine: {');
    // Y el importe se pinta ANTES que cualquier mención a «Editado».
    expect(columna.indexOf('format.money(total)')).toBeLessThan(
      columna.indexOf("t('group.edited')"),
    );
  });

  it('la línea de historia lleva el tachado y «Editado», y sale con cualquiera de los dos', () => {
    const columna = ROW.slice(
      ROW.indexOf('<View style={styles.amounts}>'),
      ROW.indexOf('</Pressable>'),
    );
    expect(columna).toContain('{edited || previous !== null ? (');
    const historia = columna.slice(columna.indexOf('styles.historyLine'));
    expect(historia.indexOf('format.money(previous)')).toBeLessThan(
      historia.indexOf("t('group.edited')"),
    );
    // Alineada a la derecha y en fila, con el tachado a un solo renglón.
    expect(ROW).toContain("justifyContent: 'flex-end'");
    expect(historia).toContain('numberOfLines={1}');
  });

  it('lo que cede cuando no cabe es el texto de historia, no la cifra', () => {
    expect(ROW).toContain('shrinkable: {');
    expect(ROW).toContain('flexShrink: 1');
    const historia = ROW.slice(ROW.indexOf('styles.historyLine'), ROW.indexOf('</Pressable>'));
    expect((historia.match(/styles\.shrinkable/g) ?? []).length).toBe(2);
  });

  it('y el criterio del importe anterior no cambia: sólo si cambió, y el inmediato', () => {
    expect(ROW).toContain('operation.previousMinor === operation.totalMinor');
    expect(ROW).toContain('const edited = operation.versionNo > 1;');
  });
});

/**
 * EL ARRASTRE DE LA BARRA NO COMPITE CON VOLVER ATRÁS.
 *
 * Dos reconocedores distintos, y dos respuestas distintas: al `ScrollView` de
 * JavaScript se le contesta que no se suelta el responder; al gesto nativo de
 * la pila no se le puede contestar, así que se apaga en la ruta SÓLO mientras el
 * panel está abierto, y se restaura al cerrarlo.
 */
describe('la barra de importes frente al gesto de volver', () => {
  it('la barra no suelta el responder cuando se lo piden', () => {
    expect(SLIDER).toContain('onResponderTerminationRequest={() => false}');
  });

  it('la ruta apaga el gesto de retroceso mientras el panel está abierto, y lo restaura', () => {
    expect(SCREEN).toContain('navigation.setOptions({ gestureEnabled: !panelOpen })');
    // Depende del estado del panel, no es una constante: al cerrar vuelve.
    expect(SCREEN).toMatch(/\}, \[navigation, panelOpen\]\);/);
    // Y no se apaga en ningún otro sitio de la aplicación.
    expect(LAYOUT_ROOT).not.toContain('gestureEnabled');
  });
});
