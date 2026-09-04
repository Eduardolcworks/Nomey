import { describe, expect, it } from 'vitest';

import { Colors } from '../../src/ui/theme/colors';

/**
 * La superficie de Inicio, comprobada sobre el fuente.
 *
 * No hay biblioteca de test de componentes en el proyecto y no se añade una
 * para este bloque. Lo que aquí se afirma son propiedades **estructurales** —de
 * qué frontera sale cada cifra, cuántas consultas se hacen, qué no se adelanta—
 * que un render tampoco demostraría mejor: un snapshot enseñaría píxeles, no
 * que el saldo no se está sumando en el cliente.
 */

const SOURCES = import.meta.glob('../../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const FILES = Object.entries(SOURCES).map(([file, text]) => ({
  path: file.replace('../../src/', ''),
  text: text as string,
}));

function file(relative: string): string {
  const found = FILES.find((candidate) => candidate.path === relative);
  expect(found, `falta ${relative}`).toBeDefined();
  return found!.text;
}

/**
 * El fuente sin comentarios.
 *
 * Hace falta cuando lo que se persigue es un identificador y no una palabra:
 * este dominio **explica** por qué no hay entitlement, así que buscar la
 * palabra en el fichero entero encuentra la explicación y no el defecto. Lo que
 * debe estar ausente es el código.
 */
function code(relative: string): string {
  return file(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const PERSONAL = FILES.filter((candidate) => candidate.path.startsWith('features/personal/'));
const SERVICE = file('features/personal/personal-service.ts');
const HOME = file('app/(tabs)/index.tsx');
const HOOK = file('features/personal/use-personal-home.ts');
const HOME_CODE = code('app/(tabs)/index.tsx');
const ROW = code('features/personal/movement-row.tsx');
const ANNUL = code('features/personal/use-annul-movement.ts');
const SWIPE = code('ui/components/swipe-to-delete.tsx');
const FORM = code('features/personal/movement-form.tsx');
const VENTANA = code('app/add.tsx');
const ALTA = code('features/personal/use-record-movement.ts');
const AJUSTE = code('features/personal/use-adjust-balance.ts');
const EDITOR = code('features/personal/balance-editor.tsx');
const EDICION = code('features/personal/movement-editor.tsx');
const RUTA_MOVIMIENTO = code('app/edit-movement.tsx');
const VENTANA_EDICION = code('features/shell/edit-window.tsx');
/*
 * **La composición compartida por «Editar disponible» y «Editar movimiento».**
 * Compartir `SheetWindow` no las hacía iguales: el armazón era común y el
 * interior no. La fila del importe, el control de moneda, el aviso y el CTA
 * viven ahora en un solo sitio, y estas guardas lo comprueban ahí.
 */
const HOJA = code('features/personal/amount-sheet.tsx');
/*
 * **Corregir un movimiento es su propia pantalla**, no un modo del alta: las
 * dos hacen cosas distintas y comparten las PIEZAS —la composición, los
 * campos, el borrador y el writer—, no el componente.
 */
const CAMPOS = code('features/personal/movement-fields.tsx');
const BORRADOR = code('features/personal/use-movement-draft.ts');
const RUTA_SALDO = code('app/edit-balance.tsx');
const CARD_CODE = code('features/personal/balance-card.tsx');

describe('de dónde salen las cifras', () => {
  /**
   * **El saldo lo deriva el servidor.** Descargar movimientos para sumarlos es
   * exactamente lo que ADR-025 existe para evitar, y con `max_rows = 1000`
   * daría además una cifra incompleta que no falla.
   */
  it('el saldo viene de api.personal_balance', () => {
    expect(SERVICE).toContain("from('personal_balance')");
  });

  it('los totales y el reparto vienen de api.personal_statistics', () => {
    expect(SERVICE).toContain("rpc('personal_statistics'");
  });

  it('la lista viene de api.personal_operation, que es la unidad de producto', () => {
    expect(SERVICE).toContain("from('personal_operation')");
  });

  it('el «Editado» viene de api.personal_operation_version', () => {
    expect(SERVICE).toContain("from('personal_operation_version')");
  });

  it('la observación viene de api.observed_balance', () => {
    expect(SERVICE).toContain("rpc('observed_balance'");
  });

  it('la categoría se resuelve contra api.category y no se denormaliza', () => {
    expect(SERVICE).toContain("from('category')");
  });

  /**
   * `core` no es alcanzable por el cliente —`authenticated` no tiene `USAGE`
   * sobre ese schema— y ninguna consulta debe intentarlo.
   */
  it('ninguna consulta nombra una relación de core', () => {
    for (const source of PERSONAL) {
      expect(source.text, source.path).not.toMatch(/from\('core\.|rpc\('core\./);
      expect(source.text, source.path).not.toContain('current_effect');
    }
  });

  /**
   * Sólo el servicio habla con Supabase. Mismo patrón que `auth-service`, y lo
   * que permite afirmar qué consultas hace la pantalla mirando un solo fichero.
   */
  it('sólo personal-service importa el cliente de Supabase', () => {
    const importers = PERSONAL.filter((source) => source.text.includes("from '@/lib/supabase'"));
    expect(importers.map((source) => source.path)).toEqual([
      'features/personal/personal-service.ts',
    ]);
  });
});

describe('no hay N+1', () => {
  /**
   * Las dos consultas por lote que F6.D dejó como obligación: los predecesores
   * de la página en una `in.(…)`, y las observaciones de la página en una sola
   * llamada con array.
   */
  it('las versiones anteriores se piden por lote, con in.(…)', () => {
    expect(SERVICE).toContain(".in('operation_version_id'");
    expect(SERVICE).toContain('versionIds');
  });

  it('las observaciones se piden por lote, con un array de operaciones', () => {
    expect(SERVICE).toContain('p_operation_ids');
  });

  /**
   * Y el hook las pide **una vez por página**, no una por fila desplegada: un
   * testigo recuerda si ya se pidieron para esta página.
   */
  it('las observaciones se piden una sola vez por página', () => {
    expect(HOOK).toContain('observationsAsked');
    expect(HOOK).toContain('pageToken');
  });

  /**
   * Ninguna consulta cuelga de un `map` sobre las operaciones: sería una
   * llamada por fila.
   */
  it('ninguna consulta se lanza dentro de un recorrido de operaciones', () => {
    for (const source of PERSONAL) {
      expect(source.text, source.path).not.toMatch(/operations\.map\([^)]*fetch/);
      expect(source.text, source.path).not.toMatch(/\.map\(async/);
    }
  });

  /**
   * El saldo y el catálogo no dependen del intervalo, así que cambiar de
   * intervalo no vuelve a pedirlos: viven en su propio efecto.
   *
   * **`actorId` entró en las dependencias con F7.B y no lo contradice.** No
   * cambia al cambiar de intervalo, así que la propiedad que este test protege
   * sigue en pie; lo que sí hace es volver a correr el efecto al cambiar de
   * cuenta, que es exactamente lo que hace falta para que la copia local del
   * catálogo se guarde bajo la identidad correcta (ADR-028 §13). Y `supersede`
   * entró con F7.D: es estable —`useCallback` sin dependencias— así que tampoco
   * puede disparar el efecto. Lo que **no** puede aparecer aquí es `key` ni
   * `range`.
   */
  it('cambiar de intervalo no refetchea el saldo ni el catálogo', () => {
    expect(HOOK).toContain('[ready, attempt, actorId, supersede]');
    expect(HOOK).toContain('[ready, key, attempt]');
    // Lo que hace verdadera la afirmación: el intervalo no entra en el primer
    // efecto por ninguna de sus dos formas.
    expect(HOOK).not.toContain('[ready, attempt, actorId, key]');
    expect(HOOK).not.toContain('[ready, attempt, actorId, range]');
    expect(HOOK).not.toContain('[ready, attempt, actorId, supersede, key]');
    expect(HOOK).not.toContain('[ready, attempt, actorId, supersede, range]');
    // Y `supersede` no depende de nada, así que su identidad no cambia.
    expect(HOOK).toContain('const supersede = useCallback((of: number) => {');
    expect(HOOK).toContain(['    setAttempt((value) => value + 1);', '  }, []);'].join('\n'));
  });
});

describe('lo que no se adelanta', () => {
  /**
   * **Inicio sigue sin escribir**, y ahora la afirmación es más estrecha que
   * antes y hay que decirlo: el dominio SÍ tiene dos funciones de escritura
   * desde que existe la ventana del `+`. Lo que se protege es que la pantalla
   * de lectura no las llame, ni directamente ni a través de sus piezas.
   *
   * `personal-service.ts` queda fuera porque es donde viven a propósito: es la
   * única puerta del dominio a Supabase, y esconderlas en otro sitio para que
   * esta guarda pasara sería empeorar el diseño para contentar a un test.
   */
  it('ninguna función de escritura se invoca desde Inicio', () => {
    const lectores = [
      ...PERSONAL.filter((candidate) => candidate.path !== 'features/personal/personal-service.ts'),
      { path: 'app/(tabs)/index.tsx', text: HOME },
    ];

    for (const source of lectores) {
      /*
       * Sobre el CÓDIGO, no sobre la prosa. Varias de estas piezas explican por
       * escrito a qué función de la frontera acaban llamando, y la explicación
       * no es el defecto: lo que no puede aparecer es la invocación.
       */
      const fuente = source.path === 'app/(tabs)/index.tsx' ? HOME_CODE : code(source.path);
      expect(fuente, source.path).not.toContain("rpc('record_personal_expense'");
      expect(fuente, source.path).not.toContain("rpc('record_personal_income'");
      expect(fuente, source.path).not.toContain("rpc('record_adjustment'");
      expect(fuente, source.path).not.toContain("rpc('annul_operation'");
    }

    // Y las que sí existen se invocan sólo desde donde se registra o se anula,
    // nunca desde el árbol que pinta Inicio.
    expect(code('features/personal/use-record-movement.ts')).toContain('recordPersonalExpense');
    expect(code('features/personal/use-annul-movement.ts')).toContain('annulOperation');
    expect(HOME_CODE).not.toContain('recordPersonal');
    expect(HOME_CODE).not.toContain('annulOperation');
  });

  /**
   * **Ya no queda nada en Inicio que anuncie que no está.** Editar, eliminar y
   * fijar el Disponible hacen su trabajo, así que el aviso de «Próximamente»
   * —y sus dos cadenas— se retiran en vez de quedarse sin consumidor.
   *
   * Lo que sí sigue anunciándose es el calendario, que es Premium y no una
   * pieza sin terminar.
   */
  it('no queda ninguna affordance que anuncie que aún no está', () => {
    expect(HOME_CODE).not.toContain('home.soonBody');
    expect(HOME_CODE).not.toContain('notYet');
    expect(HOME_CODE).toContain('home.calendarPremium');
  });

  /**
   * Premium no se simula. No hay booleano de entitlement en el cliente, que
   * sería justo el hardcode inseguro que no se quiere: el control existe, dice
   * que es Premium, y no comprueba ningún plan.
   */
  it('el calendario dice que es Premium sin fingir un entitlement', () => {
    expect(file('features/personal/interval-selector.tsx')).toContain('home.calendarPremium');
    for (const source of PERSONAL) {
      // Sobre el CÓDIGO, no sobre la prosa: este dominio explica por extenso
      // por qué no hay entitlement, y la explicación no es el defecto.
      expect(code(source.path), source.path).not.toMatch(/isPremium|hasPremium|entitlement/i);
    }
  });
});

describe('provisioning', () => {
  const SCOPE = file('features/personal/use-personal-scope.ts');

  it('llama a api.ensure_personal_scope', () => {
    expect(SERVICE).toContain("rpc('ensure_personal_scope'");
  });

  /**
   * La moneda recomendada sale de la REGIÓN. Usar la del idioma es el error que
   * el handoff señala expresamente.
   */
  it('recomienda la moneda por región y no por idioma', () => {
    expect(SCOPE).toContain('getLocales()');
    expect(SCOPE).not.toContain('languageCurrencyCode');
  });

  /**
   * Sin bucles: el efecto sólo depende del contador de reintentos, y un fallo
   * no vuelve a intentarlo solo.
   */
  it('el provisioning no se reintenta solo', () => {
    // El contador de reintentos y el actor —cuyo respaldo sin red se lee por
    // cuenta (F7.D)—: nada que cambie por render.
    expect(SCOPE).toContain('[attempt, actorId]');
    /*
     * **El vuelo compartido, no un booleano.** Aquí había un `inFlight` que
     * impedía a la segunda invocación del efecto suscribirse: con el doble
     * montaje de React, la que se quedaba con la respuesta era la que la
     * limpieza ya había cancelado, y la viva no estaba suscrita a nada. La
     * pantalla se quedaba en su estado inicial con un 200 en el servidor.
     *
     * Sigue sin reintentarse solo —el efecto sólo depende del contador— y una
     * suscripción cancelada sigue sin escribir. Lo que cambia es que ya no
     * impide a las demás recibir. Su comportamiento está en
     * `tests/lib/scope-flight.test.ts`, con la reproducción del fallo incluida.
     */
    expect(SCOPE).toContain('createScopeFlight');
    // La limpieza cancela la suscripción (y apaga el respaldo en vuelo).
    expect(SCOPE).toContain('subscription.cancel();');
    expect(SCOPE).not.toContain('inFlight');
  });

  /**
   * **Nada se pinta hasta que el ámbito está.** Es el cuarto requisito, y el
   * que evita que la pantalla enseñe ceros de un ámbito que aún no existe.
   */
  it('Inicio bloquea el contenido mientras el ámbito se resuelve', () => {
    expect(HOME).toContain('isResolving(scope.state)');
    expect(HOME).toContain('readyScope(scope.state)');
  });

  /**
   * Cero filas de saldo NO es saldo cero: la vista devuelve siempre una fila.
   * El servicio devuelve `null` para la ausencia, y la tarjeta pinta un
   * marcador sin cifra en vez de un `0`.
   */
  it('la ausencia de saldo no se convierte en cero', () => {
    expect(SERVICE).toContain('return null');
    expect(file('features/personal/balance-card.tsx')).toContain('home.amountPending');
  });
});

describe('estados y accesibilidad', () => {
  /**
   * **Y desde F7.E ya NO contempla un error de datos**, que es la diferencia
   * que hay que proteger. La única causa que podía tener era que el servidor no
   * respondiera, y eso no es algo que la persona pueda arreglar ni tenga que
   * saber: la app sigue guardando, pintando y sincronizando sola. Lo que se
   * conserva es el error del ÁMBITO —sin él no hay dónde poner el dinero— y el
   * indicador de carga, porque esperar no es fallar.
   */
  it('Inicio contempla cargando, ámbito irrecuperable y vacío, pero NO error de datos', () => {
    expect(HOME).toContain('LoadingState');
    expect(HOME).toContain('EmptyState');
    expect(HOME).toContain('onPress: scope.retry');

    // La tarjeta de conectividad y su reintento, fuera.
    expect(HOME).not.toContain('home.dataErrorTitle');
    expect(HOME).not.toContain('home.dataErrorBody');
    expect(HOME).not.toContain('onPress: home.refresh');
    // Y el único ErrorState que queda es el del ámbito.
    expect(HOME.match(/<ErrorState/g)).toHaveLength(1);
    expect(HOME).toContain('home.scopeErrorTitle');
  });

  it('reutiliza los estados existentes en vez de inventar otros', () => {
    for (const source of PERSONAL) {
      expect(source.text, source.path).not.toMatch(/ActivityIndicator/);
    }
  });

  /**
   * Todo lo que se despliega lo anuncia. `accessibilityState.expanded` es lo
   * que convierte un chevron en información para quien no lo ve.
   */
  it.each([
    'features/personal/flow-card.tsx',
    'features/personal/category-card.tsx',
    'features/personal/movement-row.tsx',
  ])('%s anuncia si está desplegado', (relative) => {
    expect(file(relative)).toContain('expanded');
    expect(file(relative)).toContain('accessibilityRole="button"');
  });

  it('el selector de intervalo se anuncia como pestañas seleccionables', () => {
    const selector = file('features/personal/interval-selector.tsx');
    expect(selector).toContain('accessibilityRole="tab"');
    expect(selector).toContain('accessibilityState={{ selected }}');
  });

  /**
   * El color nunca es la única señal (`design-direction.md` §8): el importe
   * lleva signo explícito y «Editado» es una palabra, no un color.
   */
  it('los importes de flujo llevan signo y el editado lleva texto', () => {
    expect(file('features/personal/flow-card.tsx')).toContain("sign: 'always'");
    expect(file('features/personal/movement-row.tsx')).toContain('home.edited');
  });

  /**
   * **Inicio llega entero hasta las píldoras.**
   *
   * Llevaba un `FadeEdge` de `DOCK_HEIGHT` —128 puntos de bandas hasta el negro
   * del fondo— para que el contenido se disolviera bajo el dock en vez de
   * cortarse. Sobre la pantalla se leía como una franja turbia por encima de la
   * barra, y el producto prefiere el corte limpio: el contenido pasa por detrás
   * de las píldoras y ya está.
   *
   * Lo que NO se retira es la reserva de espacio: sin ella la última fila
   * quedaría permanentemente tapada por el dock, que es un defecto de verdad y
   * no de gusto. Lo comprueba la prueba siguiente.
   */
  it('el contenido no se desvanece antes del dock', () => {
    expect(HOME).not.toContain('<FadeEdge');
    expect(HOME).not.toContain('FadeEdge');
  });

  /**
   * Y la pantalla reserva el alto del dock, para que el último elemento pueda
   * llegar a verse entero por debajo del desvanecido.
   */
  it('el scroll reserva el alto del dock y el área segura', () => {
    expect(HOME).toContain('DOCK_HEIGHT + insets.bottom');
  });
});

describe('la versión gratuita', () => {
  /**
   * El servidor devuelve el importe exacto por categoría —la agregación tiene
   * que ser exacta o no sirve— y la tarjeta decide no pintarlo. La decisión
   * vive en la presentación, así que cuando Premium la abra no hay que tocar la
   * frontera.
   */
  it('la tarjeta de categorías pinta el porcentaje y no el importe', () => {
    const card = file('features/personal/category-card.tsx');
    expect(card).toContain('format.percent');
    expect(card).not.toContain('format.money');
  });
});

describe('el selector de ámbito', () => {
  const SWITCH = file('features/shell/scope-context.tsx');

  /**
   * **La regresión de un fallo visto en iPhone**: al pasar a Pareja seguía
   * pintándose la Home de Personal entera. Es el peor fallo posible de un
   * selector de ámbito — cifras reales de un ámbito bajo el nombre de otro, sin
   * que nada falle. `ScopeProvider` ya lo advertía por escrito.
   */
  it('Inicio lee el ámbito activo y no lo ignora', () => {
    expect(HOME).toContain('useScope()');
    expect(HOME).toContain("activeScope === 'personal'");
  });

  it('con Pareja no se pinta ningún contenido de Personal', () => {
    // La puerta va ANTES de cualquier rama de Personal, incluida la de
    // provisioning: con Pareja no debe verse ni «Preparando tu Modo Personal».
    const gate = HOME.indexOf('!personal ?');
    const resolving = HOME.indexOf('isResolving(scope.state)');
    expect(gate).toBeGreaterThan(-1);
    expect(resolving).toBeGreaterThan(gate);
  });

  /**
   * Y no se consulta nada de Personal mientras Pareja está activo: el hook
   * recibe `false` y sus efectos salen antes de pedir nada.
   */
  it('con Pareja no se lanzan consultas personales', () => {
    // `actorId` se añadió en F7.B para la copia local del catálogo, y no toca
    // esta guarda: la que apaga las consultas sigue siendo la misma condición.
    expect(HOME).toContain('usePersonalHome(ready !== null && personal, range, actorId)');
  });

  /**
   * El provisioning SÍ sigue montado: asegura el Modo Personal de la cuenta y
   * no depende de qué pestaña se mire. Es idempotente por estado.
   */
  it('el provisioning no depende del selector', () => {
    // Recibe el ACTOR —para el respaldo del ámbito sin red (F7.D)— y nunca el
    // selector Personal/Pareja: provisionar no depende de qué pestaña se mira.
    expect(HOME).toMatch(/const scope = usePersonalScope\(actorId\);/);
    expect(HOME).not.toMatch(/usePersonalScope\([^)]*(activeScope|personal)[^)]*\)/);
  });

  /**
   * Pareja sigue declarada como no disponible, y su rama no pinta NADA: ni
   * contenido, ni datos inventados, ni una llamada a Premium que nadie ha
   * diseñado. Se comprueba que la rama es la cabecera y un contenedor vacío, no que la
   * palabra «premium» no aparezca — el aviso del calendario sí es legítimo y
   * está decidido.
   *
   * **La cabecera sí está**, y tiene que estarlo: con Pareja activo el selector
   * es lo único que permite volver a Personal.
   */
  it('Pareja sigue sin estar disponible y su rama no pinta nada', () => {
    expect(SWITCH).toContain('couple: false');
    const home = code('app/(tabs)/index.tsx');
    const rama = home.slice(home.indexOf('!personal ? ('), home.indexOf(') : isResolving'));
    expect(rama).toContain('{greeting}');
    expect(rama).toContain('<View style={styles.centre} />');
    // Y nada más por debajo del selector: ni tarjetas, ni avisos.
    expect(rama).not.toContain('Card');
    expect(rama).not.toContain('premium');
  });
});

describe('la tarjeta de Disponible', () => {
  const CARD = file('features/personal/balance-card.tsx');

  /**
   * Mismo material que las demás tarjetas. Era una `GlassSurface`, que sobre el
   * negro se leía como un gris claro y hacía que la tarjeta principal pareciera
   * de otro sistema. La jerarquía la da la cifra, no el fondo.
   */
  it('la tarjeta usa el mismo fondo que las demás y el glass queda para el sub-bloque', () => {
    // La TARJETA es plana y oscura como Ingresos/Gastos o Categorías. El glass
    // aparece una sola vez, y dentro: es el sub-bloque de Deudas.
    expect(CARD).toContain('backgroundColor: homeCardSurface(theme.surface)');
    expect(CARD).toContain('borderColor: theme.border');
    // Una sola apertura: el glass aparece exactamente una vez, y es el oblongo.
    expect(CARD.match(/<GlassSurface/g)).toHaveLength(1);
  });

  /**
   * El sub-bloque de Deudas: contiene, luego glass — `design-direction.md` §4.
   * Y `depth="flat"` porque el neumorfismo de §5 es para controles que
   * responden, y éste no responde a nada.
   */
  it('la deuda vive en un sub-bloque que contiene y no parece un control', () => {
    expect(CARD).toContain('depth="flat"');
    expect(CARD).toContain('radius={Radius.md}');
    // Ni interactivo ni anunciado como tal.
    // Sobre el CÓDIGO: el comentario explica que NO lleva `Pressable`.
    const source = code('features/personal/balance-card.tsx');
    expect(source).not.toContain('Pressable');
    expect(source).not.toContain('accessibilityRole');
  });

  /** La etiqueta manda sobre la cifra: va encima, y las dos a la izquierda. */
  it('la etiqueta precede a la cifra y la cifra no va centrada', () => {
    expect(CARD.indexOf("t('home.available')")).toBeLessThan(CARD.indexOf('amountHero'));
    expect(CARD).not.toContain("textAlign: 'center'");
  });

  /**
   * **Dos columnas paralelas**, no una esquina compartida: Disponible a la
   * izquierda, Deudas a la derecha, y las dos etiquetas a la misma altura — que
   * es lo que iguala `LABEL_ALIGN` compensando el relleno del oblongo.
   */
  it('las dos magnitudes se leen como columnas paralelas', () => {
    expect(CARD).toContain("flexDirection: 'row'");
    expect(CARD).toContain("alignItems: 'flex-start'");
    expect(CARD).toContain('const LABEL_ALIGN');
    expect(CARD).toMatch(/paddingTop: LABEL_ALIGN/);
    expect(CARD).toMatch(/paddingVertical: LABEL_ALIGN/);
  });

  /**
   * El amarillo de marca, que aquí es identidad y no decoración: es la única
   * cifra que responde «cuánto tengo». Medido en `colors.ts`: 13,2:1.
   */
  it('la cifra usa el acento de Nomey', () => {
    expect(CARD).toContain('themeColor="accent"');
  });

  /** Y la ausencia sigue sin pintarse como cero. */
  it('un saldo que aún no se puede afirmar no se pinta como 0', () => {
    expect(CARD).toContain('home.amountPending');
    expect(CARD).toContain('amount === null');
  });

  /**
   * El lápiz, en su círculo y abajo a la derecha. Sin contenedor flotaba en
   * mitad de la tarjeta sin nada que dijera que era un control, y
   * `design-direction.md` §8 no admite una affordance sostenida por un glifo.
   */
  it('el lápiz es un botón circular en el pie de la tarjeta', () => {
    expect(CARD).toContain('filled');
    expect(CARD).toContain("t('home.adjustBalance')");
    expect(CARD).toContain("alignSelf: 'flex-end'");
  });

  /**
   * **En flujo, no flotando.** Con posición absoluta la composición se rompe en
   * cuanto alguien agranda el tipo de letra del sistema: deuda y lápiz se
   * montarían sobre la cifra. En flujo el solapamiento es imposible por
   * construcción, y eso es lo que exige la regla de accesibilidad.
   */
  it('nada se posiciona en absoluto, así que nada puede solaparse', () => {
    expect(code('features/personal/balance-card.tsx')).not.toContain("position: 'absolute'");
  });

  /**
   * El bloque de Deudas: encima del lápiz, pequeño, y con su etiqueta al lado
   * para que la cifra nunca aparezca sin lo que la nombra.
   */
  /**
   * El lápiz deja de compartir esquina con la deuda: la deuda arriba a la
   * derecha, el lápiz solo abajo. Y la cifra de deuda tiene presencia sin
   * disputarle la jerarquía al Disponible.
   */
  it('la deuda está arriba y el lápiz solo abajo, sin competir', () => {
    expect(CARD.indexOf("t('home.debts')")).toBeLessThan(CARD.indexOf("t('home.adjustBalance')"));
    expect(CARD).toContain('variant="amountRow" themeColor={debtTone(debtMinor)}');
    expect(CARD).toContain("alignSelf: 'flex-end'");
  });

  /**
   * **El `0,00 €` es un marcador de posición de INTERFAZ**, decidido para F6.E.
   * No sale de ninguna consulta, no se deriva de nada, y no entra en ningún
   * cálculo — se comprueba que la tarjeta no lo mezcla con el saldo.
   */
  it('el cero de deuda es un marcador nombrado, no un dato derivado', () => {
    expect(CARD).toContain('DEBT_PLACEHOLDER');
    expect(SERVICE).not.toContain('debt');
    // Y no se cruza con el Disponible por ninguna vía.
    expect(CARD).not.toMatch(/debtMinor\s*[+\-]/);
    expect(CARD).not.toMatch(/amount.*[+\-].*debt/);
  });

  /**
   * La semántica de color queda escrita para F9 y se aplica al valor que la
   * tarjeta tiene en la mano — hoy, el marcador, que es cero y sale en blanco.
   * No hay un blanco escrito a mano en ninguna parte.
   */
  it('la regla de color de la deuda queda preparada para F9', () => {
    expect(CARD).toContain('export function debtTone');
    expect(CARD).toMatch(/minor < 0n\) return 'negative'/);
    expect(CARD).toMatch(/minor > 0n\) return 'positive'/);
    expect(CARD).toMatch(/return 'text'/);
    // F9 sólo tiene que pasar el dato: la prop ya existe.
    expect(CARD).toContain('readonly debt?: string;');
  });

  /** Y sigue sin escribir nada: ajustar el saldo es de F6.F. */
  it('sigue siendo sólo affordance', () => {
    expect(CARD).not.toContain('record_adjustment');
    expect(CARD).not.toContain('supabase');
  });
});

