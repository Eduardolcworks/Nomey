import { describe, expect, it } from 'vitest';

import {
  amountEntryFromMinor,
  amountParts,
  applyAmountInput,
  amountValue,
  blockerFor,
  buildPayload,
  calendarDateOf,
  canRecord,
  currentClockTime,
  dateFromCalendar,
  type EntryDraft,
  ENTRY_KINDS,
  INITIAL_ENTRY_KIND,
  sameEntry,
  toMinorUnits,
  usesCategory,
} from '../../src/features/personal/movement-entry';
import type { CalendarDate } from '../../src/lib/format';

const SCOPE = {
  scopeId: 's-1',
  currencyDefinitionId: 'eur-1',
  currencyScale: 2,
};

function draft(over: Partial<EntryDraft> = {}): EntryDraft {
  return {
    kind: 'expense',
    amount: '12,50',
    concept: 'Mercadona',
    categoryId: 'cat-1',
    date: '2026-09-01' as CalendarDate,
    time: '13:00',
    ...over,
  };
}

describe('el importe se convierte sin pasar por un número', () => {
  /**
   * Es el requisito de ADR-003 §1 llevado al teclado. `parseFloat('0.29') * 100`
   * da `28.999999999999996`, y ese céntimo perdido no lanza nada: aparece en el
   * saldo. Toda la conversión es texto y `bigint`.
   */
  it('la coma y el punto son el mismo separador', () => {
    expect(toMinorUnits('12,50', 2)).toBe(1250n);
    expect(toMinorUnits('12.50', 2)).toBe(1250n);
  });

  it('el caso que rompe el punto flotante sale exacto', () => {
    expect(toMinorUnits('0.29', 2)).toBe(29n);
    expect(toMinorUnits('1.005', 3)).toBe(1005n);
  });

  it('los decimales que faltan se rellenan, no se adivinan', () => {
    expect(toMinorUnits('7', 2)).toBe(700n);
    expect(toMinorUnits('7.5', 2)).toBe(750n);
  });

  /**
   * **La escala sale de la moneda, nunca fijada a dos.** JPY tiene 0 y la misma
   * pantalla tiene que servir; codificar 2 aquí es el error que AGENTS.md §1
   * nombra por su nombre.
   */
  it('una moneda sin decimales no acepta decimales', () => {
    expect(toMinorUnits('700', 0)).toBe(700n);
    expect(toMinorUnits('7.5', 0)).toBeNull();
  });

  it('más decimales de los que la moneda tiene se rechazan, no se redondean', () => {
    expect(toMinorUnits('1.234', 2)).toBeNull();
  });

  it('lo que no es un importe no lo es', () => {
    for (const bad of ['', '  ', 'doce', '1.2.3', '-5', '1e3', '12€']) {
      expect(toMinorUnits(bad, 2), bad).toBeNull();
    }
  });

  it('importes grandes no pierden precisión', () => {
    expect(toMinorUnits('90071992547409.91', 2)).toBe(9007199254740991n);
  });
});

describe('qué se puede registrar hoy', () => {
  /**
   * Transferencia está en el selector y **no** tiene ruta. Las dos funciones de
   * `api` que se llaman transferencia no sirven aquí: `record_internal_transfer`
   * exige dos ámbitos distintos y en la Fase 6 hay uno solo, y
   * `record_external_transfer` no admite concepto ni hora.
   */
  it('gasto e ingreso sí; transferencia no', () => {
    expect(canRecord('expense')).toBe(true);
    expect(canRecord('income')).toBe(true);
    expect(canRecord('transfer')).toBe(false);
  });

  it('la categoría es del gasto y de nadie más', () => {
    expect(usesCategory('expense')).toBe(true);
    expect(usesCategory('income')).toBe(false);
    expect(usesCategory('transfer')).toBe(false);
  });

  it('abre en gasto, que es lo que se registra casi siempre', () => {
    expect(INITIAL_ENTRY_KIND).toBe('expense');
    expect(ENTRY_KINDS).toEqual(['expense', 'income', 'transfer']);
  });
});

