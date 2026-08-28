import { describe, expect, it } from 'vitest';

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
   */
  it('cambiar de intervalo no refetchea el saldo ni el catálogo', () => {
    expect(HOOK).toContain('[ready, attempt]');
    expect(HOOK).toContain('[ready, key, attempt]');
  });
});

describe('lo que no se adelanta', () => {
  /**
   * **La escritura es de F6.F.** Los botones de editar y eliminar existen
   * visualmente porque la pantalla los necesita para estar completa, pero no
   * hay ninguna llamada de escritura en todo el dominio.
   */
  it('ninguna función de escritura se invoca desde Inicio', () => {
    for (const source of [...PERSONAL, { path: 'app/(tabs)/index.tsx', text: HOME }]) {
      expect(source.text, source.path).not.toContain('record_personal_expense');
      expect(source.text, source.path).not.toContain('record_personal_income');
      expect(source.text, source.path).not.toContain('record_adjustment');
      expect(source.text, source.path).not.toContain('annul_operation');
    }
  });

  it('editar y eliminar existen como affordance y anuncian que aún no están', () => {
    expect(HOME).toContain('home.soonBody');
    expect(file('features/personal/movement-row.tsx')).toContain('home.editMovement');
    expect(file('features/personal/movement-row.tsx')).toContain('home.deleteMovement');
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
    expect(SCOPE).toContain('[attempt]');
    expect(SCOPE).toContain('inFlight');
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
  it('Inicio contempla cargando, error recuperable y vacío', () => {
    expect(HOME).toContain('LoadingState');
    expect(HOME).toContain('ErrorState');
    expect(HOME).toContain('EmptyState');
    expect(HOME).toContain('onPress: scope.retry');
    expect(HOME).toContain('onPress: home.refresh');
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
   * El desvanecido inferior es decorativo y no puede capturar gestos ni
   * anunciarse: taparía la última fila accesible.
   */
  it('el desvanecido no intercepta el gesto ni se anuncia', () => {
    const fade = file('ui/components/fade-edge.tsx');
    expect(fade).toContain('pointerEvents="none"');
    expect(fade).toContain('accessibilityElementsHidden');
    expect(HOME).toContain('<FadeEdge');
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