describe('el selector de intervalo', () => {
  const SELECTOR = file('features/personal/interval-selector.tsx');

  /**
   * **Ancho intrínseco.** Con `flex: 1` el grupo se estiraba hasta el borde y
   * empujaba el calendario al extremo derecho, dominando la pantalla por tamaño
   * en vez de por importancia.
   */
  it('ni el grupo ni las opciones se estiran', () => {
    expect(SELECTOR).not.toMatch(/group:\s*\{[^}]*flex:\s*1/);
    expect(SELECTOR).not.toMatch(/option:\s*\{[^}]*flex:\s*1/);
    expect(SELECTOR).toContain("alignSelf: 'flex-start'");
    expect(SELECTOR).toContain("justifyContent: 'flex-start'");
  });

  /**
   * Compactar lo que se ve no puede compactar lo que se toca: el círculo baja a
   * 40 y el `hitSlop` devuelve el objetivo a 48; cada opción conserva 40 de
   * alto, y el grupo 44 con su propio padding.
   */
  it('las zonas táctiles no bajan del mínimo', () => {
    expect(SELECTOR).toContain('minHeight: 40');
    expect(SELECTOR).toContain('hitSlop={Spacing.xs}');
    expect(SELECTOR).toContain('const CALENDAR = 40');
  });

  /** Y el calendario sigue anunciándose como Premium, sin fingir entitlement. */
  it('el calendario sigue siendo circular y Premium', () => {
    expect(SELECTOR).toContain('borderRadius: Radius.full');
    expect(SELECTOR).toContain('home.calendarPremium');
  });
});