describe('qué impide guardar', () => {
  it('un gasto completo no lo impide nada', () => {
    expect(blockerFor(draft(), 2, true)).toBeNull();
  });

  it('un ingreso completo tampoco, y sin categoría', () => {
    expect(blockerFor(draft({ kind: 'income', categoryId: null }), 2, true)).toBeNull();
  });

  it('una transferencia lo impide siempre, esté como esté el formulario', () => {
    expect(blockerFor(draft({ kind: 'transfer' }), 2, true)).toBe('noRoute');
  });

  it('sin ámbito no se envía nada', () => {
    expect(blockerFor(draft(), 2, false)).toBe('noScope');
  });

  it('el cero no es un importe: el signo lo pone la clase', () => {
    expect(blockerFor(draft({ amount: '0' }), 2, true)).toBe('amountInvalid');
    expect(blockerFor(draft({ amount: '0,00' }), 2, true)).toBe('amountInvalid');
  });

  it('el concepto es obligatorio, y un espacio no es un concepto', () => {
    expect(blockerFor(draft({ concept: '   ' }), 2, true)).toBe('conceptMissing');
  });

  it('un gasto sin categoría se detiene aquí, antes de llegar a la frontera', () => {
    expect(blockerFor(draft({ categoryId: null }), 2, true)).toBe('categoryMissing');
  });

  /**
   * Un ingreso con categoría **no** se bloquea aquí, y es deliberado: quien la
   * quita es `buildPayload`, y el estado la suelta al cambiar de clase. Este
   * caso sólo ocurriría si alguien construyera el borrador a mano.
   */
  it('un ingreso con categoría colgada no bloquea, pero tampoco viaja', () => {
    const raro = draft({ kind: 'income', categoryId: 'cat-1' });
    expect(blockerFor(raro, 2, true)).toBeNull();
    expect(buildPayload(raro, SCOPE, 'k-1')).not.toHaveProperty('category_id');
  });
});

describe('el payload que cruza la frontera', () => {
  it('el gasto lleva su categoría y el importe como texto', () => {
    const payload = buildPayload(draft(), SCOPE, 'k-1');
    expect(payload).toEqual({
      client_operation_id: 'k-1',
      command_contract_version: 2,
      scope_id: 's-1',
      currency_definition_id: 'eur-1',
      amount: '1250',
      effective_date: '2026-09-01',
      effective_time: '13:00',
      concept: 'Mercadona',
      category_id: 'cat-1',
    });
  });

  /**
   * **Nunca un número.** ADR-008 §1 no admite un `number` donde hay dinero, y
   * un `1250` sin comillas sería exactamente eso.
   */
  it('el importe no sale como número bajo ningún concepto', () => {
    const payload = buildPayload(draft({ amount: '90071992547409.91' }), SCOPE, 'k-1');
    expect(typeof payload?.amount).toBe('string');
    expect(payload?.amount).toBe('9007199254740991');
  });

  it('el ingreso no lleva categoría ni como clave vacía', () => {
    const payload = buildPayload(draft({ kind: 'income', categoryId: null }), SCOPE, 'k-2');
    expect(payload).not.toBeNull();
    expect(Object.keys(payload ?? {})).not.toContain('category_id');
  });

  it('el concepto viaja recortado, que es como lo canonicaliza el servidor', () => {
    expect(buildPayload(draft({ concept: '  Cena  ' }), SCOPE, 'k-3')?.concept).toBe('Cena');
  });

  it('lo que no se puede guardar no produce payload', () => {
    expect(buildPayload(draft({ kind: 'transfer' }), SCOPE, 'k-4')).toBeNull();
    expect(buildPayload(draft({ amount: '' }), SCOPE, 'k-5')).toBeNull();
  });

  it('la escala del ámbito manda, no la del formulario', () => {
    const jpy = { ...SCOPE, currencyScale: 0 };
    expect(buildPayload(draft({ amount: '700' }), jpy, 'k-6')?.amount).toBe('700');
    expect(buildPayload(draft({ amount: '7.5' }), jpy, 'k-7')).toBeNull();
  });
});

