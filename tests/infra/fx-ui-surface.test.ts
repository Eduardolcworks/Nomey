import { describe, expect, it } from 'vitest';

/**
 * LA EXPERIENCIA MULTIMONEDA, COMPROBADA SOBRE EL FUENTE (F11 UI).
 *
 * No hay biblioteca de test de componentes en el proyecto y no se añade una
 * para este bloque. Lo que aquí se afirma son propiedades **estructurales** que
 * un render tampoco demostraría mejor: que el catálogo sale de `api` y no de una
 * lista escrita a mano, que no se multiplica ningún tipo en el cliente, que la
 * conversión se lee de la función lectora y nunca de `core`, y que elegir la
 * moneda de una OPERACIÓN no toca la moneda BASE de nadie.
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
  return FILES.find((candidate) => candidate.path === relative)?.text ?? '';
}

/** El fuente sin comentarios: aquí se afirma sobre el código, no sobre la prosa. */
function code(relative: string): string {
  return file(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const HOJA = code('ui/components/amount-sheet.tsx');
const LISTA = code('ui/components/currency-list.tsx');
const CAMPO_GRUPO = code('features/groups/currency-field.tsx');
const CATALOGO = code('lib/currency/catalogue.ts');
const FORM_PERSONAL = code('features/personal/movement-form.tsx');
const EDITOR_PERSONAL = code('features/personal/movement-editor.tsx');
const FORM_GRUPO = code('features/groups/shared-expense-form.tsx');
const FILA_PERSONAL = code('features/personal/movement-row.tsx');
const FILA_GRUPO = code('features/groups/group-movement-row.tsx');

// ═══════════ 1 · UN SOLO DESPLEGABLE DE DIVISAS, Y VIVE EN `ui/` ═════════════
describe('el selector de moneda se reutiliza, no se duplica', () => {
  it('la lista está en el sistema de diseño y no lee de `lib/`', () => {
    expect(LISTA).not.toBe('');
    expect(LISTA).not.toMatch(/from '@\/lib\//);
    expect(LISTA).not.toMatch(/useTranslation/);
  });

  it('el campo de la divisa de un grupo usa ESA lista, y ya no monta la suya', () => {
    expect(CAMPO_GRUPO).toMatch(/<CurrencyList/);
    // El `ScrollView` propio se retiró: si vuelve, hay dos listas otra vez.
    expect(CAMPO_GRUPO).not.toMatch(/ScrollView/);
  });

  it('el control de moneda de la hoja del importe abre ESA misma lista', () => {
    expect(HOJA).toMatch(/<CurrencyList/);
    expect(HOJA).toMatch(/currencyOptions/);
    expect(HOJA).toMatch(/onSelectCurrency/);
  });

  /*
   * SIN CATÁLOGO, EL CONTROL ES EL DE SIEMPRE. Es lo que conserva intactas las
   * pantallas que no eligen moneda —editar el Disponible— sin una rama aparte.
   */
  it('sin opciones el control conserva su nota y no abre nada', () => {
    expect(HOJA).toMatch(/noteShown && !selectable/);
  });
});

// ═══════════ 2 · EL CATÁLOGO ES `api.currency_definition`, ENTERO ════════════
describe('el catálogo es el del servidor y no se filtra en el cliente', () => {
  it('sale de la vista de `api`', () => {
    expect(CATALOGO).toMatch(/from\('currency_definition'\)/);
  });

  /*
   * ARS, COP y CLP siguen en la lista aunque hoy no tengan cobertura de cambio:
   * qué pares se pueden convertir un día dado lo decide la frontera
   * (`FX_CURRENCY_NOT_COVERED`), no esta pantalla, y además cambia cada día
   * hábil. Ningún filtro por código, ni lista blanca, ni negra.
   */
  it('no hay ninguna lista de códigos escrita a mano en el camino del selector', () => {
    for (const fuente of [CATALOGO, LISTA, HOJA, FORM_PERSONAL, FORM_GRUPO]) {
      expect(fuente).not.toMatch(/\bARS\b/);
      expect(fuente).not.toMatch(/'(EUR|USD|JPY)'/);
    }
  });

  it('y el selector ofrece el catálogo tal cual, sin descartar monedas', () => {
    expect(FORM_PERSONAL).toMatch(/currencyOptions=\{options\}/);
    expect(FORM_GRUPO).toMatch(/currencyOptions=\{options\}/);
    for (const fuente of [FORM_PERSONAL, FORM_GRUPO]) {
      expect(fuente).not.toMatch(/options\.filter/);
    }
  });
});

// ═══════════ 3 · NADA DE ARITMÉTICA DE CAMBIO EN EL CLIENTE ══════════════════
describe('el cliente no convierte: transporta', () => {
  const CAMINO = [
    'features/personal/movement-form.tsx',
    'features/personal/movement-editor.tsx',
    'features/personal/movement-entry.ts',
    'features/personal/movement-row.tsx',
    'features/groups/shared-expense-form.tsx',
    'features/groups/group-movement-row.tsx',
    'features/groups/group-service.ts',
    'lib/format/rate.ts',
  ];

  it('ni un `Number(`, ni `parseFloat`, ni `toFixed`, ni `Math.` en el camino FX', () => {
    for (const ruta of CAMINO) {
      const fuente = code(ruta);
      expect(fuente, ruta).not.toMatch(/\bparseFloat\(/);
      expect(fuente, ruta).not.toMatch(/\.toFixed\(/);
      expect(fuente, ruta).not.toMatch(/\bMath\.(round|floor|ceil|trunc|pow)\(/);
    }
  });

  /*
   * El coeficiente NUNCA se multiplica aquí: el importe convertido es el que el
   * servidor asentó, con su único redondeo (F11/ADR-001 §7).
   */
  it('el coeficiente sólo se formatea, nunca entra en una cuenta', () => {
    for (const ruta of CAMINO) {
      const fuente = code(ruta);
      expect(fuente, ruta).not.toMatch(/rate_coefficient\s*[*/]/);
      expect(fuente, ruta).not.toMatch(/[*/]\s*rate_coefficient/);
      expect(fuente, ruta).not.toMatch(/BigInt\(\s*\w*\.?rate_coefficient/);
    }
  });

  it('y el tipo se pinta con `format.rate`, que coloca dígitos sin construir números', () => {
    expect(FILA_PERSONAL).toMatch(/format\.rate\(/);
    expect(FILA_GRUPO).toMatch(/format\.rate\(/);
    expect(code('lib/format/rate.ts')).not.toMatch(/\bNumber\(/);
  });
});

// ═══════════ 4 · LO QUE SE VE: ORIGINAL, CONVERTIDO, TIPO Y FUENTE ═══════════
describe('una operación convertida se explica entera', () => {
  it('la fila personal enseña el original como principal y el convertido debajo', () => {
    expect(FILA_PERSONAL).toMatch(/const principal = original \?\? amount/);
    expect(FILA_PERSONAL).toMatch(/home\.convertedAmount/);
    expect(FILA_PERSONAL).toMatch(/home\.rateValue/);
    expect(FILA_PERSONAL).toMatch(/home\.rateSourceEcb/);
  });

  /* El MISMO formato en el grupo: no se inventa uno distinto. */
  it('la fila del grupo usa las mismas claves y las mismas primitivas', () => {
    expect(FILA_GRUPO).toMatch(/home\.convertedAmount/);
    expect(FILA_GRUPO).toMatch(/home\.rateValue/);
    expect(FILA_GRUPO).toMatch(/home\.rateSourceEcb/);
    expect(FILA_GRUPO).toMatch(/home\.detailConverted/);
  });

  /*
   * SIN CONVERSIÓN NO SE PINTA UNA SECCIÓN DE CAMBIO VACÍA. En el grupo la
   * condición es doble —conversión congelada Y moneda declarada resuelta—
   * porque media explicación es peor que ninguna.
   */
  it('sin conversión no hay sección de cambio en ninguna de las dos', () => {
    expect(FILA_GRUPO).toMatch(/converted === null/);
    expect(FILA_PERSONAL).toMatch(/original === null \|\| conversionPending \? null/);
  });

  /* Y la pendiente NO enseña un convertido: no lo hay todavía. */
  it('una conversión pendiente enseña su estado, nunca una cifra convertida', () => {
    expect(FILA_PERSONAL).toMatch(/home\.conversionPending/);
    expect(FILA_PERSONAL).toMatch(/conversionPending \?/);
  });
});

// ═══════════ 5 · LA CONVERSIÓN SE LEE POR SU FUNCIÓN, NUNCA DE `core` ════════
describe('de dónde sale la conversión congelada', () => {
  const SERVICIO = code('features/groups/group-service.ts');

  it('el grupo la pide a su función lectora', () => {
    expect(SERVICIO).toMatch(/rpc\('group_operation_conversion'/);
  });

  /* Ni una consulta a esa tabla: el cliente no tiene acceso y no lo pide. La
   * prosa sí puede nombrarla —explica por qué NO se toca—, así que se afirma
   * sobre el código. */
  it('y el cliente no consulta `core.frozen_conversion` en ninguna parte', () => {
    for (const { path } of FILES) {
      expect(code(path), path).not.toMatch(/frozen_conversion/);
    }
  });

  it('el personal sigue usando la suya, sin tocarla', () => {
    expect(code('features/personal/personal-service.ts')).toMatch(
      /rpc\('personal_operation_conversion'/,
    );
  });
});

// ═══════════ 6 · LOS TRES CÓDIGOS FX SE DICEN POR SU CAUSA ═══════════════════
describe('los rechazos de cambio no caen en el mensaje genérico', () => {
  it('la corrección personal los distingue', () => {
    expect(EDITOR_PERSONAL).toMatch(/FX_CURRENCY_NOT_COVERED/);
    expect(EDITOR_PERSONAL).toMatch(/FX_CONVERSION_OUT_OF_RANGE/);
    expect(EDITOR_PERSONAL).toMatch(/FX_RATE_NOT_YET_AVAILABLE/);
  });

  it('el gasto de grupo también', () => {
    expect(FORM_GRUPO).toMatch(/FX_CURRENCY_NOT_COVERED/);
    expect(FORM_GRUPO).toMatch(/FX_CONVERSION_OUT_OF_RANGE/);
    expect(FORM_GRUPO).toMatch(/FX_RATE_NOT_YET_AVAILABLE/);
  });

  /*
   * Y EL CÓDIGO LLEGA HASTA AHÍ: sin conservarlo, el mapa de arriba no podría
   * distinguir nada. Era el defecto: un `catch` que perdía el motivo.
   */
  it('la corrección personal conserva el código del fallo', () => {
    const HOOK = code('features/personal/use-record-movement.ts');
    expect(HOOK).toMatch(/setCode\(boundaryCode\(error\)\)/);
    expect(HOOK).toMatch(/return \{ status, code, save \}/);
  });

  /* Y `CURRENCY_CONVERSION_UNSUPPORTED` conserva exactamente su trato. */
  it('el conflicto monetario de F7 sigue donde estaba', () => {
    expect(FORM_GRUPO).toMatch(/CURRENCY_CONVERSION_UNSUPPORTED: 'group\.expenseCurrency'/);
    expect(code('lib/offline/response.ts')).toMatch(/CURRENCY_CONVERSION_UNSUPPORTED/);
  });
});

// ═══════════ 7 · LA MONEDA DE LA OPERACIÓN NO ES LA MONEDA BASE ═════════════
describe('elegir la moneda de una operación no cambia ninguna base', () => {
  /*
   * F11 UI NO implementa el cambio de moneda base, ni de Personal ni de Grupo.
   * `api.set_personal_base_currency` existe desde F6 y **sigue sin tener ningún
   * llamador en el cliente**; el editor de un grupo sigue enseñando su divisa
   * bloqueada.
   */
  it('nadie llama a `set_personal_base_currency`', () => {
    for (const { path, text } of FILES) {
      if (path === 'types/database.ts') continue;
      expect(code(path), path).not.toMatch(/set_personal_base_currency/);
    }
  });

  it('la divisa de un grupo ya creado se sigue viendo bloqueada', () => {
    expect(code('features/groups/group-form.tsx')).toMatch(/locked/);
    expect(code('features/groups/currency-field.tsx')).toMatch(/locked/);
  });

  /*
   * Y la base asumida que viaja en el payload es SIEMPRE la del ámbito, nunca
   * la elegida: es lo que el servidor compara bajo el cerrojo contra la base
   * vigente (F11/ADR-001 §10).
   */
  it('la base asumida sale del ámbito, no del selector', () => {
    const ENTRADA = code('features/personal/movement-entry.ts');
    expect(ENTRADA).toMatch(
      /const base = scope\.baseCurrencyDefinitionId \?\? scope\.currencyDefinitionId/,
    );
    expect(FORM_GRUPO).toMatch(/baseCurrencyDefinitionId: currencyDefinitionId/);
  });

  /*
   * UNA TRANSFERENCIA VA SIEMPRE EN LA BASE (F12/ADR-002 §20). Por eso la
   * elección vive DENTRO del formulario y no en la ruta: el ámbito que la ruta
   * entrega a `TransferForm` sigue siendo el del Personal con su base.
   */
  it('el segmento de transferencia recibe el ámbito de la ruta, sin moneda elegida', () => {
    expect(code('app/add.tsx')).toMatch(/<TransferForm\s+scope=\{scope\}/);
    expect(FORM_PERSONAL).toMatch(/next === 'transfer' && chosen !== null/);
  });
});

// ═══════════ 8 · EL REPARTO DEL GRUPO SE CALCULA EN LA DECLARADA ═════════════
describe('el reparto se valida donde se escribió', () => {
  /*
   * F11/ADR-003: lo declarado se valida en la moneda declarada, y el reparto
   * del total convertido lo hace el servidor. Si el formulario repartiera en la
   * moneda del grupo tendría que convertir aquí, que es justo lo prohibido.
   */
  it('`computeSplit` recibe la moneda DECLARADA, no la del grupo', () => {
    expect(FORM_GRUPO).toMatch(/computeSplit\(current, declared,/);
    expect(FORM_GRUPO).toMatch(/const scale = declared\.scale/);
  });

  it('y las cuotas de la tarjeta se pintan en esa misma moneda', () => {
    expect(FORM_GRUPO).toMatch(/currency=\{declared\}/);
  });
});