describe('las tarjetas de Ingresos y Gastos', () => {
  const FLOW = file('features/personal/flow-card.tsx');

  /**
   * **La exclusividad es del estado, no del layout.** Un único valor
   * `'income' | 'expense' | null` la garantiza por construcción: no hay dos
   * booleanos que puedan estar a true a la vez.
   */
  it('un solo estado gobierna cuál está abierta', () => {
    expect(HOME).toContain("useState<'income' | 'expense' | null>(null)");
    expect(HOME).toMatch(/current === kind \? null : kind/);
  });

  /**
   * **EL ACOLCHADO VERTICAL ES DE LA FILA, NO DE LA TARJETA**, y por eso el
   * cuerpo no pone ninguno de los dos.
   *
   * Aquí hubo un `paddingBottom` sin su pareja de arriba, que es la forma de la
   * equivocación: daba por hecho que `MovementRow` sólo acolchaba por arriba, y
   * acolcha por los dos lados. Salía `sm` sobre la primera fila y `sm` + `sm`
   * bajo la última — la franja vacía que se veía al bajar hasta el final.
   *
   * Se afirma la causa, no el hueco: que el cuerpo no reponga acolchado
   * vertical y que la fila siga trayendo el suyo. Y que no se tapa con un
   * margen negativo ni recortando la altura.
   */
  it('el cuerpo no repone el acolchado vertical que ya traen las filas', () => {
    // Sobre el CÓDIGO, no sobre la prosa: el comentario que explica por qué no
    // hay acolchado nombra los estilos que no están.
    const flowCode = code('features/personal/flow-card.tsx');
    const cuerpo = flowCode.slice(
      flowCode.indexOf('body: {'),
      flowCode.indexOf('},', flowCode.indexOf('body: {')),
    );
    expect(cuerpo).toContain('paddingHorizontal');
    expect(cuerpo).not.toContain('paddingBottom');
    expect(cuerpo).not.toContain('paddingTop');
    expect(cuerpo).not.toContain('paddingVertical');

    // Quien lo trae, y por los DOS lados: de ahí que arriba y abajo midan igual.
    expect(code('features/personal/movement-row.tsx')).toContain('paddingVertical: Spacing.sm');

    // Y una fila desplegada acolcha lo suyo, así que sus acciones no se recortan.
    expect(code('features/personal/movement-row.tsx')).toContain('paddingBottom: Spacing.md');

    // Sin taparlo: ni margen negativo ni altura fijada.
    expect(FLOW).not.toContain('marginBottom: -');
    expect(FLOW).not.toContain('marginTop: -');
    expect(FLOW).not.toContain('height:');
  });

  /**
   * Cerradas comparten fila; abierta, la pareja **deja de renderizarse** y la
   * abierta se dibuja sola, a ancho completo.
   */
  it('cerradas van en fila y abierta va sola', () => {
    expect(HOME).toMatch(/openFlow === null \? \(/);
    expect(HOME).toContain("flowCard('income')");
    expect(HOME).toContain("flowCard('expense')");
    expect(HOME).toContain('flowCard(openFlow)');
  });

  /**
   * Las dos formas salen de la MISMA descripción. Escritas dos veces, la de
   * abajo se quedaría atrás en cuanto una de ellas cambiara.
   */
  it('la fila y el ancho completo se dibujan desde la misma descripción', () => {
    expect(HOME.match(/<FlowCard/g)).toHaveLength(1);
  });

  /**
   * **`flex: 1` sólo cerrada.** Abierta la renderiza la pantalla sola, en una
   * columna, y ahí `flex: 1` la estiraría hasta el alto disponible en vez de
   * dejarla crecer con su contenido.
   */
  it('sólo reparte ancho cuando comparte fila', () => {
    expect(FLOW).toMatch(/expanded \? null : styles\.half/);
    expect(FLOW).toMatch(/half: \{\s*flex: 1,?\s*\}/);
    expect(FLOW).not.toMatch(/card: \{\s*flex: 1/);
  });

  /**
   * La lista va DENTRO de la propia tarjeta, debajo de su cabecera — no en un
   * bloque aparte.
   */
  it('los movimientos viven dentro de la tarjeta, bajo su cabecera', () => {
    expect(FLOW.indexOf('styles.header')).toBeLessThan(FLOW.indexOf('styles.body'));
    expect(FLOW).toMatch(/\{expanded \? \(\s*<View style=\{\[styles\.body/);
  });

  /**
   * Y la fila no iguala alturas: `flex-start` en el eje cruzado, así que la
   * cerrada nunca se estira al alto de la otra. Estaba ya bien y se fija para
   * que siga estándolo.
   */
  it('la fila no estira la tarjeta cerrada al alto de su pareja', () => {
    expect(HOME).toMatch(/flows: \{[^}]*alignItems: 'flex-start'/s);
  });
});

describe('la tarjeta de categorías', () => {
  const CAT = file('features/personal/category-card.tsx');
  const STATS = file('features/personal/statistics.ts');

  /**
   * El indicador de la lista y su sector salen de **la misma llamada con el
   * mismo argumento**, así que no pueden discrepar. No hay dos tablas de
   * colores que mantener sincronizadas.
   */
  it('el sector y su indicador usan el mismo color por construcción', () => {
    expect(CAT.match(/categoryColour\(slice\.categoryId\)/)).not.toBeNull();
    expect(CAT.match(/categoryColour\(slices\[index\]\.categoryId\)/)).not.toBeNull();
    // Y ninguna paleta local que pudiera divergir de la del tema.
    expect(CAT).not.toMatch(/const \w*[Pp]alette\s*=/);
    expect(CAT).not.toMatch(/theme\.(accent|positive|negative)/);
  });

  /**
   * **Top 4 arriba, resto debajo, mismo orden.** La expansión amplía la lista;
   * no sustituye las cuatro primeras.
   */
  it('desplegar amplía la lista en vez de reemplazarla', () => {
    expect(CAT).toContain('splitTop(slices)');
    expect(CAT).toMatch(/const visible = expanded \? slices : top;/);
    expect(STATS).toContain('export const TOP_CATEGORIES = 4');
  });

  /**
   * Con cuatro o menos no se pinta chevron: una flecha inerte promete contenido
   * que no existe.
   */
  it('sin nada que desplegar no ofrece flecha', () => {
    expect(CAT).toMatch(/const expandable = rest\.length > 0;/);
    expect(CAT).toMatch(/\{expandable \? \(/);
  });

  /** Y cuando la ofrece, se anuncia y se toca bien. */
  it('la flecha se anuncia y tiene área táctil', () => {
    expect(CAT).toContain('accessibilityState={{ expanded }}');
    expect(CAT).toContain('hitSlop={Spacing.md}');
  });

  /**
   * **Sin gasto no hay reparto.** No se pintan cuatro categorías al 0%, que
   * serían cuatro afirmaciones falsas.
   */
  it('total cero da estado vacío, no porcentajes inventados', () => {
    expect(CAT).toMatch(/slices\.length === 0/);
    expect(CAT).toContain('home.categoriesEmpty');
    expect(STATS).toMatch(/if \(total <= 0n\) return \[\];/);
  });

  /**
   * El orden viene resuelto del servidor —mayor a menor, con desempate por
   * identificador— y aquí no se reordena: dos opiniones sobre el mismo dato
   * divergen.
   */
  it('no reordena el reparto que llega del servidor', () => {
    expect(code('features/personal/statistics.ts')).not.toMatch(/\.sort\(/);
    expect(code('features/personal/category-card.tsx')).not.toMatch(/\.sort\(/);
  });

  /** Versión gratuita: porcentaje sí, importe por categoría no. */
  it('no muestra el importe por categoría', () => {
    expect(CAT).toContain('format.percent');
    expect(CAT).not.toContain('format.money');
  });

  /**
   * El gráfico no es un canal de información por sí solo: queda oculto a
   * accesibilidad y lo autoritativo es la lista, que lleva nombre y porcentaje.
   */
  it('el gráfico se oculta a accesibilidad y manda la lista', () => {
    expect(CAT).toContain('accessibilityElementsHidden');
    expect(CAT).toMatch(/accessibilityLabel=\{`\$\{label\} \$\{share\}`\}/);
  });

  /**
   * **Sectores, no anillo de actividad.** El hueco es una fracción pequeña del
   * diámetro, así que las proporciones se aprecian por área y no sólo por arco.
   */
  it('es un anillo fino, no un sector macizo', () => {
    expect(CAT).toMatch(/const DIAMETER = \d+/);
    expect(CAT).toMatch(/const HOLE = \d+/);
    const diameter = Number(/const DIAMETER = (\d+)/.exec(CAT)?.[1]);
    const hole = Number(/const HOLE = (\d+)/.exec(CAT)?.[1]);

    /*
     * El hueco pasó del 27% al 65% del diámetro. Estuvo por debajo del 35% a
     * propósito —un hueco pequeño hace comparables sectores parecidos— y se
     * cambió mirándolo: el gráfico pesaba demasiado al lado de la lista, que es
     * la que lleva nombre y porcentaje y es la representación autoritativa.
     *
     * La horquilla no fija el valor exacto, que es una decisión visual. Fija
     * que sigue siendo un ANILLO: ni una moneda con un agujero de alfiler, ni
     * un hilo del que no se distinga el color.
     */
    expect(hole / diameter).toBeGreaterThan(0.55);
    expect(hole / diameter).toBeLessThan(0.75);

    // Y el grosor del aro sigue dando para leer el color de cada sector.
    expect((diameter - hole) / 2).toBeGreaterThanOrEqual(16);
  });

  /**
   * **El diámetro exterior no se mueve.** Es lo que fija la altura del bloque y
   * su alineación con la lista; aligerar el aro no debía encoger el gráfico.
   */
  it('el tamaño exterior del gráfico no cambia', () => {
    expect(CAT).toContain('const DIAMETER = 124');
  });

  /**
   * **Cada sector barre hasta el final y el siguiente lo tapa.** Es lo que
   * elimina las costuras entre sectores contiguos sin mover ni un grado el
   * reparto: la frontera de cada porción la marca el inicio de la siguiente.
   */
  it('pinta por superposición, no con ángulos solapados', () => {
    expect(CAT).toMatch(/sweep=\{360 - angle\.start\}/);
    // Nada de inflar el ángulo para tapar la juntura, que sí falsearía la proporción.
    expect(CAT).not.toMatch(/sweep \+ \d/);
  });
});

/**
 * DOS NIVELES ARRIBA, Y SÓLO UNO SE MUEVE.
 *
 * `AppTopBar` —la marca, las notificaciones y el perfil— identifica la
 * aplicación y se queda fija. `HomeGreeting` —el saludo y el selector de
 * ámbito— dice de quién es el dinero que se está mirando, que es una pregunta
 * del contenido, así que entra en el scroll y sube con el saldo hasta
 * desaparecer por arriba.
 *
 * **Estuvieron en un solo componente**, y con ellos juntos sólo había dos
 * resultados posibles y los dos malos: o se quedaba todo clavado, o se
 * desplazaba todo. Separarlos es lo que hace que cada uno haga lo suyo, y estas
 * guardas fijan el reparto — incluidas las vías por las que una pieza vuelve a
 * quedarse fija sin decirlo.
 *
 * No hay biblioteca de render, así que esto son propiedades estructurales, y
 * ninguna coordenada de ningún modelo de teléfono. La validación física se mira
 * en el aparato.
 */
describe('la barra superior se queda, el saludo sube', () => {
  it('la barra superior vive FUERA del ScrollView', () => {
    const home = code('app/(tabs)/index.tsx');
    expect(home.indexOf('<AppTopBar ')).toBeGreaterThan(0);
    expect(home.indexOf('<AppTopBar ')).toBeLessThan(home.indexOf('<ScrollView'));

    // Y no se ha colado dentro del contenido desplazable.
    const scroll = home.slice(home.indexOf('<ScrollView'), home.indexOf('</ScrollView>'));
    expect(scroll).not.toContain('AppTopBar');

    // Está una sola vez, por encima de las cuatro ramas: no depende de ninguna.
    expect(home.match(/<AppTopBar/g) ?? []).toHaveLength(1);
  });

  it('y el saludo con el selector vive DENTRO', () => {
    const home = code('app/(tabs)/index.tsx');
    const scroll = home.slice(home.indexOf('<ScrollView'), home.indexOf('</ScrollView>'));
    expect(scroll).toContain('{greeting}');
    expect(home).toContain('const greeting = <HomeGreeting name={greetingName} />');
    // Y es el primer elemento del contenido, por delante del saldo.
    expect(scroll.indexOf('{greeting}')).toBeLessThan(scroll.indexOf('<BalanceCard'));
  });

  /**
   * Las vías por las que algo vuelve a quedarse fijo sin que lo parezca.
   * Ninguna está, y estar ausentes es la decisión.
   */
  it('el saludo no se ha fijado por ninguna vía indirecta', () => {
    const home = code('app/(tabs)/index.tsx');
    const saludo = code('features/shell/home-greeting.tsx');
    for (const fuente of [home, saludo]) {
      expect(fuente).not.toContain('stickyHeaderIndices');
      expect(fuente).not.toContain('stickyHeader');
      expect(fuente).not.toContain("position: 'absolute'");
      expect(fuente).not.toContain('zIndex');
    }
  });

  /**
   * **El saludo sigue en las cuatro ramas**, y eso no lo devuelve a la barra:
   * Pareja, provisionando y el error de ámbito no tienen scroll del que formar
   * parte. Con Pareja activo el selector es además lo ÚNICO que permite volver
   * a Personal.
   */
  it('las cuatro ramas conservan el saludo, con una sola descripción', () => {
    const home = code('app/(tabs)/index.tsx');
    expect(home.match(/<HomeGreeting/g) ?? []).toHaveLength(1);
    expect(home.match(/\{greeting\}/g) ?? []).toHaveLength(4);
  });

  /**
   * **El saludo y el selector son UN bloque, no dos piezas que coinciden.**
   * Cuando se desplaza uno se desplaza el otro, porque son la misma fila.
   */
  it('el saludo y el selector están en el mismo bloque', () => {
    const saludo = code('features/shell/home-greeting.tsx');
    expect(saludo).toContain('home.greeting');
    expect(saludo).toContain('<ScopeSwitch />');
    expect(saludo.indexOf('home.greeting')).toBeLessThan(saludo.indexOf('<ScopeSwitch'));
  });

  /** Una sola implementación de cada pieza, en toda la aplicación. */
  it('no hay una segunda copia de ninguna de las dos', () => {
    const selector = FILES.filter((f) => f.text.includes('<ScopeSwitch')).map((f) => f.path);
    expect(selector).toEqual(['features/shell/home-greeting.tsx']);

    const campana = FILES.filter((f) => f.text.includes('name={Symbols.notifications}')).map(
      (f) => f.path,
    );
    expect(campana).toEqual(['features/shell/app-top-bar.tsx']);

    const barra = FILES.filter((f) => f.text.includes('export function AppTopBar')).map(
      (f) => f.path,
    );
    expect(barra).toEqual(['features/shell/app-top-bar.tsx']);
  });

  /** Y la barra no ha heredado nada específico de Inicio al separarse. */
  it('la barra superior sigue siendo compartida y genérica', () => {
    const barra = code('features/shell/app-top-bar.tsx');
    expect(barra).not.toContain('ScopeSwitch');
    expect(barra).not.toContain('useScope');
    // La usan los dos destinos raíz, con la misma implementación, y desde F7.E
    // los dos le pasan el aviso de la campana: un indicador que sólo estuviera
    // en uno haría depender de la pestaña el encontrar algo sin resolver.
    expect(code('app/(tabs)/groups.tsx')).toContain('<AppTopBar title="groups.title" alerts=');
    expect(code('app/(tabs)/index.tsx')).toContain('<AppTopBar alerts=');
  });

  /**
   * Dónde se renderiza no cambia de dónde sale su estado: sigue siendo el
   * provider, y el selector no guarda ninguna copia propia que pudiera
   * contradecirlo.
   */
  it('el selector conserva su única fuente de estado', () => {
    const selector = code('features/shell/scope-switch.tsx');
    expect(selector).toContain('const { scope, setScope } = useScope()');
    expect(selector).not.toContain('useState');
  });

  /** Notificaciones y perfil siguen navegando a lo mismo, desde la barra. */
  it('notificaciones y perfil no cambian de destino', () => {
    const barra = code('features/shell/app-top-bar.tsx');
    expect(barra).toContain("router.push('/notifications')");
    expect(barra).toContain("router.push('/profile')");
    /*
     * El nombre accesible sigue saliendo del catálogo. Desde F7.E la campana
     * añade el aviso cuando hay algo sin resolver, porque un punto no le dice
     * nada a un lector de pantalla; lo que no hace es dejar de nombrarse.
     */
    expect(barra).toContain("t('nav.notifications')");
    expect(barra).toContain("t('incident.pending')");
    expect(barra).toContain("label={t('nav.profile')}");
  });

  /**
   * **El área segura se aplica una vez, por encima de todo.** El `SafeAreaView`
   * envuelve la barra y el scroll, así que la barra queda bajo el notch donde
   * estaba y nadie suma un inset por su cuenta.
   */
  it('el inset superior lo pone el área segura, una sola vez', () => {
    const home = code('app/(tabs)/index.tsx');
    expect(home.indexOf('<SafeAreaView')).toBeLessThan(home.indexOf('<AppTopBar'));
    expect(home).toContain("edges={['top', 'left', 'right']}");
    expect(home.match(/edges=/g) ?? []).toHaveLength(1);
    expect(home).not.toContain('insets.top');
    expect(code('features/shell/app-top-bar.tsx')).not.toContain('insets');
  });

  /**
   * **Cada capa pone su separación una vez, y ninguna se compensa.** La barra
   * separa de lo que viene debajo, el saludo separa de `Disponible`, y `body`
   * pone el relleno lateral y el hueco entre tarjetas. El contenedor del scroll
   * no pone nada: si lo pusiera, el saludo se metería hacia dentro y la
   * distancia hasta la primera tarjeta pasaría de `md` a `md + lg`.
   */
  it('ninguna separación se cuenta dos veces', () => {
    const home = code('app/(tabs)/index.tsx');
    const contenedor = home.slice(
      home.indexOf('contentContainerStyle'),
      home.indexOf('<View style={styles.body}>'),
    );
    expect(contenedor).toContain('paddingBottom');
    expect(contenedor).not.toContain('paddingTop');
    expect(contenedor).not.toContain('paddingHorizontal');

    const cuerpo = home.slice(home.indexOf('body: {'), home.indexOf('flows: {'));
    expect(cuerpo).toContain('paddingHorizontal: Spacing.lg');
    expect(cuerpo).toContain('gap: Spacing.lg');

    // Cada pieza de arriba, con su relleno propio y el mismo que tenían juntas.
    for (const pieza of ['features/shell/app-top-bar.tsx', 'features/shell/home-greeting.tsx']) {
      expect(code(pieza), pieza).toContain('paddingHorizontal: Spacing.lg');
      expect(code(pieza), pieza).toContain('paddingBottom: Spacing.md');
    }

    /*
     * Y ninguna de las dos separaciones se corrige a mano: ni margen negativo,
     * ni posición manual. Se comprueba sobre los contenedores que las ponen,
     * no sobre el fichero entero — el `marginTop: -2` de la firma bajo el
     * nombre de la marca es un ajuste óptico de tipografía que estaba ahí
     * antes, y no tiene nada que ver con este reparto.
     */
    for (const [pieza, caja] of [
      ['features/shell/app-top-bar.tsx', 'bar: {'],
      ['features/shell/home-greeting.tsx', 'greeting: {'],
    ]) {
      const fuente = code(pieza);
      const bloque = fuente.slice(fuente.indexOf(caja), fuente.indexOf('},', fuente.indexOf(caja)));
      expect(bloque, pieza).not.toContain('margin');
      expect(bloque, pieza).not.toContain('top:');
    }
    expect(home).not.toMatch(/margin\w*: -/);
  });
});

/**
 * ELIMINAR UN MOVIMIENTO, que es anular y nunca borrar.
 *
 * Lo que estas guardas protegen no es el gesto —eso lo dice el aparato— sino
 * las cuatro cosas que pueden romperse en silencio: que se llame al writer
 * canónico y no a un borrado; que el gesto no sea la única vía; que no haya dos
 * intentos sobre el mismo movimiento; y que las cifras se rehagan desde el
 * servidor en vez de tocarse en el cliente.
 *
 * **La semántica de la anulación NO se vuelve a probar aquí.** Que la operación
 * sobreviva, que sus versiones sigan donde estaban, que el puntero se mueva y
 * que la anulación sea terminal lo demuestran los checks de
 * `supabase/checks/` contra una base real, que es donde se puede demostrar.
 * Duplicarlo sobre el fuente del cliente daría una falsa sensación de prueba.
 */
describe('el importe de una fila', () => {
  it('la fila toma su color de la clase, no del signo', () => {
    expect(ROW).toContain('themeColor={amountTone(operation)}');
    // Nada de deducirlo del importe en el propio JSX.
    expect(ROW).not.toContain("balance_amount) < 0n ? 'negative'");
  });

  /**
   * **El rojo de Nomey no se ha tocado.** Lo que cambia es que un gasto
   * ordinario de esta lista deja de usarlo; sigue significando lo mismo donde
   * significa algo — un saldo negativo, una deuda, un error, la acción
   * destructiva del deslizamiento.
   */
  it('el rojo sigue existiendo donde tiene sentido', () => {
    expect(Colors.dark.negative).toBe('#FF6B6B');

    // La tarjeta de Disponible sigue pintando en rojo un saldo negativo.
    expect(code('features/personal/balance-card.tsx')).toContain("'negative'");
    // Y la acción de eliminar sigue siendo roja.
    expect(SWIPE).toContain('theme.negative');
  });

  /** Y el apartado se llama por su clave, nunca con el texto escrito. */
  it('el título del apartado sale del catálogo', () => {
    expect(HOME_CODE).toContain("t('home.activity')");
    expect(HOME_CODE).not.toContain('Movimientos recientes');
  });
});

describe('eliminar un movimiento', () => {
  it('la única escritura es el writer canónico de anulación', () => {
    expect(SERVICE).toContain("rpc('annul_operation'");
    expect(ANNUL).toContain('annulOperation(');
  });

  /**
   * **No existe borrado físico, y se comprueba en todo el cliente.** Nomey no
   * borra: la eliminación es una versión más. Un `.delete()` de PostgREST
   * contra cualquier superficie sería otra semántica, y la peor parte es que
   * funcionaría.
   */
  it('no hay hard delete en ninguna parte del cliente', () => {
    for (const source of FILES) {
      expect(code(source.path), source.path).not.toContain('.delete()');
      expect(code(source.path), source.path).not.toContain("rpc('delete");
    }
  });

  /** Anular no redescribe el movimiento: sólo cuál, y desde qué versión. */
  it('el payload lleva la operación y la versión esperada, y nada más', () => {
    expect(ANNUL).toContain('operation_id: operation.operation_id');
    expect(ANNUL).toContain('expected_version_id: operation.current_version_id');
    for (const campo of ['amount', 'concept', 'category_id', 'effective_date']) {
      expect(ANNUL, campo).not.toContain(campo + ':');
    }
  });

  /**
   * **La clave de idempotencia se genera antes del primer intento y se
   * conserva**, igual que al registrar: un reintento tras un fallo de red lleva
   * la misma clave y la frontera responde `already_processed` en vez de
   * escribir una segunda versión.
   */
  it('reutiliza la disciplina de idempotencia del alta', () => {
    expect(ANNUL).toContain('newClientOperationId()');
    expect(ANNUL).toContain('keys.current.get(intent)');
    // La intención es «anular ESTA versión de ESTA operación».
    const intento = ANNUL.slice(
      ANNUL.indexOf('const intent ='),
      ANNUL.indexOf(';', ANNUL.indexOf('const intent =')),
    );
    expect(intento).toContain('operation.operation_id');
    expect(intento).toContain('operation.current_version_id');
  });

  /**
   * **El doble envío se corta de forma síncrona.** `useState` es asíncrono: dos
   * pulsaciones en el mismo fotograma leerían las dos el valor viejo y saldrían
   * las dos. La comprobación va sobre una referencia, y antes de cualquier
   * `await`.
   */
  it('dos pulsaciones no producen dos intentos', () => {
    expect(ANNUL).toContain('inFlight.current.has(operation.operation_id)');
    expect(ANNUL).toContain('inFlight.current.add(operation.operation_id)');
    expect(ANNUL).toContain('inFlight.current.delete(operation.operation_id)');

    // Y la guarda va ANTES del primer await, no después.
    expect(ANNUL.indexOf('inFlight.current.has')).toBeLessThan(ANNUL.indexOf('await'));

    // La fila bloquea además su propio control mientras está en vuelo.
    expect(ROW).toContain('deleting');
    expect(HOME_CODE).toContain('deleting={annulling.pending === operation.operation_id}');
  });

  /**
   * **El gesto descubre; no elimina.** Un deslizamiento largo que borrara solo
   * sería un accidente esperando a ocurrir con dinero de por medio.
   */
  it('el deslizamiento no escribe: descubre un control', () => {
    expect(SWIPE).toContain('renderRightActions');
    expect(SWIPE).not.toContain('onSwipeableOpen');
    expect(SWIPE).not.toContain('annul');
    // Y el control avisa hacia arriba; no llama a ninguna frontera.
    expect(SWIPE).toContain('onDelete()');
  });

  /** Y pulsar la papelera abre confirmación antes de escribir nada. */
  it('pulsar eliminar abre confirmación con acción destructiva', () => {
    expect(HOME_CODE).toContain(
      "Alert.alert(t('home.deleteMovement'), t('home.deleteMovementBody')",
    );
    expect(HOME_CODE).toContain("style: 'cancel'");
    expect(HOME_CODE).toContain("style: 'destructive'");
    // Cancelar no tiene onPress: no puede llamar a nada.
    expect(HOME_CODE).toContain("{ text: t('action.cancel'), style: 'cancel' }");
    // Y la anulación cuelga de la acción destructiva, no del diálogo.
    expect(HOME_CODE.indexOf("style: 'destructive'")).toBeLessThan(
      HOME_CODE.indexOf('annulling.annul(operation)'),
    );
  });

  /**
   * **Al confirmar se refresca desde el servidor, y no se toca ninguna cifra
   * aquí.** El saldo, los totales del intervalo y el reparto por categoría los
   * derivan `api.personal_balance` y `api.personal_statistics`; recalcularlos en
   * el cliente sería inventarse una segunda contabilidad.
   */
  it('el éxito refresca las superficies de lectura', () => {
    expect(HOME_CODE).toContain('home.refresh()');
    const exito = HOME_CODE.slice(
      HOME_CODE.indexOf('annulling.annul(operation)'),
      HOME_CODE.indexOf('home.deleteFailedTitle'),
    );
    expect(exito).toContain('if (done)');
    expect(exito).toContain('home.refresh()');
  });

  /**
   * **Y si falla, el movimiento sigue ahí.** Nada de quitarlo primero y
   * devolverlo: la fila no desaparece hasta que el servidor ha confirmado.
   */
  it('el fallo conserva el movimiento y lo dice sin tecnicismos', () => {
    expect(HOME_CODE).toContain('home.deleteFailedTitle');
    expect(HOME_CODE).toContain('home.deleteFailedBody');
    // Ni lista local que quitar, ni saldo tocado a mano.
    expect(HOME_CODE).not.toMatch(/setOperations|filter\(.*operation_id.*!==/);
    // Y el motivo técnico no llega a la interfaz.
    expect(ANNUL).not.toContain('error.message');
    for (const codigo of ['PAYLOAD_INVALID', 'VERSION_CONFLICT', 'PGRST']) {
      expect(HOME_CODE, codigo).not.toContain(codigo);
    }
  });

  /**
   * **Sólo gasto e ingreso, y decidido por la CLASE.** Ni por el signo, ni por
   * el color, ni por el texto: un ajuste negativo se parece a un gasto en las
   * tres cosas.
   */
  it('sólo se ofrece en gastos e ingresos, y por su clase', () => {
    const movimiento = code('features/personal/movement.ts');
    expect(movimiento).toContain('export function canAnnul');
    expect(movimiento).toContain("kind === 'income' || kind === 'expense'");
    expect(ROW).toContain('canAnnul(operation)');
    expect(ROW).toContain('enabled={deletable}');
    // Nada de deducirlo del importe o del color.
    expect(ROW).not.toMatch(/deletable\s*=.*balance_amount/);
  });

  /**
   * **El gesto no puede ser la única vía.** Un deslizamiento no existe para un
   * lector de pantalla: sin acción accesible, eliminar sería imposible con
   * VoiceOver o TalkBack.
   */
  it('hay una acción accesible equivalente', () => {
    expect(ROW).toContain('accessibilityActions');
    expect(ROW).toContain("name: 'delete'");
    expect(ROW).toContain('onAccessibilityAction');
    expect(ROW).toContain("actionName === 'delete'");
    // Y llama a la MISMA puerta que el gesto, para que no puedan divergir.
    expect(ROW).toContain('onDelete()');
    // Sólo se anuncia cuando la fila es eliminable.
    expect(ROW).toContain('deletable ? [{ name:');
  });

  /**
   * La primitiva ya estaba en las dependencias. No se añadió ninguna.
   */
  it('reutiliza el gesto que el proyecto ya tenía', () => {
    expect(SWIPE).toContain("from 'react-native-gesture-handler/ReanimatedSwipeable'");
    // Que el paquete exista lo prueba el typecheck: sin él, ese import no
    // resuelve y `tsc` falla antes de llegar aquí.
  });

  /**
   * **Y la raíz de gestos existe.** Sin ella el reconocedor no se instala y el
   * deslizamiento no se dispara nunca en Android, sin que nada avise.
   */
  it('la aplicación monta la raíz de gestos', () => {
    const raiz = code('app/_layout.tsx');
    expect(raiz).toContain('<GestureHandlerRootView');
    expect(raiz).toContain("from 'react-native-gesture-handler'");
  });
});

/**
 * EL TEXTO TÉCNICO DEL DETALLE, retirado.
 *
 * Decía «Observación del sistema al registrar esta versión»: vocabulario del
 * modelo, no del dinero de nadie. Se fue con la fila que anotaba, y no sólo la
 * nota — la observación se toma en el instante en que se escribe la versión
 * (ADR-023 §5), así que desde que se puede corregir desde aquí, corregir hoy un
 * movimiento de hace meses observaría el saldo DE HOY. La nota era lo único que
 * lo advertía.
 */
describe('el detalle no habla de versiones', () => {
  it('la frase técnica no existe en ninguna parte del cliente', () => {
    for (const source of FILES) {
      expect(code(source.path), source.path).not.toContain('detailObservedNote');
      // Sobre el CÓDIGO: el comentario que explica la retirada nombra la
      // frase, y la explicación no es el defecto.
      expect(code(source.path), source.path).not.toContain('Observación del sistema');
    }
  });

  it('y su clave ya no está en el catálogo', () => {
    const es = code('lib/i18n/messages/es-ES.ts');
    const en = code('lib/i18n/messages/en.ts');
    for (const catalogo of [es, en]) {
      expect(catalogo).not.toContain('detailObservedNote');
      expect(catalogo).not.toContain('detailObserved');
    }
  });

  /**
   * **Nada se ha borrado por debajo.** Dejar de pintarlo no es dejar de
   * guardarlo: la superficie de lectura y el hook siguen intactos, para cuando
   * el historial tenga su sitio propio.
   */
  it('la observación sigue existiendo en la frontera y en el hook', () => {
    expect(SERVICE).toContain("rpc('observed_balance'");
    expect(HOOK).toContain('observationsAsked');
  });

  /** Y el detalle no se queda con un hueco: la fila entera desapareció. */
  it('no queda una fila vacía en su lugar', () => {
    expect(ROW).not.toContain('observation');
    expect(ROW).not.toContain('note=');
  });
});

/**
 * EDITAR EL DISPONIBLE, que es DECLARAR EL SALDO y no tocar nada más.
 *
 * La persona escribe cuánto tiene; el servidor deriva la diferencia y la
 * asienta como un ajuste. Ni se modifica un movimiento, ni se inventa un
 * ingreso, ni se escribe el saldo en ninguna parte — el saldo no es una fila:
 * se deriva de los efectos vigentes.
 *
 * **La semántica del ajuste por objetivo NO se vuelve a probar aquí.** Que el
 * delta se derive bajo lock y después del CAS, y que el resultado sea
 * exactamente el objetivo, lo demuestran los checks de `supabase/checks/`
 * contra una base real. Lo que se protege aquí es el cableado del cliente.
 */
describe('editar el Disponible', () => {
  it('el lápiz de la tarjeta abre la ventana, y no hay un segundo control', () => {
    expect(CARD_CODE).toContain('name={Symbols.edit}');
    expect(CARD_CODE).toContain("label={t('home.adjustBalance')}");
    expect(CARD_CODE).toContain('onPress={onAdjust}');
    // Un solo control: el que ya estaba.
    expect(CARD_CODE.match(/name={Symbols.edit}/g) ?? []).toHaveLength(1);

    expect(HOME_CODE).toContain('onAdjust={editBalance}');
    expect(HOME_CODE).toContain("pathname: '/edit-balance'");
  });

  /**
   * **Se declara el SALDO, nunca la diferencia.** `api.record_adjustment` admite
   * `delta` o `target_balance`, exactamente uno; el delta lo deriva el servidor
   * bajo lock, que es lo que impide que salga de una lectura vieja.
   */
  it('el writer recibe target_balance y jamás un delta', () => {
    expect(SERVICE).toContain("rpc('record_adjustment'");
    expect(SERVICE).toContain('readonly target_balance: string;');
    // El tipo del payload ni siquiera ofrece la otra forma.
    const tipo = SERVICE.slice(
      SERVICE.indexOf('export type AdjustmentPayload'),
      SERVICE.indexOf('export async function recordAdjustment'),
    );
    expect(tipo).not.toContain('delta');
    expect(AJUSTE).toContain('target_balance: target.toString()');
    expect(AJUSTE).not.toContain('delta');
  });

  /** Y el cliente no resta nada para llegar a él. */
  it('el cliente no calcula ninguna diferencia', () => {
    for (const fuente of [AJUSTE, EDITOR, RUTA_SALDO]) {
      expect(fuente).not.toMatch(/current\s*-\s*/);
      expect(fuente).not.toMatch(/target\s*-\s*/);
    }
  });

  /** El ajuste exige fecha y hora, y son las de ahora: no reconstruye nada. */
  it('lleva fecha y hora del momento, sin selector', () => {
    expect(AJUSTE).toContain('effective_date: todayInDeviceCalendar()');
    expect(AJUSTE).toContain('effective_time: currentClockTime()');
    // Ni calendario ni nada que permita fechar el ajuste en el pasado.
    expect(EDITOR).not.toContain('DateSheet');
    expect(EDITOR).not.toContain('calendar');
  });

  /**
   * **Arranca en el Disponible actual, y del que Inicio ya tiene en la mano.**
   * Pedirlo otra vez no daría una cifra más exacta: daría una ventana de tiempo
   * en la que arrancar con algo distinto de lo que se pulsó.
   */
  it('precarga el Disponible actual sin volver a consultarlo', () => {
    expect(HOME_CODE).toContain("current: home.balance?.amount ?? ''");
    expect(EDITOR).toContain('amountEntryFromMinor(current, scale)');
    expect(RUTA_SALDO).not.toContain('fetchBalance');
    expect(EDITOR).not.toContain('fetchBalance');
  });

  /** Un editor monetario, el de siempre. No hay un segundo parser. */
  it('reutiliza el editor monetario', () => {
    expect(HOJA).toContain('<AmountField');
    expect(EDITOR).toContain('toMinorUnits(');
    expect(EDITOR).not.toContain('parseFloat');
    expect(EDITOR).not.toContain('Number(');
  });

  /** La moneda se enseña y no se cambia: dice que no cambia, no lo finge. */
  it('la moneda no es editable', () => {
    expect(HOJA).toContain('currencySymbol(');
    expect(HOJA).toContain("t('entry.currencyFixed')");
    // El símbolo sale del ámbito, no de un estado: no hay nada que cambiar.
    expect(EDITOR).toContain('scope.currencyCode');
    expect(EDITOR).not.toContain('setCurrencyCode');
    expect(EDITOR).not.toContain('currencyDefinitionId:');
  });

  /**
   * **Sin cambio no se escribe**, y la comparación es en unidades mínimas: 5,
   * 5,0 y 5,00 son el mismo saldo. Un ajuste de cero no corrige nada y ensucia
   * el historial.
   */
  it('el mismo saldo no genera ajuste', () => {
    expect(EDITOR).toContain('target.toString() === current');
    expect(EDITOR).toContain('saveDisabled={unchanged}');
  });

  /** Subir y bajar son el mismo comando: no hay restricción de signo. */
  it('no hay ninguna restricción a bajar el saldo', () => {
    for (const fuente of [AJUSTE, EDITOR]) {
      expect(fuente).not.toMatch(/target\s*[<>]=?\s*0/);
      expect(fuente).not.toContain('Math.abs');
      expect(fuente).not.toContain('Math.max');
    }
  });

  /** Misma disciplina de idempotencia y doble envío que el resto de escrituras. */
  it('dos pulsaciones no producen dos ajustes', () => {
    expect(AJUSTE).toContain('if (inFlight.current) return false;');
    expect(AJUSTE.indexOf('inFlight.current')).toBeLessThan(AJUSTE.indexOf('await'));
    expect(AJUSTE).toContain('newClientOperationId()');
    expect(AJUSTE).toContain('keys.current.get(intent)');
  });

  /**
   * **El éxito cierra y refresca desde el servidor.** El Disponible nuevo lo
   * dice `api.personal_balance`; escribirlo aquí sería inventarse una segunda
   * contabilidad.
   */
  it('el éxito cierra la ventana y refresca por el camino de siempre', () => {
    expect(EDITOR).toContain('if (ok) onSaved();');
    expect(RUTA_SALDO).toContain('onSaved={close}');
    expect(HOME_CODE).toContain('useRefreshOnReturn(home.refresh)');
    expect(EDITOR).not.toContain('setBalance');
  });

  /** Y si falla, la ventana sigue abierta con la cifra escrita. */
  it('el fallo conserva la ventana y la cifra', () => {
    expect(EDITOR).toContain("t('home.balanceFailed')");
    expect(EDITOR).toContain('if (ok) onSaved();');
    for (const codigo of ['PAYLOAD_INVALID', 'PGRST', 'rpc(']) {
      expect(EDITOR, codigo).not.toContain(codigo);
    }
  });

  /** La X cierra sin escribir: la aporta la ventana compartida. */
  it('cerrar no escribe nada', () => {
    const ventana = code('ui/components/sheet-window.tsx');
    expect(ventana).toContain('name={Symbols.close}');
    expect(ventana).not.toContain('rpc(');
    expect(ventana).not.toContain('adjust');
  });

  /**
   * **Un ajuste no es un ingreso ni un gasto**, y eso no se decide aquí: no
   * produce dimensión económica, así que `api.personal_statistics` lo deja
   * fuera sin ninguna cláusula que lo excluya (ADR-026).
   */
  it('el ajuste no toca estadísticas ni categorías desde el cliente', () => {
    for (const fuente of [AJUSTE, EDITOR, RUTA_SALDO]) {
      expect(fuente).not.toContain('category');
      expect(fuente).not.toContain('statistics');
      expect(fuente).not.toContain('income');
      expect(fuente).not.toContain('expense');
    }
  });

  /** Y la subtarjeta de deudas no se toca. */
  it('la deuda queda exactamente como estaba', () => {
    expect(CARD_CODE).toContain('debtTone(debtMinor)');
    for (const fuente of [AJUSTE, EDITOR, RUTA_SALDO]) {
      expect(fuente).not.toContain('debt');
    }
  });

  /**
   * **Mismo fondo desenfocado que «Añadir movimiento»**, y una sola
   * implementación: `AddBackdrop` no es del `+`, es de cualquier ventana que se
   * abra sobre Inicio.
   */
  it('reutiliza el fondo y la ventana ya aprobados', () => {
    /*
     * El fondo y el armazón ya no los monta cada ruta: los monta `EditWindow`,
     * que es lo que impide que las dos ventanas se separen porque alguien
     * tocara una sola.
     */
    expect(RUTA_SALDO).toContain('<EditWindow');
    const ventana = code('features/shell/edit-window.tsx');
    expect(ventana).toContain('<SheetWindow');
    expect(ventana).toContain('useAddBackdrop()');
    expect(HOME_CODE).toContain('backdrop.show()');
    // Y la ruta se presenta como la de «Añadir»: transparente de verdad.
    const raiz = code('app/_layout.tsx');
    const bloque = raiz.slice(raiz.indexOf('name="edit-balance"'));
    expect(bloque.slice(0, 220)).toContain("presentation: 'transparentModal'");
    expect(bloque.slice(0, 220)).toContain("backgroundColor: 'transparent'");
  });

  /** Nada de esto habla de ajustes ni de objetivos en la interfaz. */
  it('la interfaz habla de «Disponible», no del modelo', () => {
    for (const clave of ['home.balanceTitle', 'home.balanceLabel', 'home.balanceFailed']) {
      expect(RUTA_SALDO + EDITOR, clave).toContain(clave.split('.')[1]);
    }
    expect(EDITOR).not.toContain('adjustment');
    expect(EDITOR).not.toContain('reconcil');
  });
});

/**
 * EL AJUSTE, VISIBLE Y LEGIBLE en Movimientos recientes.
 *
 * Aparece como lo que es —una clase propia, ni gasto ni ingreso—, dice a cuánto
 * se fijó el saldo, enseña de cuánto se venía, y a la derecha el cambio real
 * que produjo.
 *
 * **Lo que NO cambia por enseñarlo:** sigue fuera de Ingresos, de Gastos y del
 * reparto por categoría. Mostrar algo en el historial no le da dimensión
 * económica; eso lo decide el modelo, no esta lista.
 */
describe('el ajuste en Movimientos recientes', () => {
  /**
   * **Ya salía de la superficie de lectura**, y con todo lo que hace falta: la
   * lista publica las tres clases y cada fila trae `target_balance` y
   * `balance_amount`. No hubo que ampliar nada.
   */
  it('la superficie ya publica el ajuste y sus dos cifras', () => {
    const migracion = FILES.length > 0; // el fuente del cliente, no el SQL
    expect(migracion).toBe(true);
    expect(ROW).toContain('adjustmentPreviousBalance(operation)');
    // Y una sola consulta: el anterior sale de la fila, no de otra petición.
    expect(ROW).not.toContain('fetch');
    expect(ROW).not.toContain('rpc(');
  });

  /** Se identifica por CLASE, nunca por el signo ni por el texto. */
  it('se reconoce por operation_class', () => {
    const movimiento = code('features/personal/movement.ts');
    expect(movimiento).toContain("if (operationClass === 'adjustment') return 'adjustment'");
    expect(movimiento).toContain("adjustmentForm(operation) !== 'target'");
  });

  /** El título dice a cuánto se fijó el saldo, y sale del catálogo. */
  it('dice «Saldo ajustado a X», con el objetivo canónico', () => {
    expect(ROW).toContain("t('home.adjustedTo'");
    expect(ROW).toContain('toMinor(operation.target_balance)');
    expect(ROW).not.toContain('Saldo ajustado');
  });

  /**
   * **El saldo anterior va tachado, pequeño y en el tono más apagado.** Es
   * contexto, no la cifra que cuenta — y nunca en rojo: no es un error ni una
   * pérdida, es el punto de partida.
   */
  it('el saldo anterior se pinta discreto y tachado', () => {
    const bloque = ROW.slice(ROW.indexOf('{previousBalance === null ? null : ('));
    expect(bloque.slice(0, 600)).toContain('variant="caption"');
    expect(bloque.slice(0, 600)).toContain('themeColor="textDisabled"');
    expect(bloque.slice(0, 600)).toContain('style={styles.struck}');
    expect(bloque.slice(0, 600)).not.toContain('negative');
    // Un tachado no se anuncia solo: lleva etiqueta accesible propia.
    expect(bloque.slice(0, 600)).toContain("t('home.previousBalance'");
    // Y el estilo es el del tachado que ya existía, no uno nuevo.
    expect(ROW).toContain("textDecorationLine: 'line-through'");
  });

  /**
   * **El importe de la derecha es el efecto canónico**, el mismo
   * `balance_amount` que ya llevaba la fila. No se compara con el Disponible de
   * ahora ni se recalcula.
   */
  it('el importe lateral es el efecto de la operación', () => {
    expect(ROW).toContain('money(toMinor(operation.balance_amount), definition)');
    expect(ROW).toContain("sign: 'always'");
    expect(ROW).not.toContain('home.balance');
  });

  /** Y ya no queda la etiqueta que repetía lo que el título dice. */
  it('la segunda línea del ajuste es el saldo anterior, no una etiqueta', () => {
    // La etiqueta genérica, fuera. `home.adjustmentManual` se queda: es el
    // título de un ajuste declarado por delta, que es otra cosa.
    expect(ROW).not.toContain("t('home.adjustment')");
    for (const catalogo of ['lib/i18n/messages/es-ES.ts', 'lib/i18n/messages/en.ts']) {
      expect(code(catalogo), catalogo).not.toContain("'home.adjustment':");
    }
  });

  /** Ni editar ni eliminar: la forma de hacer otro ajuste es el lápiz. */
  it('no ofrece editar ni eliminar', () => {
    const movimiento = code('features/personal/movement.ts');
    // Las dos capacidades se preguntan por separado y las dos excluyen el ajuste.
    const capacidades = movimiento.match(/kind === 'income' \|\| kind === 'expense'/g) ?? [];
    expect(capacidades).toHaveLength(2);
    expect(ROW).toContain('editable ? (');
    expect(ROW).toContain('deletable ? (');
    expect(ROW).toContain('enabled={deletable}');
  });

  /** El icono es de regular una magnitud, no de entrada ni de salida. */
  it('lleva un icono propio, con su pareja de plataforma', () => {
    expect(ROW).toContain("ios: 'slider.horizontal.3'");
    expect(ROW).toContain("android: 'tune'");
    // Y las otras dos direcciones también dejan de ser cadenas sueltas.
    expect(ROW).toContain("ios: 'arrow.down.left'");
    expect(ROW).toContain("ios: 'arrow.up.right'");
  });

  /**
   * **Enseñarlo no le da dimensión económica.** Sigue fuera de los totales del
   * intervalo y del reparto por categoría, y eso lo decide el modelo: un
   * ajuste no produce efecto económico, así que `api.personal_statistics` lo
   * deja fuera sin ninguna cláusula que lo excluya (ADR-026).
   */
  it('sigue fuera de ingresos, gastos y categorías', () => {
    // Los desplegables de flujo filtran por clase, y el ajuste no es ninguna.
    expect(HOME_CODE).toContain("movementKind(op.operation_class) === 'income'");
    expect(HOME_CODE).toContain("movementKind(op.operation_class) === 'expense'");
    // Y el reparto sigue saliendo de las estadísticas —las del servidor más la
    // proyección local (ADR-028 §8)—, nunca de sumar la lista.
    expect(HOME_CODE).toContain('categorySlices(projected.statistics.categories');
    expect(HOME_CODE).not.toContain("'adjustment'");
  });

  /** Y el orden lo sigue poniendo el criterio canónico, no un estado local. */
  it('entra en la lista por el orden canónico', () => {
    expect(SERVICE).toContain('OPERATION_ORDER');
    expect(HOME_CODE).not.toContain('unshift');
    expect(HOME_CODE).not.toContain('setOperations');
  });

  /** Y al desplegarlo no aparece ningún tecnicismo. */
  it('el detalle del ajuste no habla del modelo', () => {
    for (const termino of ['target_balance', 'operation_id:', 'version_id', 'rpc']) {
      const detalle = ROW.slice(ROW.indexOf('{expanded ? ('));
      expect(detalle, termino).not.toContain(termino);
    }
  });
});

/**
 * EL SALDO ACTUAL ES REFERENCIA, NO BORRADOR.
 *
 * En «Editar disponible» no se corrige el saldo de antes: se declara uno nuevo,
 * entero. Por eso el editor arranca vacío y el Disponible de ahora sólo ocupa
 * su sitio, apagado, mientras nadie escribe.
 *
 * **La diferencia con «Editar movimiento» es de fondo y se mantiene:** allí el
 * importe anterior SÍ es el borrador, porque corregir parte de lo que había.
 */
describe('el saldo actual es referencia', () => {
  const CAMPO = code('features/personal/amount-field.tsx');

  /** El borrador empieza vacío. El saldo actual no lo inicializa. */
  it('el editor arranca vacío y el saldo actual no lo inicializa', () => {
    expect(EDITOR).toContain('useState<AmountEntry>(EMPTY_AMOUNT)');
    expect(EDITOR).not.toContain('useState<AmountEntry>(() =>');
    // Y la referencia se construye aparte, sin tocar el estado.
    expect(EDITOR).toContain('const reference =');
    expect(EDITOR).toContain('amountEntryFromMinor(current, scale)');
    expect(EDITOR).toContain('reference={reference}');
  });

  /**
   * **La referencia manda sólo mientras el editor está intacto**, y
   * `amountTouched` cubre también la coma: entrar en decimales ya es haber
   * empezado, aunque todavía no haya dígitos.
   */
  it('la referencia desaparece con la primera pulsación', () => {
    expect(CAMPO).toContain('!amountTouched(entry) ? reference : entry');
  });

  /**
   * Y se pinta apagada entera, con el token del tema y sin opacidades sueltas.
   *
   * **La única opacidad del fichero es la del capturador en Android**, que no
   * pinta la cifra sino que deja de pintar la suya: son cosas distintas y la
   * de aquí sigue prohibida.
   */
  it('se pinta con el token apagado del tema', () => {
    expect(CAMPO).toContain("muted || tone === 'pending' ? 'textDisabled' : 'text'");
    expect(CAMPO.match(/opacity:/g) ?? []).toHaveLength(1);
    expect(CAMPO).toContain('android: { opacity: 0 }');
    for (const color of ['negative', 'positive', 'accent']) {
      expect(CAMPO, color).not.toContain(color);
    }
  });

  /**
   * **El borrado no puede tocar la referencia**, y no porque se proteja: el
   * campo está vacío, así que no hay nada que borrar. Lo comprueba la prueba
   * de comportamiento del parser; aquí se fija que el valor del campo es el
   * borrador y nunca la referencia.
   */
  it('el campo lleva el borrador, no la referencia', () => {
    expect(CAMPO).toContain('value={amountValue(entry)}');
    expect(CAMPO).not.toContain('value={amountValue(reference)}');
    expect(CAMPO).toContain('applyAmountInput(entry, next, scale)');
  });

  /**
   * Sin escribir nada, `toMinorUnits('')` devuelve `null` y `Guardar cambios` ya
   * está apagado: no hace falta una condición aparte para el estado inicial, y
   * no tenerla es lo que impide que las dos se contradigan.
   */
  it('sin escribir nada no hay cambio que guardar', () => {
    expect(EDITOR).toContain('const unchanged = target === null');
    expect(EDITOR).toContain('target.toString() === current');
    expect(EDITOR).toContain('saveDisabled={unchanged}');
  });

  /**
   * **Ni «Añadir movimiento» ni «Editar movimiento» cambian.** El primero no
   * pasa referencia, así que sigue viendo su `0,00` apagado; el segundo sigue
   * precargando el importe anterior como BORRADOR, que es lo correcto para
   * corregir.
   */
  it('las otras dos superficies conservan su comportamiento', () => {
    expect(FORM).not.toContain('reference=');
    expect(BORRADOR).toContain('initial?.amount ?? EMPTY_AMOUNT');
    // La capacidad es opcional: sin ella el editor es el de siempre.
    expect(CAMPO).toContain('readonly reference?: AmountEntry;');
    expect(CAMPO).toContain('reference !== undefined');
  });

  /** Y sigue habiendo un solo editor monetario. */
  it('no hay un segundo parser ni un segundo editor', () => {
    const editores = FILES.filter((f) => f.text.includes('export function AmountField'));
    expect(editores.map((f) => f.path)).toEqual(['features/personal/amount-field.tsx']);
    for (const fuente of [EDITOR, code('features/personal/amount-field.tsx')]) {
      expect(fuente).not.toContain('parseFloat');
      expect(fuente).not.toContain('parseInt');
    }
  });

  /**
   * **Nada de esto sobrevive a cerrar la ventana.** El borrador vive en el
   * estado del componente, que se desmonta con la ruta: no hay almacenamiento
   * ni contexto donde pudiera quedarse, así que reabrir vuelve a partir del
   * Disponible canónico.
   */
  it('el borrador no se guarda en ninguna parte', () => {
    for (const fuente of [EDITOR, RUTA_SALDO]) {
      expect(fuente).not.toContain('AsyncStorage');
      expect(fuente).not.toContain('useRef');
      expect(fuente).not.toContain('Context');
    }
    // Y la referencia se recalcula de lo que llegue por parámetro cada vez.
    expect(RUTA_SALDO).toContain('current={params.current ?? null}');
  });
});

/**
 * CORREGIR UN MOVIMIENTO: MISMA VENTANA, LÓGICA CONTRARIA.
 *
 * ```
 * /edit-balance                        /edit-movement
 *   EditBalanceScreen                    EditMovementScreen
 *     EditWindow          ←— la misma —→   EditWindow
 *       SheetWindow                          SheetWindow
 *         BalanceEditor                        MovementEditor
 *           AmountSheet   ←— la misma —→         AmountSheet
 *                                                  header  −/+
 *                                                  fields  concepto…
 *   record_adjustment                      record_personal_expense
 *   target_balance                         record_personal_income
 *                                          operation_id + expected_version_id
 * ```
 *
 * **La ventana converge ANTES del contenido; la lógica no converge nunca.**
 * Fijar el saldo declara cuánto hay; corregir un movimiento sustituye el efecto
 * de una operación. Que corregir un gasto de 50 a 70 llame a
 * `record_adjustment` con `target_balance = 70` dejaría el Disponible EN 70, que
 * es un defecto silencioso con dinero de por medio — y es exactamente lo que
 * estas guardas existen para impedir.
 */
describe('corregir un movimiento no toca el Disponible', () => {
  /** Cada lápiz a su ruta. Ni una comparte destino con la otra. */
  it('cada lápiz navega a SU ruta', () => {
    const corregir = HOME_CODE.slice(
      HOME_CODE.indexOf('const editMovement'),
      HOME_CODE.indexOf('const editBalance'),
    );
    const saldo = HOME_CODE.slice(
      HOME_CODE.indexOf('const editBalance'),
      HOME_CODE.indexOf('const toggleMovement'),
    );

    expect(corregir).toContain("pathname: '/edit-movement'");
    expect(saldo).toContain("pathname: '/edit-balance'");

    // **La guarda explícita**: el lápiz de una fila NO puede abrir la del saldo.
    expect(corregir).not.toContain('/edit-balance');
    expect(saldo).not.toContain('/edit-movement');
    // Ni ninguno de los dos reutiliza el alta.
    expect(HOME_CODE).not.toContain("pathname: '/add'");
  });

  /** Y las dos filas de movimiento llevan la operación pulsada, no otra cosa. */
  it('el movimiento se identifica por su id y su versión vigente', () => {
    expect(HOME_CODE).toContain('operationId: operation.operation_id');
    expect(HOME_CODE).toContain('versionId: operation.current_version_id');
    /*
     * Nunca por índice, posición ni versión anterior. Acotado al bloque que
     * navega: `versionOf` sigue usando la versión previa para la línea
     * tachada de un movimiento corregido, y eso es otra cosa.
     */
    const abrir = HOME_CODE.slice(
      HOME_CODE.indexOf('const editMovement'),
      HOME_CODE.indexOf('const editBalance'),
    );
    expect(abrir).not.toContain('index');
    expect(abrir).not.toContain('previous_version_id');
    // Y el importe declarado, no el firmado.
    expect(HOME_CODE).toContain('amount: operation.original_amount');
    expect(HOME_CODE).not.toContain('amount: operation.balance_amount');
  });

  /** Se ofrece por CLASE: gasto e ingreso sí, el ajuste no. */
  it('sólo gastos e ingresos ofrecen editar', () => {
    const movimiento = code('features/personal/movement.ts');
    expect(movimiento).toContain('export function canEdit');
    expect(movimiento).toContain("kind === 'income' || kind === 'expense'");
    expect(ROW).toContain('canEdit(operation)');
    expect(ROW).toContain('editable ? (');
  });

  /**
   * **LA GUARDA QUE IMPORTA.** Corregir no puede ejecutar nada de la lógica del
   * saldo: ni su pantalla, ni su hook, ni su writer, ni su campo.
   */
  it('la corrección no ejecuta NADA de la lógica del saldo', () => {
    for (const fuente of [EDICION, RUTA_MOVIMIENTO]) {
      expect(fuente).not.toContain('BalanceEditor');
      expect(fuente).not.toContain('useAdjustBalance');
      expect(fuente).not.toContain('record_adjustment');
      expect(fuente).not.toContain('target_balance');
      expect(fuente).not.toContain('adjust');
    }
  });

  /** Y usa el writer de la clase de la operación, con los dos campos del CAS. */
  it('guarda con el writer de corrección de su clase', () => {
    expect(EDICION).toContain('operationId: edit.operationId');
    expect(EDICION).toContain('expectedVersionId: edit.expectedVersionId');

    const entrada = code('features/personal/movement-entry.ts');
    expect(entrada).toContain('operation_id: target.operationId');
    expect(entrada).toContain('expected_version_id: target.expectedVersionId');

    // El servicio elige por clase, y son los dos writers de siempre.
    expect(SERVICE).toContain("rpc('record_personal_expense'");
    expect(SERVICE).toContain("rpc('record_personal_income'");
    expect(ALTA).toContain("draft.kind === 'income'");
  });

  /**
   * **Arranca en la versión VIGENTE.** Si la operación ya se corrigió antes, lo
   * que se abre es lo que dice v2 — no lo que decía v1.
   */
  it('precarga la versión vigente, no la original', () => {
    expect(EDICION).toContain('useMovementDraft(scale, scope !== null, edit)');
    expect(BORRADOR).toContain('initial?.amount ?? EMPTY_AMOUNT');
    expect(BORRADOR).toContain("initial?.concept ?? ''");
    expect(BORRADOR).toContain('initial?.categoryId ?? null');
    expect(RUTA_MOVIMIENTO).toContain('amountEntryFromMinor(params.amount');
  });

  /**
   * EL PANEL NUNCA SE QUEDA SIN CONTENIDO, y esto no es una preferencia.
   *
   * Cuando `edit` dependía del ámbito, abrir la ventana la dejaba reducida a su
   * encabezado mientras iba y volvía `ensure_personal_scope`: una tira con el
   * título en medio de la pantalla, con todo lo demás siendo el velo. Tocar
   * donde se dibuja la cifra caía FUERA del panel, el velo hacía lo suyo
   * —cerrar— y el campo del importe ni siquiera estaba montado. Se leía como un
   * fallo de capas y era un panel vacío.
   *
   * La escala viaja por parámetro, como el importe: Inicio la conoce —el lápiz
   * sólo existe con el ámbito resuelto— y unas unidades mínimas sin su escala no
   * son una cifra. Suponerla mientras tanto no valía: el borrador siembra con
   * inicializadores perezosos, así que una escala provisional se habría quedado
   * congelada en el importe a corregir.
   */
  it('el contenido no espera al ámbito, y la escala llega con el importe', () => {
    // Inicio manda las dos cosas juntas.
    const corregir = HOME_CODE.slice(
      HOME_CODE.indexOf('const editMovement'),
      HOME_CODE.indexOf('const editBalance'),
    );
    expect(corregir).toContain('amount: operation.original_amount');
    expect(corregir).toContain('scale: String(ready?.currencyScale ?? 2)');

    // Y la ruta reconstruye con ELLA, no con la del ámbito.
    expect(RUTA_MOVIMIENTO).toContain('amountEntryFromMinor(params.amount');
    expect(RUTA_MOVIMIENTO).not.toContain('scope.currencyScale)');

    // Lo único que deja la ventana sin contenido es no tener qué corregir.
    expect(RUTA_MOVIMIENTO).toContain(
      'params.operationId === undefined || params.versionId === undefined',
    );
    expect(RUTA_MOVIMIENTO).not.toContain('scope === null ||');

    // El ámbito sigue haciendo falta para GUARDAR, y sigue bloqueando el CTA.
    expect(EDICION).toContain('useMovementDraft(scale, scope !== null, edit)');
  });

  /** El importe es borrador real: aquí no hay referencia apagada. */
  it('el importe es un borrador editable, no una referencia', () => {
    expect(EDICION).not.toContain('reference');
    expect(EDITOR).toContain('reference={reference}');
  });

  /**
   * **LA VENTANA SIGUE SIENDO COMPACTA**, y el primer campo que ha entrado es
   * la categoría.
   *
   * El parecido con «Añadir movimiento» no venía de tener campos: venía de
   * tener LOS SUYOS —selector de clase arriba, y abajo la fila de concepto,
   * categoría y fecha— que juntos SON la pantalla del alta. Lo que sigue
   * vedado es esa composición, no un control.
   *
   * Así que el hueco de arriba sigue vacío, la fila del alta no se monta, y lo
   * que va en `fields` es un solo botón bajo el €.
   */
  it('no monta la composición del alta', () => {
    for (const fuente of [EDICION, RUTA_MOVIMIENTO]) {
      expect(fuente).not.toContain('MovementFields');
      expect(fuente).not.toContain('EntryKindSelector');
      expect(fuente).not.toContain('DateSheet');
    }

    // El hueco de arriba —el selector de clase— sigue vacío.
    expect(EDICION).not.toContain('header=');
  });

  /**
   * **LA CATEGORÍA ES EL COMPONENTE DEL ALTA, no una copia.**
   *
   * Mismo `CategoryMenu`, mismo catálogo resuelto por `useEntryCategories`,
   * misma medida —importada, no reescrita—, misma etiqueta y mismo repliegue
   * cuando el identificador guardado ya no está en la lista. De la ventana no
   * sale ni un color ni un icono.
   */
  it('la categoría se reutiliza entera, y sólo para un gasto', () => {
    expect(EDICION).toContain('<CategoryMenu');
    /*
     * En `aside`, no en `fields`: dentro de la fila de la cifra y a la
     * derecha del control de moneda. Ahi no cuesta alto, y la ventana mide
     * exactamente lo que media antes de que el selector existiera.
     */
    expect(EDICION).toContain('aside={');
    expect(EDICION).not.toContain('fields={');
    expect(EDICION).toContain("import { CategoryMenu } from './category-menu'");
    expect(EDICION).toContain("import { CIRCLE } from './movement-fields'");
    expect(EDICION).toContain('size={CIRCLE}');
    // Con el actor: el catálogo cacheado de respaldo está aislado por cuenta.
    expect(RUTA_MOVIMIENTO).toContain('useEntryCategories(');
    expect(RUTA_MOVIMIENTO).toContain('categories={categories.rows}');

    // Ni un color, ni un icono, ni una cifra de paleta escritos aquí.
    expect(EDICION).not.toMatch(/#[0-9a-fA-F]{3}|rgba/);
    expect(EDICION).not.toContain('categoryColour');

    // Y la misma puerta de dominio que el alta: un ingreso no la monta.
    expect(EDICION).toContain('usesCategory(draft.kind)');
  });

  /**
   * **La misma composición compacta que el editor del saldo.** Las dos entregan
   * a `AmountSheet` el mismo juego de props, y ninguna le pasa `header` ni
   * `fields`: si lo que va dentro es lo mismo, lo que se ve es lo mismo.
   */
  it('entrega a la hoja lo mismo que el editor del saldo', () => {
    for (const fuente of [EDICION, EDITOR]) {
      expect(fuente).toContain('<AmountSheet');
      expect(fuente).toContain('entry={');
      expect(fuente).toContain('onChangeEntry={');
      expect(fuente).toContain('amountLabel={');
      expect(fuente).toContain('currency={');
      expect(fuente).toContain('saveLabel={');
      expect(fuente).toContain('saveDisabled={');
      expect(fuente).toContain('onSave={');
      expect(fuente).not.toContain('header=');
    }

    // El editor del saldo NO gana campos: su ranura sigue vacía.
    expect(EDITOR).not.toContain('fields=');
  });

  /**
   * **Y la corrección NO se ha recortado con la interfaz.** Concepto,
   * categoría, fecha y hora siguen viajando con el valor que ya tenían: el
   * borrador arranca de la versión vigente y se manda entero, así que lo que no
   * se toca se conserva. La ventana enseña menos; el comando dice lo mismo.
   */
  it('conserva concepto, categoría y fecha al guardar', () => {
    // El borrador sale de la versión vigente, con sus cuatro campos.
    expect(BORRADOR).toContain("initial?.concept ?? ''");
    expect(BORRADOR).toContain('initial?.categoryId ?? null');
    expect(BORRADOR).toContain('initial?.date ?? todayInDeviceCalendar()');
    expect(BORRADOR).toContain('initial?.time ?? currentClockTime()');

    // Y la ruta los recibe todos, aunque hoy no se dibujen.
    for (const campo of ['concept', 'categoryId', 'date', 'time']) {
      expect(RUTA_MOVIMIENTO, campo).toContain(campo + ':');
    }

    // Se manda el borrador ENTERO, no sólo el importe.
    expect(EDICION).toContain('save(draft.draft, {');

    // Y el payload los lleva todos.
    const entrada = code('features/personal/movement-entry.ts');
    expect(entrada).toContain('concept: draft.concept.trim()');
    expect(entrada).toContain('category_id: draft.categoryId');
    expect(entrada).toContain('effective_date: draft.date');
    expect(entrada).toContain('effective_time: draft.time');
  });

  /** Sin cambios no se escribe. */
  it('el no-op no genera versión', () => {
    expect(EDICION).toContain('sameEntry(');
    expect(EDICION).toContain('saveDisabled={draft.blocker !== null || untouched}');
  });

  /** El fallo conserva la ventana y no filtra tecnicismos. */
  it('el fallo conserva la ventana y el borrador', () => {
    expect(EDICION).toContain("t('entry.editFailed')");
    expect(EDICION).toContain('if (ok) onSaved();');
    for (const codigo of ['PAYLOAD_INVALID', 'VERSION_CONFLICT', 'PGRST', 'rpc(']) {
      expect(EDICION, codigo).not.toContain(codigo);
    }
  });

  /** Y al volver, Home se rehace desde el servidor. */
  it('el éxito cierra y Home se refresca al volver', () => {
    expect(RUTA_MOVIMIENTO).toContain('onSaved={close}');
    expect(HOME_CODE).toContain('useRefreshOnReturn(home.refresh)');
    expect(EDICION).not.toContain('statistics');
    expect(EDICION).not.toContain('balance');
  });
});

/**
 * LA VENTANA CONVERGE ANTES DEL CONTENIDO, y se puede señalar dónde.
 *
 * Las dos rutas montan la pieza de ventana y los dos contenidos la composicion.
 * Ninguno de los cuatro ficheros propios declara un estilo, así que la igualdad
 * no depende de que nadie se despiste: para separarlas habría que cambiar la
 * pieza común, y entonces cambian las dos.
 */
describe('las dos rutas de edición comparten la ventana', () => {
  it('las dos montan la MISMA pieza de ventana', () => {
    expect(RUTA_SALDO).toContain('<EditWindow');
    expect(RUTA_MOVIMIENTO).toContain('<EditWindow');

    const piezas = FILES.filter((f) => f.text.includes('export function EditWindow'));
    expect(piezas.map((f) => f.path)).toEqual(['features/shell/edit-window.tsx']);

    // Y ninguna monta el armazón por su cuenta.
    expect(RUTA_SALDO).not.toContain('SheetWindow');
    expect(RUTA_MOVIMIENTO).not.toContain('SheetWindow');
  });

  it('los dos contenidos montan la MISMA composición', () => {
    expect(EDITOR).toContain('<AmountSheet');
    expect(EDICION).toContain('<AmountSheet');
    const hojas = FILES.filter((f) => f.text.includes('export function AmountSheet'));
    expect(hojas.map((f) => f.path)).toEqual(['features/personal/amount-sheet.tsx']);
  });

  /**
   * Ninguna pieza propia declara geometría: no hay dos juegos de números.
   *
   * La única excepción es la ALINEACIÓN del botón de categoría de corregir un
   * movimiento, que no es geometría sino colocación: `alignItems` y nada más.
   * Sigue sin haber medidas, ni acolchados, ni radios — la del círculo se
   * importa de donde ya vivía.
   */
  it('ninguna pantalla ni ruta declara geometría propia', () => {
    for (const fuente of [EDITOR, EDICION, RUTA_SALDO, RUTA_MOVIMIENTO]) {
      expect(fuente).not.toContain('StyleSheet');
      expect(fuente).not.toContain('style={');
      expect(fuente).not.toContain('padding');
      expect(fuente).not.toContain('borderRadius');
      expect(fuente).not.toContain('width:');
      expect(fuente).not.toContain('height:');
    }
  });

  /** El fondo y su limpieza, también desde la pieza común. */
  it('el fondo y el cierre salen de la pieza compartida', () => {
    expect(VENTANA_EDICION).toContain('useAddBackdrop()');
    expect(VENTANA_EDICION).toContain('useEffect(() => hideBackdrop, [hideBackdrop])');
    expect(VENTANA_EDICION).toContain('onClosed={router.back}');
    for (const ruta of [RUTA_SALDO, RUTA_MOVIMIENTO]) {
      expect(ruta).not.toContain('hideBackdrop');
    }
    // Y el lápiz lo enciende antes de navegar, en las dos entradas.
    expect(HOME_CODE.match(/backdrop\.show\(\)/g) ?? []).toHaveLength(2);
  });

  /** Sólo cambian el título y el contenido. */
  it('sólo cambian el título y el contenido', () => {
    expect(RUTA_SALDO).toContain("t('home.balanceTitle')");
    expect(RUTA_MOVIMIENTO).toContain("t('entry.editTitle')");
    for (const ruta of [RUTA_SALDO, RUTA_MOVIMIENTO]) {
      expect(ruta).not.toContain('Editar');
    }
  });

  /** Y «Añadir movimiento» sigue aparte, sin modo de edición. */
  it('el alta sigue independiente', () => {
    expect(FORM).not.toContain('edit');
    expect(VENTANA).not.toContain('operationId');
    expect(VENTANA).toContain("t('entry.title')");
  });
});

/**
 * EL COLOR DE LA CATEGORÍA EN «MOVIMIENTOS RECIENTES».
 *
 * Un gasto con categoría resuelta lleva el círculo del color de su categoría —
 * el mismo `categoryColour` que pinta el donut y su leyenda, de modo que sector
 * y fila coinciden sin que nadie los sincronice.
 *
 * **El color no identifica solo.** El icono y el nombre siguen ahí; esto añade
 * una tercera señal y no sustituye a las otras dos.
 */
describe('el círculo de la fila lleva el color de su categoría', () => {
  /**
   * **LO TRAE LA FILA, y ninguna superficie puede quitárselo.**
   *
   * Vivía tras `tintByCategory`, opcional, con el argumento de que el color
   * pertenecía a «Movimientos recientes». La segunda superficie que montó esta
   * fila —las tarjetas de Ingresos y Gastos desplegadas— no la pidió, y el
   * mismo gasto se veía de dos colores según desde dónde se mirase. El color de
   * una categoría es identidad de la categoría, así que viaja con la fila igual
   * que su icono y su nombre.
   */
  it('la identidad de la categoría no es opcional', () => {
    expect(ROW).not.toContain('tintByCategory');
    expect(HOME_CODE).not.toContain('tintByCategory');

    // Y la resuelve la MISMA función que pinta el donut y su leyenda.
    expect(ROW).toContain('categoryColour(category.id)');
  });

  /**
   * Los DOS montajes vivos de la fila comparten identidad porque comparten
   * componente: la lista de Inicio y el grupo que va dentro de las tarjetas de
   * flujo. Si apareciera un tercero que resolviese el color por su cuenta, esto
   * lo delata.
   */
  it('nadie resuelve el color de una fila por su cuenta', () => {
    expect(HOME_CODE.match(/<MovementRow/g)).toHaveLength(2);
    expect(HOME_CODE).not.toContain('categoryColour(');
  });

  /** 1 · Gasto resuelto: fondo de la paleta e icono oscuro. */
  it('un gasto con categoría resuelta se tiñe, con el icono en el fondo del tema', () => {
    expect(ROW).toContain("kind === 'expense'");
    expect(ROW).toContain('categoryColour(category.id)');
    expect(ROW).toContain('backgroundColor: tint ?? theme.surfaceRaised');
    // El icono NO va en blanco: los contrastes de la paleta están medidos
    // contra `surface`, y su mínimo es 4.11:1.
    expect(ROW).toContain('colour={tint === null ? theme.textSecondary : theme.surface}');
    expect(ROW).not.toContain("colour={'#FFFFFF'}");
  });

  /** 2 · Ingreso y ajuste: exactamente el círculo neutro de antes. */
  it('un ingreso y un ajuste conservan su círculo neutro', () => {
    // La condición es por CLASE, así que ninguna de las dos entra.
    const condicion = ROW.slice(ROW.indexOf('const tint ='), ROW.indexOf('categoryColour('));
    expect(condicion).toContain("kind === 'expense'");
    expect(condicion).not.toContain('income');
    expect(condicion).not.toContain('adjustment');

    // Y sus símbolos direccionales no se tocan.
    expect(ROW).toContain("ios: 'slider.horizontal.3', android: 'tune'");
    expect(ROW).toContain("ios: 'arrow.down.left', android: 'south_west'");
  });

  /**
   * 3 · Sin categoría resoluble, círculo neutro.
   *
   * Se exige el NOMBRE, no que exista la fila: teñir por una clave que esta
   * versión no sabe leer sería derivar presentación de un identificador
   * desconocido. Una retirada del catálogo activo sí se tiñe, porque su
   * histórico sigue resolviendo nombre e icono (ADR-021).
   */
  it('una categoría que no se puede nombrar no se tiñe', () => {
    expect(ROW).toContain('category !== undefined');
    expect(ROW).toContain('categoryLabel !== null');
    expect(ROW).toContain('const categoryLabel = categoryName(category, t);');
    // El nombre sigue resolviéndose por el mismo camino de siempre.
    expect(ROW).toContain("categoryLabel ?? t('home.categoryUnknown')");
  });

  /** 4 · Ni el donut, ni su leyenda, ni el selector cambian. */
  it('no toca el diagrama, su leyenda ni el selector', () => {
    // La paleta se reutiliza; no se crea una segunda.
    expect(ROW).toContain("from '@/ui/theme'");
    expect(ROW).not.toContain('categoryColours');
    expect(ROW).not.toContain('#');

    // Y el color no se persiste en ninguna parte.
    expect(ROW).not.toContain('colour:');
  });
});

/**
 * EL DESPLAZAMIENTO DE INICIO NO ENSEÑA SU BARRA.
 *
 * Es sólo el indicador: no se toca el gesto, ni el rebote, ni la posición, ni
 * lo que anuncia el lector de pantalla — nada de `scrollEnabled`, `overflow` ni
 * alturas. Y no se sustituye por una barra dibujada a mano.
 */
describe('la barra de desplazamiento de Inicio', () => {
  it('el contenedor de la página oculta su indicador vertical', () => {
    expect(HOME_CODE).toContain('showsVerticalScrollIndicator={false}');
    expect(HOME_CODE).not.toContain('scrollEnabled={false}');
  });

  /**
   * **Y sólo el de Inicio.** El contenedor está declarado en esta pantalla, no
   * compartido, así que la decisión no puede escaparse a otro desplazamiento;
   * esta guarda lo comprueba en vez de confiarlo.
   */
  it('ningún otro desplazamiento de la app pierde el suyo', () => {
    const otros = FILES.filter(
      (f) => f.path !== 'app/(tabs)/index.tsx' && f.text.includes('<ScrollView'),
    );
    expect(otros.length).toBeGreaterThan(0);
    for (const fuente of otros) {
      expect(code(fuente.path), fuente.path).not.toContain('showsVerticalScrollIndicator');
    }
  });

  /** Ni se dibuja una propia para reemplazarla. */
  it('no se sustituye por una barra a mano', () => {
    expect(HOME_CODE).not.toContain('scrollbar');
    expect(HOME_CODE).not.toContain('onScroll');
  });
});

/**
 * LA SUPERFICIE DE ELIMINAR OCUPA TODO SU RECORRIDO.
 *
 * La geometría —reposo, arrastre parcial, encaje, cancelación y segundo gesto—
 * se comprueba como aritmética en `tests/lib/swipe-geometry.test.ts`. Aquí se
 * fija lo que esa función no puede saber: que lo PINTADO y lo PULSABLE miden lo
 * mismo que lo recorrido.
 */
describe('la acción de eliminar: recorrido, área táctil y superficie', () => {
  const bloque = (nombre: string): string =>
    SWIPE.slice(SWIPE.indexOf(nombre + ': {'), SWIPE.indexOf('},', SWIPE.indexOf(nombre + ': {')));

  /**
   * **RECORRIDO Y ÁREA TÁCTIL SON LA MISMA CIFRA.** Lo que se arrastra, dónde
   * ancla y lo que se puede pulsar salen de una sola constante, así que no hay
   * dos distancias que puedan descuadrarse.
   */
  it('lo que se recorre y lo que se pulsa miden igual', () => {
    expect(bloque('slot')).toContain('width: DELETE_ACTION_WIDTH');
    expect(SWIPE).toContain('deleteActionOffset(drag.value, DELETE_ACTION_WIDTH)');
    // Ninguna segunda distancia de la que separarse.
    expect(SWIPE).not.toContain('FOOTPRINT');
    expect(SWIPE).not.toContain('GUTTER');
  });

  /**
   * **EL HUECO NO PINTA NI SE ENCOGE.** Un margen a un solo lado es la franja
   * vacía que hubo aquí: ocho puntos del recorrido sin pintar que dejaban la
   * acción más estrecha de lo que se arrastraba.
   */
  it('el hueco pulsable no lleva márgenes ni relleno', () => {
    const slot = bloque('slot');
    for (const encogido of ['margin', 'padding']) {
      expect(slot, encogido).not.toContain(encogido);
    }
    // Y lo pulsable es ese hueco, no una caja interior más pequeña.
    const pulsable = SWIPE.slice(SWIPE.indexOf('<Pressable'), SWIPE.indexOf('</Pressable>'));
    expect(pulsable).toContain('style={styles.slot}');
    expect(pulsable).toContain('accessibilityRole="button"');
  });

  /**
   * **CADA CAPA DECLARA SU ALTO; ninguna lo deduce de la de abajo.**
   *
   * Aquí la superficie se dimensionaba con `flex: 1` dentro de un `Pressable`
   * de alto automático, y eso resuelve a CERO: `flex: 1` fija `flexBasis: 0` y
   * sin un alto definido arriba no hay nada que repartir. No se pintaba ni el
   * rojo ni la papelera, mientras el hueco seguía abriéndose porque el
   * recorrido no depende de esto.
   *
   * Esto fija la cadena de medidas, que es lo comprobable sin aparato. **Que se
   * vea sigue exigiendo la prueba física**: ninguna de estas afirmaciones lo
   * demuestra.
   */
  it('el envoltorio y el hueco declaran su alto', () => {
    for (const capa of ['wrapper', 'slot']) {
      expect(bloque(capa), capa).toContain("height: '100%'");
      expect(bloque(capa), capa).toContain('width: DELETE_ACTION_WIDTH');
    }
    // Y el envoltorio animado lleva ese tamaño además de su traslación.
    expect(SWIPE).toContain('style={[styles.wrapper, slot]}');
  });

  /**
   * **TODAS LAS MEDIDAS SALEN DE UNA SOLA DECISIÓN: el lado del botón.**
   *
   * El hueco es su consecuencia —lado más dos veces el aire—, así que no puede
   * quedar una franja vacía entre el contenido y el rojo: fue exactamente el
   * defecto que tuvo esto cuando eran dos cifras sueltas.
   */
  it('el hueco se deriva del botón, y no al revés', () => {
    const geometria = code('ui/components/swipe-geometry.ts');
    expect(geometria).toContain(
      'DELETE_ACTION_WIDTH = DELETE_ACTION_SIZE + DELETE_ACTION_INSET * 2',
    );
    expect(geometria).toContain('DELETE_ACTION_INSET = Spacing.xxs');
    // Y no hay una segunda cifra suelta de la que separarse.
    expect(SWIPE).not.toContain('FOOTPRINT');
    expect(SWIPE).not.toContain('GUTTER');
  });

  /**
   * **EL BOTÓN ES CUADRADO Y DE TAMAÑO FIJO.**
   *
   * Ni `flex` ni anclajes a los cuatro lados: lo primero fija `flexBasis: 0` y
   * en un padre de alto automático resuelve a cero —por eso no se pintaba—; lo
   * segundo lo ataba al alto de la fila, y al desplegar una operación se
   * estiraría con su detalle hasta ser una columna roja.
   */
  it('el botón declara su lado y no depende de la fila', () => {
    const surface = bloque('surface');
    expect(surface).toContain('width: DELETE_ACTION_SIZE');
    expect(surface).toContain('height: DELETE_ACTION_SIZE');
    for (const atadura of ['flex:', "position: 'absolute'", 'top: 0', 'bottom: 0', "'100%'"]) {
      expect(surface, atadura).not.toContain(atadura);
    }
  });

  /** Y va centrado en su hueco: el mismo aire a los cuatro lados. */
  it('el botón queda centrado dentro del hueco', () => {
    const slot = bloque('slot');
    expect(slot).toContain("alignItems: 'center'");
    expect(slot).toContain("justifyContent: 'center'");
  });

  /** La papelera va centrada en esa superficie, y el glifo no cambia. */
  it('el icono queda centrado y con su tamaño de siempre', () => {
    const surface = bloque('surface');
    expect(surface).toContain("justifyContent: 'center'");
    expect(surface).toContain("alignItems: 'center'");
    expect(SWIPE).toContain('size={20}');
  });
});

/**
 * UNA SOLA FUENTE PARA LA TARJETA Y PARA EL HUECO DEL DONUT.
 *
 * **Igualar el hexadecimal no iguala lo que se ve.** Se le dio a Android el `#0C0C0C` medido en una captura de iOS y las tarjetas
 * volvieron a confundirse con el negro: en iOS ese color lleva encima el
 * material de `GlassView`, y en Android no hay tal cosa. El rol existe por eso.
 *
 * Y el hueco del donut sale del MISMO sitio, porque es esa superficie vista por
 * un agujero: cuando la tarjeta se aclaró y el hueco no, el centro apareció
 * negro sobre gris. Con una sola fuente no pueden separarse.
 */
describe('el material de las tarjetas de Inicio', () => {
  const TARJETAS = [
    'features/personal/balance-card.tsx',
    'features/personal/flow-card.tsx',
    'features/personal/category-card.tsx',
  ] as const;

  /** Las cuatro piden el rol; ninguna escribe un color. */
  it('las cuatro tarjetas piden el mismo material', () => {
    for (const ruta of TARJETAS) {
      const fuente = code(ruta);
      expect(fuente, ruta).toContain('backgroundColor: homeCardSurface(theme.surface)');
      expect(fuente, ruta).not.toMatch(/backgroundColor: '#/);
    }
  });

  /** El hueco del donut resuelve el mismo rol, no un color suyo. */
  it('el hueco del donut resuelve el material de la tarjeta', () => {
    const tarjeta = code('features/personal/category-card.tsx');
    expect(tarjeta).toContain('hole={homeCardSurface(theme.surface)}');
    expect(tarjeta).not.toContain('hole={theme.background}');
    expect(tarjeta).not.toMatch(/hole={'#/);
    expect(tarjeta).not.toContain("'#000000'");
  });

  /** El valor vive en un solo sitio y no se dispersa. */
  it('el material del rol está centralizado', () => {
    const tokens = code('ui/theme/elevation.ts');
    expect(tokens).toContain("homeCard: '#1C1C1E'");
    expect(tokens.match(/homeCard: '#/g) ?? []).toHaveLength(1);
    const dispersos = FILES.filter(
      (f) => f.path !== 'ui/theme/elevation.ts' && code(f.path).includes('#1C1C1E'),
    );
    expect(dispersos.map((f) => f.path)).toEqual([]);
  });

  /**
   * **EL TINTE NO PUEDE COMERSE EL BORDE NI EL RESALTE.** Al subir la tarjeta a
   * su gris, el borde `#2A2A2A` paso de treinta puntos de contraste a catorce y
   * dejo de verse: la tarjeta quedo como un rectangulo opaco. El relieve va
   * DESPUES del color en el array, para que en Android mande el suyo.
   */
  it('el material no sustituye el borde ni el resalte', () => {
    for (const ruta of TARJETAS) {
      const fuente = code(ruta);
      expect(fuente, ruta).toContain('HomeCardRelief');
      // El orden importa: primero el color, despues el relieve.
      const color = fuente.indexOf('homeCardSurface(theme.surface), borderColor');
      // Se busca DESDE el color: la importacion tambien lo nombra, y va antes.
      expect(fuente.indexOf('HomeCardRelief,', color), ruta).toBeGreaterThan(color);
    }
  });

  /** Y el relieve son sus tres funciones, sin numeros de sombra nuevos. */
  it('el relieve lleva borde, resalte y sombra corta', () => {
    const depth = code('ui/theme/depth.ts');
    expect(depth).toContain('borderWidth: 1');
    expect(depth).toContain('blurRadius: RimBlur.catch');
    expect(depth).toContain("...castShadow('well')");
    // Ninguna sombra escrita a mano: la calibracion global sigue en pausa.
    expect(depth).not.toContain("color: 'rgba(0, 0, 0");
  });

  /** En iOS es : ni capa, ni rama, ni arbol distinto. */
  it('en iOS el relieve no existe', () => {
    expect(code('ui/theme/depth.ts')).toContain("Platform.OS === 'android'");
    expect(code('ui/theme/depth.ts')).toContain(': undefined;');
  });

  /** En iOS devuelve el del tema: esa superficie no cambia. */
  it('iOS conserva el surface del tema', () => {
    expect(code('ui/theme/depth.ts')).toContain(
      "Platform.OS === 'android' ? AndroidSurface.homeCard : delTema",
    );
  });

  /** Y la ventana no comparte ese material aunque comparta primitive. */
  it('SheetWindow conserva el suyo', () => {
    const ventana = code('ui/components/sheet-window.tsx');
    expect(ventana).toContain('level="heavy"');
    expect(ventana).not.toContain('homeCardSurface');
    expect(ventana).not.toContain('AndroidSurface');
  });
});

/**
 * LA COSTURA DEL TOROIDE, y por qué su cifra no es un ángulo.
 *
 * El recorte de las dos mitades cae en `DIAMETER / 2` = 62 dp, que a densidad
 * 2,625 son 162,75 píxeles físicos: la mitad derecha empieza en el píxel 163 y
 * la izquierda acaba en el 162, y la columna del medio no la pintaba ninguna.
 * Medido sobre el aparato antes de corregirlo: una columna de 28,28,30 a 0° y a
 * 180°, del canto del agujero al borde exterior.
 *
 * Lo que se fija aquí es que el arreglo siga siendo **geométrico y derivado de
 * la densidad**, y que no se cuele en su lugar un ángulo, un trazo o un cambio
 * de reparto.
 */
describe('el cierre del diagrama de sectores', () => {
  const fuente = code('features/personal/category-card.tsx');

  it('el solape es un píxel físico, y sólo en Android', () => {
    expect(fuente).toContain("const SEAM = Platform.OS === 'android' ? 1 / PixelRatio.get() : 0;");
  });

  it('se aplica a la caja del semicírculo y a su recorte, y a nada más', () => {
    expect(fuente).toContain('width: half + SEAM,');
    expect(fuente).toContain('left: DIAMETER / 2 - SEAM,');
    expect(fuente).toContain('width: DIAMETER / 2 + SEAM,');
    // La declaración y TRES usos: ni un cuarto que toque radios, agujero o
    // diámetro.
    expect(fuente.match(/SEAM/g)).toHaveLength(4);
  });

  it('el diámetro, el hueco y los radios del arco no se tocan', () => {
    expect(fuente).toContain('const DIAMETER = 124;');
    expect(fuente).toContain('const HOLE = 76;');
    expect(fuente).toContain('borderTopRightRadius: half,');
    expect(fuente).toContain('borderBottomRightRadius: half,');
  });

  it('no se tapó con una línea encima ni con un trazo', () => {
    const pie = fuente.slice(fuente.indexOf('function Pie('), fuente.indexOf('const styles ='));
    expect(pie).not.toMatch(/borderWidth|shadow|elevation/i);
  });
});