describe('la fecha y la hora son de pared, no de UTC', () => {
  /**
   * Misma razón que `todayInDeviceCalendar`: el par fecha+hora es un reloj
   * local (ADR-020 §3). Tomarlos en UTC movería una cena de las 22:30 al día
   * siguiente para media Europa, y no fallaría nada — simplemente aparecería
   * en el día que no es.
   */
  it('la hora sale del reloj local con dos dígitos', () => {
    expect(currentClockTime(new Date(2026, 8, 1, 9, 5))).toBe('09:05');
    expect(currentClockTime(new Date(2026, 8, 1, 23, 59))).toBe('23:59');
  });

  it('la fecha del selector nativo se lee en componentes locales', () => {
    expect(calendarDateOf(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(calendarDateOf(new Date(2026, 11, 31, 23, 30))).toBe('2026-12-31');
  });

  it('y el viaje de ida y vuelta no mueve el día', () => {
    for (const day of ['2026-01-01', '2026-02-28', '2026-12-31'] as CalendarDate[]) {
      expect(calendarDateOf(dateFromCalendar(day))).toBe(day);
    }
  });
});

/**
 * CORREGIR ES EL MISMO PAYLOAD CON DOS CAMPOS MÁS.
 *
 * No hay un writer aparte para editar: `api.record_personal_expense` y
 * `api.record_personal_income` dan de alta o corrigen según el payload traiga
 * `operation_id` y `expected_version_id`. Es lo que hace imposible que el alta y
 * la corrección describan un movimiento de dos formas distintas.
 */
describe('el payload de una corrección', () => {
  const TARGET = { operationId: 'op-7', expectedVersionId: 'v-3' };

  it('añade la operación y la versión esperada, y nada más', () => {
    const alta = buildPayload(draft(), SCOPE, 'k-1');
    const correccion = buildPayload(draft(), SCOPE, 'k-1', TARGET);

    expect(correccion).toEqual({
      ...alta,
      operation_id: 'op-7',
      expected_version_id: 'v-3',
    });
  });

  /** Sin objetivo sigue siendo un alta: ni una clave de más. */
  it('sin objetivo no aparece ningún campo de corrección', () => {
    const alta = buildPayload(draft(), SCOPE, 'k-1');
    expect(alta).not.toHaveProperty('operation_id');
    expect(alta).not.toHaveProperty('expected_version_id');
  });

  /** Y el ingreso sigue sin categoría también al corregirse (ADR-027 §3). */
  it('un ingreso corregido tampoco lleva categoría', () => {
    const payload = buildPayload(
      draft({ kind: 'income', categoryId: 'cat-1' }),
      SCOPE,
      'k-1',
      TARGET,
    );
    expect(payload).not.toHaveProperty('category_id');
    expect(payload?.operation_id).toBe('op-7');
  });

  /** La validación no se relaja por estar corrigiendo. */
  it('un borrador inválido sigue sin producir payload', () => {
    expect(buildPayload(draft({ concept: '   ' }), SCOPE, 'k-1', TARGET)).toBeNull();
    expect(buildPayload(draft({ categoryId: null }), SCOPE, 'k-1', TARGET)).toBeNull();
  });
});

/**
 * PRECARGAR EL EDITOR desde la versión vigente. Sin esto el formulario abriría
 * vacío y guardar borraría lo que nadie tocó.
 */
describe('amountEntryFromMinor', () => {
  it('parte las unidades mínimas por la escala de la moneda', () => {
    expect(amountEntryFromMinor('4280', 2)).toEqual({
      whole: '42',
      fraction: '80',
      inFraction: true,
      seeded: true,
    });
  });

  it('rellena la parte entera cuando el importe no llega a la unidad', () => {
    expect(amountEntryFromMinor('7', 2)).toEqual({
      whole: '0',
      fraction: '07',
      inFraction: true,
      seeded: true,
    });
  });

  /** Una moneda sin decimales no inventa una parte decimal. */
  it('respeta una escala de cero', () => {
    expect(amountEntryFromMinor('1500', 0)).toEqual({
      whole: '1500',
      fraction: '',
      inFraction: false,
      seeded: true,
    });
  });

  /**
   * **PRECARGADA Y SIN TOCAR**, y es lo único que la distingue de la misma
   * cantidad escrita a mano. Sin la marca, un importe con los céntimos
   * completos queda saturado y ninguna cifra entra: era el fallo de la ventana
   * de corregir. No afecta al valor —`amountValue` no la mira—, así que la
   * referencia apagada de «Editar disponible» no cambia.
   */
  it('marca la cantidad como precargada, y eso no altera su valor', () => {
    const cargada = amountEntryFromMinor('4280', 2);
    expect(cargada.seeded).toBe(true);
    expect(amountValue(cargada)).toBe('42.80');
    expect(toMinorUnits(amountValue(cargada), 2)).toBe(4280n);
  });

  /**
   * **La magnitud, no el signo.** El editor pide lo que la persona escribió; el
   * menos de un gasto lo pone la clase al presentarlo.
   */
  it('descarta el signo', () => {
    expect(amountEntryFromMinor('-4280', 2).whole).toBe('42');
  });

  /**
   * Y todo sobre TEXTO: un importe por encima de 2^53 sobrevive intacto, que es
   * justo lo que un `parseInt` por medio habría perdido en silencio.
   */
  it('no degrada un importe enorme', () => {
    const enorme = '900719925474099100';
    const partido = amountEntryFromMinor(enorme, 2);
    expect(partido.whole + partido.fraction).toBe(enorme);
  });
});

/**
 * **SIN CAMBIOS NO SE ESCRIBE.** Abrir el editor, mirar y cerrar no puede dejar
 * una versión idéntica a la anterior: no corrige nada y ensucia la trazabilidad
 * justo donde sirve para algo.
 */
describe('sameEntry', () => {
  it('dos borradores idénticos son el mismo movimiento', () => {
    expect(sameEntry(draft(), draft(), 2)).toBe(true);
  });

  /**
   * **La comparación es canónica, no visual.** `5`, `5,0` y `5,00` son el mismo
   * importe: el payload que saldría es idéntico.
   */
  it('la forma de escribir el importe no cuenta como cambio', () => {
    expect(sameEntry(draft({ amount: '12,5' }), draft({ amount: '12,50' }), 2)).toBe(true);
    expect(sameEntry(draft({ amount: '5' }), draft({ amount: '5.00' }), 2)).toBe(true);
  });

  /** Ni un espacio de más en el concepto, que la frontera recorta igual. */
  it('los espacios alrededor del concepto tampoco', () => {
    expect(sameEntry(draft(), draft({ concept: '  Mercadona  ' }), 2)).toBe(true);
  });

  it('cualquier campo distinto sí es un cambio', () => {
    expect(sameEntry(draft(), draft({ amount: '12,51' }), 2)).toBe(false);
    expect(sameEntry(draft(), draft({ concept: 'Otra cosa' }), 2)).toBe(false);
    expect(sameEntry(draft(), draft({ categoryId: 'cat-2' }), 2)).toBe(false);
    expect(sameEntry(draft(), draft({ date: '2026-08-29' }), 2)).toBe(false);
    expect(sameEntry(draft(), draft({ time: '13:01' }), 2)).toBe(false);
  });

  /** Un importe ilegible nunca es «lo mismo»: no se puede afirmar. */
  it('un importe que no se puede convertir no cuenta como igual', () => {
    expect(sameEntry(draft({ amount: '' }), draft({ amount: '' }), 2)).toBe(false);
  });
});

/**
 * EL ESLABÓN QUE ENCIENDE «GUARDAR CAMBIOS».
 *
 * Es el trozo comprobable del recorrido físico: teclear sobre el importe
 * precargado cambia el `AmountEntry`, y eso hace que `sameEntry` deje de ser
 * cierto — que es lo único que separa el botón apagado del encendido.
 */
describe('corregir el importe rompe el no-op', () => {
  const scale = 2;
  const original = draft({ amount: '42,80' });

  it('el importe precargado empieza siendo un no-op', () => {
    const cargado = amountEntryFromMinor('4280', scale);
    expect(amountParts(cargado, scale)).toEqual({ whole: '42', fraction: '80' });
    expect(sameEntry({ ...original, amount: amountValue(cargado) }, original, scale)).toBe(true);
  });

  /**
   * **Borrar el último céntimo NO lo rompe, y es lo correcto.** `42,8` y `42,80`
   * son el mismo importe: la comparación es canónica, en unidades mínimas, y
   * el payload que saldría sería idéntico. Encender el botón ahí ofrecería
   * guardar una versión que no corrige nada.
   */
  it('borrar un cero de los céntimos sigue siendo el mismo importe', () => {
    let entry = amountEntryFromMinor('4280', scale);
    entry = applyAmountInput(entry, amountValue(entry).slice(0, -1), scale);
    expect(toMinorUnits(amountValue(entry), scale)).toBe(4280n);
    expect(sameEntry({ ...original, amount: amountValue(entry) }, original, scale)).toBe(true);
  });

  /** Borrar el céntimo que sí valía, en cambio, sí lo rompe. */
  it('borrar un céntimo con valor sí lo rompe', () => {
    let entry = amountEntryFromMinor('4285', scale);
    entry = applyAmountInput(entry, amountValue(entry).slice(0, -1), scale);
    expect(toMinorUnits(amountValue(entry), scale)).toBe(4280n);
    expect(
      sameEntry(
        { ...original, amount: amountValue(entry) },
        { ...original, amount: '42,85' },
        scale,
      ),
    ).toBe(false);
  });

  it('y escribir otro importe tampoco', () => {
    let entry = amountEntryFromMinor('4280', scale);
    // Se borra hasta vaciar y se teclea 50.
    for (let i = 0; i < 6; i += 1) {
      entry = applyAmountInput(entry, amountValue(entry).slice(0, -1), scale);
    }
    entry = applyAmountInput(entry, amountValue(entry) + '5', scale);
    entry = applyAmountInput(entry, amountValue(entry) + '0', scale);

    expect(amountParts(entry, scale)).toEqual({ whole: '50', fraction: '00' });
    expect(toMinorUnits(amountValue(entry), scale)).toBe(5000n);
    expect(sameEntry({ ...original, amount: amountValue(entry) }, original, scale)).toBe(false);
  });

  /** Y volver exactamente al importe de partida vuelve a apagarlo. */
  it('volver al importe original lo vuelve a apagar', () => {
    const vuelta = { ...original, amount: '42,8' };
    expect(sameEntry(vuelta, original, scale)).toBe(true);
  });
});
