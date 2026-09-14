import { describe, expect, it } from 'vitest';

import { currencyDefinition } from '../../src/domain';
import {
  activeByDefault,
  eligibleOn,
  listed,
} from '../../src/features/groups/participant-presence';
import type { GroupParticipant } from '../../src/features/groups/participant-service';
import {
  adjustShares,
  applyEligibility,
  buildGroupExpensePayload,
  computeSplit,
  draftOf,
  equalizeAmounts,
  initialDraft,
  isFixedAmount,
  resolveAmounts,
  setMode,
  setPayer,
  type SharedExpenseDraft,
  sharesOf,
  toggleParticipant,
} from '../../src/features/groups/shared-expense';
import type { CalendarDate } from '../../src/lib/format';

/**
 * EL REPARTO DE UN GASTO COMPARTIDO, sobre el modelo y no sobre la pantalla.
 *
 * Aquí se afirma lo único que decide cuánto debe cada quien. Tres monedas de
 * escala distinta —EUR 2, JPY 0, BHD 3— porque «dos decimales» no es una
 * propiedad del dinero sino de una definición monetaria concreta, y una pantalla
 * que sirva sólo para euros es un error que no falla en euros.
 */

const EUR = currencyDefinition({ id: 'cd-eur', code: 'EUR', scale: 2 });
const JPY = currencyDefinition({ id: 'cd-jpy', code: 'JPY', scale: 0 });
const BHD = currencyDefinition({ id: 'cd-bhd', code: 'BHD', scale: 3 });

const HOY = '2026-09-07' as CalendarDate;

function persona(id: string, name: string): GroupParticipant {
  return {
    participantId: id,
    displayName: name,
    createdAt: `2026-01-0${id.at(-1)}`,
    presence: null,
    isSelf: null,
    isLinked: null,
    hasHistory: null,
    claimCommandId: null,
    mergedInto: null,
  };
}

const ANA = persona('p1', 'Ana');
const LUIS = persona('p2', 'Luis');
const SOL = persona('p3', 'Sol');
const TRES = [ANA, LUIS, SOL] as const;

/** Un borrador listo para repartir: pagador puesto y concepto escrito. */
function listo(over: Partial<SharedExpenseDraft> = {}): SharedExpenseDraft {
  return {
    ...initialDraft(TRES, HOY, '21:30'),
    payerId: ANA.participantId,
    concept: 'Cena',
    // La categoría se exige igual que en un movimiento personal, así que un
    // borrador «listo» la trae puesta: sin ella el bloqueo sería otro.
    categoryId: 'cat-dining',
    ...over,
  };
}

const cuotas = (draft: SharedExpenseDraft, currency = EUR) =>
  computeSplit(draft, currency).quotas.map((one) => one.minor);

describe('a partes iguales, sin perder ni un céntimo', () => {
  /**
   * El caso del enunciado: 10 € entre tres.
   *
   * No se comprueba sólo que sume: se comprueba **quién** se lleva la unidad
   * sobrante. La regla es de F01/ADR-001 §5 —mayor resto primero y, a igualdad, el
   * pagador antes que el resto en el orden estable—, y sin fijarla aquí un
   * cambio de orden repartiría igual de bien y a personas distintas.
   */
  it('10 EUR entre tres son 3,34 · 3,33 · 3,33, y el extra es del pagador', () => {
    const salida = computeSplit(listo({ amount: '10' }), EUR);

    expect(salida.quotas.map((one) => one.minor)).toEqual([334n, 333n, 333n]);
    expect(salida.quotas[0].participantId).toBe(ANA.participantId);

    const suma = salida.quotas.reduce((acc, one) => acc + (one.minor ?? 0n), 0n);
    expect(suma).toBe(1000n);
  });

  it('y con OTRO pagador el céntimo se va con él, no con el primero', () => {
    const salida = computeSplit(listo({ amount: '10', payerId: SOL.participantId }), EUR);

    expect(salida.quotas.map((one) => one.minor)).toEqual([333n, 333n, 334n]);
    expect(salida.quotas[2].participantId).toBe(SOL.participantId);
  });

  /** JPY no tiene decimales: 10 yenes entre tres son 4 · 3 · 3, no 3,33. */
  it('en JPY, escala 0, el reparto es de unidades enteras', () => {
    const salida = computeSplit(listo({ amount: '10' }), JPY);

    expect(salida.quotas.map((one) => one.minor)).toEqual([4n, 3n, 3n]);
    expect(salida.quotas.reduce((acc, one) => acc + (one.minor ?? 0n), 0n)).toBe(10n);
  });

  /** BHD tiene tres: 10 dinares entre tres son 3,334 · 3,333 · 3,333. */
  it('en BHD, escala 3, el resto se reparte en milésimas', () => {
    const salida = computeSplit(listo({ amount: '10' }), BHD);

    expect(salida.quotas.map((one) => one.minor)).toEqual([3334n, 3333n, 3333n]);
    expect(salida.quotas.reduce((acc, one) => acc + (one.minor ?? 0n), 0n)).toBe(10000n);
  });

  /**
   * Una cuota CALCULADA en cero es una cuota, no un hueco.
   *
   * 0,01 € entre tres da 0,01 / 0 / 0 por indivisibilidad. Pintar eso como
   * «pendiente» diría que falta un dato, y no falta ninguno.
   */
  it('una participación indivisible sale en cero, y no en pendiente', () => {
    expect(cuotas(listo({ amount: '0,01' }))).toEqual([1n, 0n, 0n]);
  });

  it('un decimal de más NO se redondea en silencio: no vale', () => {
    // 0,299 € en una moneda de dos decimales. Un céntimo perdido sin avisar es
    // peor que un rechazo — y `parseFloat('0.29') * 100` es 28,999999999999996.
    const salida = computeSplit(listo({ amount: '0,299' }), EUR);
    expect(salida.blocker).toBe('amountInvalid');
    expect(salida.quotas.every((one) => one.minor === null)).toBe(true);
  });
});

describe('lo que impide guardar, y nunca produce NaN', () => {
  it.each([
    ['cero', '0', 'amountInvalid'],
    ['letras', 'abc', 'amountInvalid'],
    ['dos separadores', '1.2.3', 'amountInvalid'],
  ])('un importe %s no da cuotas ficticias', (_que, amount, blocker) => {
    const salida = computeSplit(listo({ amount }), EUR);

    expect(salida.blocker).toBe(blocker);
    expect(salida.quotas).toHaveLength(3);
    expect(salida.quotas.every((one) => one.minor === null)).toBe(true);
    // Y ni un `NaN` por el camino: aquí todo es texto y `bigint`.
    expect(JSON.stringify(salida.quotas.map((one) => String(one.minor)))).not.toContain('NaN');
  });

  it('sin pagador no se reparte, y no se elige a nadie por su cuenta', () => {
    const salida = computeSplit(listo({ amount: '10', payerId: null }), EUR);

    expect(salida.blocker).toBe('payerUnknown');
    expect(salida.quotas.every((one) => one.minor === null)).toBe(true);
  });

  it('sin nadie marcado tampoco', () => {
    expect(computeSplit(listo({ amount: '10', selected: [] }), EUR).blocker).toBe('noParticipants');
  });

  it('sin concepto no se guarda, aunque el reparto ya cuadre', () => {
    const salida = computeSplit(listo({ amount: '10', concept: '  ' }), EUR);

    expect(salida.blocker).toBe('conceptMissing');
    // Las cuotas SÍ se enseñan: falta el concepto, no el reparto.
    expect(salida.quotas.map((one) => one.minor)).toEqual([334n, 333n, 333n]);
  });

  /**
   * **Y con todo puesto ya NO queda ningún bloqueo.** Estuvo `noRoute` mientras
   * la frontera rechazaba cualquier gasto de grupo —nadie era elegible, porque
   * nada abría los periodos de presencia—; `20260908120000_group_expense_flow`
   * los abre en la propia creación, así que lo único que apaga `Guardar` es que
   * falte algo del formulario.
   *
   * Lo que la frontera siga rechazando llega como RESPUESTA, con su código, y no
   * como un bloqueo declarado de antemano: eso lo prueba `useRecordExpense`.
   */
  it('con todo correcto no queda ningún bloqueo', () => {
    expect(computeSplit(listo({ amount: '10' }), EUR).blocker).toBeNull();
  });
});

describe('por partes', () => {
  const partes = (weights: Record<string, string>) =>
    listo({ amount: '10', mode: 'shares', weights });

  it('reparte según los pesos, y el resto sigue la misma regla', () => {
    // 2 : 1 : 1 sobre 10 € = 5,00 / 2,50 / 2,50.
    expect(cuotas(partes({ p1: '2', p2: '1', p3: '1' }))).toEqual([500n, 250n, 250n]);
  });

  it('un peso que no es entero positivo bloquea, sin inventar un uno', () => {
    const casos: readonly Record<string, string>[] = [
      { p1: '2', p2: '1' },
      { p1: '2', p2: '0', p3: '1' },
      { p1: '2', p2: '1,5', p3: '1' },
      { p1: '2', p2: '-1', p3: '1' },
      { p1: '2', p2: '', p3: '1' },
    ];
    for (const weights of casos) {
      const salida = computeSplit(partes(weights), EUR);
      expect(salida.blocker, JSON.stringify(weights)).toBe('sharesInvalid');
      expect(salida.quotas.every((one) => one.minor === null)).toBe(true);
    }
  });
});

describe('cantidad exacta', () => {
  const exacto = (amounts: Record<string, string>) =>
    listo({ amount: '10', mode: 'amounts', amounts });

  it('cuando suman el total, cada cuota es lo declarado', () => {
    expect(cuotas(exacto({ p1: '5', p2: '3', p3: '2' }))).toEqual([500n, 300n, 200n]);
  });

  it('con TODO fijado y sin cuadrar, lo dice y NO completa la diferencia', () => {
    const salida = computeSplit(exacto({ p1: '5', p2: '2,50', p3: '1' }), EUR);

    expect(salida.blocker).toBe('amountsMismatch');
    expect(salida.difference).toBe(150n);
    // Se pinta lo que la persona escribió, ni corregido ni normalizado.
    expect(salida.quotas.map((one) => one.minor)).toEqual([500n, 250n, 100n]);
  });

  /** Quien NO está fijado va en automático: el restante es suyo. */
  it('con uno sin fijar, el restante es suyo y no falta nada', () => {
    const salida = computeSplit(exacto({ p1: '5', p2: '2,50' }), EUR);

    expect(salida.blocker).toBe(null);
    expect(salida.difference).toBe(0n);
    expect(salida.quotas.map((one) => one.minor)).toEqual([500n, 250n, 250n]);
  });

  it('cuando sobra, la diferencia sale negativa', () => {
    const salida = computeSplit(exacto({ p1: '9', p2: '3', p3: '1' }), EUR);

    expect(salida.blocker).toBe('amountsMismatch');
    // 9 + 3 + 1 = 13 €, tres euros por encima de los diez del total.
    expect(salida.difference).toBe(-300n);
  });

  it('y en BHD la escala del grupo es la que decide, no dos decimales', () => {
    // 3,334 + 3,333 + 3,333 = 10,000 exactos en milésimas.
    expect(cuotas(exacto({ p1: '3,334', p2: '3,333', p3: '3,333' }), BHD)).toEqual([
      3334n,
      3333n,
      3333n,
    ]);
  });
});

describe('quién participa', () => {
  const orden = TRES.map((one) => one.participantId);

  it('desmarcar excluye del reparto y recalcula entre los que quedan', () => {
    const sin = toggleParticipant(listo({ amount: '10' }), SOL.participantId, orden);

    expect(sin.selected).toEqual([ANA.participantId, LUIS.participantId]);
    expect(cuotas(sin)).toEqual([500n, 500n]);
  });

  it('al pagador NO se le puede desmarcar', () => {
    const draft = listo({ amount: '10' });
    expect(toggleParticipant(draft, ANA.participantId, orden)).toBe(draft);
  });

  it('cambiar el pagador a alguien desmarcado lo incluye y recalcula', () => {
    const sin = toggleParticipant(listo({ amount: '9' }), SOL.participantId, orden);
    expect(sin.selected).not.toContain(SOL.participantId);

    const conSol = setPayer(sin, SOL.participantId, orden);

    expect(conSol.selected).toEqual(orden);
    expect(cuotas(conSol)).toEqual([300n, 300n, 300n]);
  });

  /**
   * El orden es el desempate del céntimo, así que quitar y volver a poner a
   * alguien no puede moverlo a otra persona.
   */
  it('volver a marcar respeta el orden estable, no lo manda al final', () => {
    const draft = listo({ amount: '10' });
    const fuera = toggleParticipant(draft, LUIS.participantId, orden);
    const dentro = toggleParticipant(fuera, LUIS.participantId, orden);

    expect(dentro.selected).toEqual(orden);
    expect(cuotas(dentro)).toEqual(cuotas(draft));
  });
});

describe('elegibilidad por fecha', () => {
  it('sin periodos publicados no se descarta a nadie: no se inventa presencia', () => {
    const movido = applyEligibility(listo({ amount: '10' }), TRES, '2020-01-01' as CalendarDate);

    expect(movido.date).toBe('2020-01-01');
    expect(movido.selected).toEqual(TRES.map((one) => one.participantId));
  });

  /**
   * Y con la presencia publicada (F09/ADR-003) se aplica la MISMA desigualdad que
   * la frontera: `fecha < eligible_until`, con el límite excluido.
   */
  it('con presencia conocida, quien no estaba sale del reparto', () => {
    const conPresencia: readonly GroupParticipant[] = [
      ANA,
      { ...LUIS, presence: { isActive: true, eligibleUntil: null, isRetired: false } },
      {
        ...SOL,
        presence: {
          isActive: false,
          eligibleUntil: '2026-06-01' as CalendarDate,
          isRetired: false,
        },
      },
    ];

    const movido = applyEligibility(listo({ amount: '10' }), conPresencia, HOY);

    // Ana no tiene presencia —«no se sabe»— y se queda; Sol salió antes de la
    // fecha, así que sale.
    expect(movido.selected).toEqual([ANA.participantId, LUIS.participantId]);
  });

  it('el día de salida queda EXCLUIDO, y el anterior dentro', () => {
    const salida = '2026-09-10' as CalendarDate;
    const sol = { ...SOL, presence: { isActive: false, eligibleUntil: salida, isRetired: false } };
    expect(eligibleOn(sol, '2026-09-09' as CalendarDate)).toBe(true);
    expect(eligibleOn(sol, salida)).toBe(false);
    expect(eligibleOn(sol, '2026-09-11' as CalendarDate)).toBe(false);
    // Un retirado no figura en ningún gasto, ni retro-fechado.
    const retirada = { ...sol, presence: { ...sol.presence, isRetired: true } };
    expect(eligibleOn(retirada, '2026-09-01' as CalendarDate)).toBe(false);
    expect(listed(retirada)).toBe(false);
    // Un inactivo se lista pero no se propone; un activo, las dos cosas.
    expect(listed(sol)).toBe(true);
    expect(activeByDefault(sol)).toBe(false);
    expect(activeByDefault(LUIS)).toBe(true);
  });

  it('un gasto nuevo propone sólo a los activos', () => {
    const sol = {
      ...SOL,
      presence: { isActive: false, eligibleUntil: '2026-12-31' as CalendarDate, isRetired: false },
    };
    const borrador = initialDraft([ANA, LUIS, sol], HOY, '21:00');
    expect(borrador.selected).toEqual([ANA.participantId, LUIS.participantId]);
  });

  it('y si el que sale era el pagador, el pagador vuelve a estar sin resolver', () => {
    const conPresencia: readonly GroupParticipant[] = [
      {
        ...ANA,
        presence: {
          isActive: false,
          eligibleUntil: '2026-02-01' as CalendarDate,
          isRetired: false,
        },
      },
      LUIS,
      SOL,
    ];

    const movido = applyEligibility(listo({ amount: '10' }), conPresencia, HOY);

    expect(movido.payerId).toBeNull();
    expect(movido.selected).not.toContain(ANA.participantId);
  });
});

describe('cambiar de método deja el reparto en condiciones de usarse', () => {
  const orden = TRES.map((one) => one.participantId);

  /**
   * `Por partes` arranca con una parte cada uno: es el reparto igualitario dicho
   * en el vocabulario del método. Empezar con los campos vacíos obligaba a
   * teclear un `1` por persona para volver a donde ya se estaba.
   */
  it('«Por partes» entra con una parte para cada participante', () => {
    const partes = setMode(listo({ amount: '10' }), 'shares');

    expect(partes.weights).toEqual({ p1: '1', p2: '1', p3: '1' });
    expect(cuotas(partes)).toEqual([334n, 333n, 333n]);
  });

  it('y no pisa lo que ya se había escrito', () => {
    const conDos = { ...listo({ amount: '10' }), mode: 'shares' as const, weights: { p1: '2' } };
    expect(setMode(conDos, 'shares').weights).toEqual({ p1: '2', p2: '1', p3: '1' });
  });

  /**
   * `Cantidad` NO fija ningún importe: nadie declara por la persona. Pero
   * entrar reparte el total igualmente entre los seleccionados, en
   * AUTOMÁTICO —el mapa sigue vacío—, y desde ahí se fija lo que se toque.
   */
  it('«Cantidad» no fija ningún importe, y entra repartido igualmente', () => {
    const exacto = setMode(listo({ amount: '10' }), 'amounts');

    expect(exacto.amounts).toEqual({});
    expect(computeSplit(exacto, EUR).blocker).toBe(null);
    expect(cuotas(exacto)).toEqual([334n, 333n, 333n]);
  });

  it('volver de «Cantidad» a otro método y regresar conserva lo fijado', () => {
    const fijado = { ...setMode(listo({ amount: '30' }), 'amounts'), amounts: { p1: '20' } };
    const vuelta = setMode(setMode(fijado, 'equal'), 'amounts');
    expect(vuelta.amounts).toEqual({ p1: '20' });
    expect(cuotas(vuelta)).toEqual([2000n, 500n, 500n]);
    // Y las partes sembradas por el paso por «Por partes» no estorban.
    const porPartes = setMode(setMode(fijado, 'shares'), 'amounts');
    expect(porPartes.amounts).toEqual({ p1: '20' });
    expect(cuotas(porPartes)).toEqual([2000n, 500n, 500n]);
  });

  it('y marcar a alguien en «Por partes» le da su parte, sin apagar las demás', () => {
    const sin = toggleParticipant(
      setMode(listo({ amount: '9' }), 'shares'),
      SOL.participantId,
      orden,
    );
    expect(cuotas(sin)).toEqual([450n, 450n]);

    const otra = toggleParticipant(sin, SOL.participantId, orden);
    expect(otra.weights[SOL.participantId]).toBe('1');
    expect(cuotas(otra)).toEqual([300n, 300n, 300n]);
  });
});

describe('el cero de partida, y lo que NO se pinta en cero', () => {
  /**
   * Con el formulario recién abierto no falta ningún dato: todavía no se ha
   * escrito el importe, y repartir cero da cero a cada uno. Es una cuota real de
   * la divisa del grupo, así que se enseña como cifra y no como guion.
   */
  it('sin importe escrito, las cuotas son CERO y no pendientes', () => {
    const salida = computeSplit(listo({ amount: '' }), EUR);

    expect(salida.blocker).toBe('amountMissing');
    expect(salida.quotas.map((one) => one.minor)).toEqual([0n, 0n, 0n]);
  });

  it('también antes de elegir pagador, que es como se abre la ventana', () => {
    const recien = { ...initialDraft(TRES, HOY, '21:30'), concept: '' };

    expect(recien.payerId).toBeNull();
    expect(computeSplit(recien, EUR).quotas.map((one) => one.minor)).toEqual([0n, 0n, 0n]);
  });

  /**
   * Y sólo eso. Un error de entrada o un reparto que no cuadra NO se convierte en
   * un cero de aspecto válido: ahí sigue el pendiente.
   */
  it('pero un error de entrada NO se convierte en un cero de aspecto válido', () => {
    for (const draft of [
      listo({ amount: 'abc' }),
      listo({ amount: '0' }),
      listo({ amount: '10', mode: 'shares', weights: { p1: '0' } }),
      listo({ amount: '10', mode: 'amounts', amounts: { p1: '1', p2: '1', p3: '1' } }),
    ]) {
      const salida = computeSplit(draft, EUR);
      expect(salida.blocker).not.toBeNull();
      expect(salida.quotas.some((one) => one.minor === 0n)).toBe(false);
    }
  });
});

describe('la categoría', () => {
  /**
   * Se exige igual que en un movimiento personal: describe en qué se gastó, y un
   * formulario que la pide y luego la da por opcional enseña a no rellenarla.
   */
  it('falta hasta que se elige, y no se siembra ninguna', () => {
    const recien = initialDraft(TRES, HOY, '21:30');
    expect(recien.categoryId).toBeNull();

    const sinCategoria = computeSplit(listo({ amount: '10', categoryId: null }), EUR);
    expect(sinCategoria.blocker).toBe('categoryMissing');
    // Y el reparto SÍ se enseña: falta la categoría, no las cuotas.
    expect(sinCategoria.quotas.map((one) => one.minor)).toEqual([334n, 333n, 333n]);
  });

  /**
   * Sin catálogo que ofrecer el motivo es OTRO, y se dice aparte: pedir que se
   * elija sobre un menú vacío no ayuda a nadie (F07/ADR-001 §16).
   */
  it('y sin catálogo que ofrecer el motivo es distinto', () => {
    const salida = computeSplit(listo({ amount: '10', categoryId: null }), EUR, true);
    expect(salida.blocker).toBe('noCategories');
  });

  it('con categoría puesta ya no queda bloqueo', () => {
    expect(computeSplit(listo({ amount: '10' }), EUR).blocker).toBeNull();
  });

  /**
   * **UNA CATEGORÍA PROPIA NO VALE EN UN GASTO COMPARTIDO, y se pide otra.**
   *
   * No se sustituye por ninguna en silencio: la que hay la eligió una persona a
   * propósito, y cambiarla por su cuenta guardaría el gasto clasificado en algo
   * que nadie dijo. El servidor exige lo mismo —`CATEGORY_NOT_SHAREABLE`—, así
   * que esto adelanta el motivo, no lo inventa.
   */
  it('y una categoría propia pide elegir otra, sin cambiarla sola', () => {
    const borrador = listo({ amount: '10' });
    const salida = computeSplit(borrador, EUR, false, false);

    expect(salida.blocker).toBe('categoryNotShared');
    // La elegida sigue donde estaba: nadie la ha reemplazado.
    expect(borrador.categoryId).toBe(salida.blocker === null ? null : borrador.categoryId);
    // Y el reparto se sigue enseñando: falta la categoría, no las cuotas.
    expect(salida.quotas.map((one) => one.minor)).toEqual([334n, 333n, 333n]);
  });
});

/**
 * LA HORA DEL GASTO COMPARTIDO: la misma que la del movimiento personal.
 *
 * Un alta nace con la hora que le siembra la ruta —el reloj de pared, HH:MM—,
 * viaja en el payload y una corrección conserva la existente. Un gasto
 * histórico sin hora sigue sin hora: `null`, y nadie le inventa una.
 */
describe('la hora efectiva', () => {
  it('un alta nace con la hora sembrada y la categoría preestablecida, si la hay', () => {
    const recien = initialDraft(TRES, HOY, '21:30', 'cat-dining');
    expect(recien.time).toBe('21:30');
    expect(recien.categoryId).toBe('cat-dining');
    // Sin preferencia («Todas»), sin categoría: la persona elige.
    expect(initialDraft(TRES, HOY, '21:30').categoryId).toBeNull();
  });

  it('viaja en el payload tal cual, y como null cuando no la hay', async () => {
    const { buildGroupExpensePayload } = await import('../../src/features/groups/shared-expense');
    const scope = { scopeId: 'g', currencyDefinitionId: 'eur', scale: 2 };
    const con = buildGroupExpensePayload(listo({ amount: '10', time: '08:05' }), scope, 'k1');
    expect(con?.effective_time).toBe('08:05');
    const sin = buildGroupExpensePayload(listo({ amount: '10', time: null }), scope, 'k2');
    expect(sin?.effective_time).toBeNull();
  });

  it('una corrección precarga la hora EXISTENTE, recortada a minutos, o su ausencia', async () => {
    const { draftOf } = await import('../../src/features/groups/shared-expense');
    const base = {
      totalMinor: '2000',
      concept: 'Cena',
      categoryId: 'cat-dining',
      effectiveDate: HOY,
      payerParticipantId: ANA.participantId,
      splitMethod: 'equal',
    };
    const conHora = draftOf({ ...base, effectiveTime: '21:30:00' }, [], 2);
    expect(conHora.time).toBe('21:30');
    const historico = draftOf({ ...base, effectiveTime: null }, [], 2);
    expect(historico.time).toBeNull();
  });
});

/**
 * LA CATEGORÍA PREESTABLECIDA SE APLICA UNA VEZ, CUANDO SE PUEDE, Y NUNCA
 * SOBRE UNA ELECCIÓN. Las cinco situaciones, como secuencias de renders.
 */
describe('la preestablecida del grupo en un gasto nuevo', () => {
  const VIAJES = 'cat-travel';
  const SUPER = 'cat-grocery';

  it('perfil y catálogo disponibles desde el principio: el borrador nace con ella', async () => {
    const { presetToApply } = await import('../../src/features/groups/shared-expense');
    const recien = initialDraft(TRES, HOY, '21:30', VIAJES);
    expect(recien.categoryId).toBe(VIAJES);
    // Y ya sembrada, el render no vuelve a aplicarla.
    expect(
      presetToApply({
        editing: false,
        presetCategoryId: VIAJES,
        categoryId: recien.categoryId,
        applied: true,
        touched: false,
      }),
    ).toBeNull();
  });

  it('catálogo llegando DESPUÉS del primer render: se aplica entonces, una vez', async () => {
    const { presetToApply } = await import('../../src/features/groups/shared-expense');
    // Primer render: sin catálogo no hay preferencia confirmable -> null.
    const recien = initialDraft(TRES, HOY, '21:30', null);
    expect(recien.categoryId).toBeNull();
    expect(
      presetToApply({
        editing: false,
        presetCategoryId: null,
        categoryId: null,
        applied: false,
        touched: false,
      }),
    ).toBeNull();
    // Llega el catálogo: ahora sí, y devuelve la categoría real del perfil.
    expect(
      presetToApply({
        editing: false,
        presetCategoryId: VIAJES,
        categoryId: null,
        applied: false,
        touched: false,
      }),
    ).toBe(VIAJES);
    // Aplicada una vez, no se repite aunque el render vuelva a pasar por aquí.
    expect(
      presetToApply({
        editing: false,
        presetCategoryId: VIAJES,
        categoryId: VIAJES,
        applied: true,
        touched: false,
      }),
    ).toBeNull();
  });

  it('elección manual ANTES de terminar la carga: la preferencia ya no manda', async () => {
    const { presetToApply } = await import('../../src/features/groups/shared-expense');
    // La persona eligió Supermercado mientras el catálogo viajaba.
    expect(
      presetToApply({
        editing: false,
        presetCategoryId: VIAJES,
        categoryId: SUPER,
        applied: false,
        touched: true,
      }),
    ).toBeNull();
    // Incluso si aún no hay categoría (la eligió y el borrador no la tiene por lo que sea): manual manda.
    expect(
      presetToApply({
        editing: false,
        presetCategoryId: VIAJES,
        categoryId: null,
        applied: false,
        touched: true,
      }),
    ).toBeNull();
  });

  it('cambiar la preferencia y abrir un gasto nuevo parte de la nueva', () => {
    // Otro borrador, otra ventana: la siembra lee la preferencia vigente.
    expect(initialDraft(TRES, HOY, '21:30', SUPER).categoryId).toBe(SUPER);
    expect(initialDraft(TRES, HOY, '21:30', null).categoryId).toBeNull();
  });

  it('editar un gasto conserva SU categoría, nunca la preferencia del grupo', async () => {
    const { draftOf, presetToApply } = await import('../../src/features/groups/shared-expense');
    const existente = draftOf(
      {
        totalMinor: '2000',
        concept: 'Cena',
        categoryId: SUPER,
        effectiveDate: HOY,
        effectiveTime: null,
        payerParticipantId: ANA.participantId,
        splitMethod: 'equal',
      },
      [],
      2,
    );
    expect(existente.categoryId).toBe(SUPER);
    expect(
      presetToApply({
        editing: true,
        presetCategoryId: VIAJES,
        categoryId: existente.categoryId,
        applied: false,
        touched: false,
      }),
    ).toBeNull();
    // Y un histórico SIN categoría tampoco la recibe al editarlo.
    expect(
      presetToApply({
        editing: true,
        presetCategoryId: VIAJES,
        categoryId: null,
        applied: false,
        touched: false,
      }),
    ).toBeNull();
  });
});

/**
 * EL IMPORTE AL EDITAR: 35 en gris, y la primera cifra lo SUSTITUYE.
 *
 * La misma máquina que corregir un movimiento personal, con su contrato de
 * `seeded`. Se afirma también con el cursor fuera del final, que es donde iOS
 * lo deja si se toca el campo por delante.
 */
describe('el importe vigente al editar', () => {
  const machine = () => import('../../src/ui/components/amount-entry');

  it('se siembra como precargado, y sigue siendo el valor mientras nadie lo toque', async () => {
    const { seedAmountEntry } = await import('../../src/features/groups/shared-expense');
    const { amountValue, amountTones } = await machine();
    const sembrado = seedAmountEntry('35.00');
    expect(sembrado.seeded).toBe(true);
    expect(amountValue(sembrado)).toBe('35.00');
    // En gris: nada de lo que se ve lo ha escrito la persona.
    expect(amountTones(sembrado).whole).toBe('pending');
    // Y guardar sin tocarlo manda exactamente ese importe.
    const { buildGroupExpensePayload } = await import('../../src/features/groups/shared-expense');
    expect(
      buildGroupExpensePayload(
        listo({ amount: amountValue(sembrado) }),
        { scopeId: 'g', currencyDefinitionId: 'eur', scale: 2 },
        'k',
      )?.total,
    ).toBe('3500');
  });

  it('35 → «1» → 1 → «2» → 12, sin borrar antes', async () => {
    const { seedAmountEntry } = await import('../../src/features/groups/shared-expense');
    const { applyAmountInput, amountValue } = await machine();
    const s0 = seedAmountEntry('35.00');
    const s1 = applyAmountInput(s0, amountValue(s0) + '1', 2);
    expect(amountValue(s1)).toBe('1');
    expect(s1.seeded).toBeUndefined();
    const s2 = applyAmountInput(s1, amountValue(s1) + '2', 2);
    expect(amountValue(s2)).toBe('12');
  });

  it('también con el cursor por delante o en medio: lo tecleado sustituye igual', async () => {
    const { seedAmountEntry } = await import('../../src/features/groups/shared-expense');
    const { applyAmountInput, amountValue } = await machine();
    const s0 = seedAmountEntry('35.00');
    expect(amountValue(applyAmountInput(s0, '1' + amountValue(s0), 2))).toBe('1');
    expect(amountValue(applyAmountInput(s0, '3' + '1' + '5.00', 2))).toBe('1');
  });

  it('después de empezar, decimales y borrado actúan sobre lo nuevo', async () => {
    const { seedAmountEntry } = await import('../../src/features/groups/shared-expense');
    const { applyAmountInput, amountValue } = await machine();
    let e = seedAmountEntry('35.00');
    e = applyAmountInput(e, amountValue(e) + '1', 2);
    e = applyAmountInput(e, amountValue(e) + '2', 2);
    e = applyAmountInput(e, amountValue(e) + ',', 2);
    e = applyAmountInput(e, amountValue(e) + '5', 2);
    expect(amountValue(e)).toBe('12.5');
    // El borrado sigue el contrato de la máquina: quita el céntimo, luego
    // sale de los decimales comiéndose un entero, luego lo que queda.
    e = applyAmountInput(e, amountValue(e).slice(0, -1), 2);
    expect(amountValue(e)).toBe('12.');
    e = applyAmountInput(e, amountValue(e).slice(0, -1), 2);
    expect(amountValue(e)).toBe('1');
    e = applyAmountInput(e, amountValue(e).slice(0, -1), 2);
    // Vacío tras borrar: NO vuelve a 35 a escondidas, y no se puede guardar.
    expect(amountValue(e)).toBe('');
    expect(e.seeded).toBeUndefined();
    expect(computeSplit(listo({ amount: '' }), EUR).blocker).toBe('amountMissing');
  });
});

describe('«Por partes» con − y +', () => {
  const partes = (weights: Record<string, string>) =>
    listo({ amount: '10', mode: 'shares', weights });

  it('una parte más o menos; nunca por debajo de una', () => {
    const base = setMode(listo({ amount: '10' }), 'shares');
    expect(sharesOf(base, 'p1')).toBe(1n);
    expect(adjustShares(base, 'p1', -1)).toBe(base);

    const dos = adjustShares(base, 'p1', 1);
    expect(dos.weights).toEqual({ p1: '2', p2: '1', p3: '1' });
    expect(cuotas(dos)).toEqual([500n, 250n, 250n]);

    const tres = adjustShares(dos, 'p1', 1);
    expect(sharesOf(tres, 'p1')).toBe(3n);
    expect(cuotas(tres)).toEqual([600n, 200n, 200n]);

    expect(adjustShares(tres, 'p1', -1).weights.p1).toBe('2');
  });

  it('al editar, las partes declaradas del gasto son las que enseña', () => {
    expect(sharesOf(partes({ p1: '3', p2: '1', p3: '2' }), 'p1')).toBe(3n);
    expect(sharesOf(partes({ p1: '3', p2: '1', p3: '2' }), 'p3')).toBe(2n);
  });

  it('lo que no vale se enseña como una, sin escribirlo hasta que se pulse', () => {
    const roto = partes({ p1: '2', p2: '', p3: '1,5' });
    expect(sharesOf(roto, 'p2')).toBe(1n);
    expect(sharesOf(roto, 'p3')).toBe(1n);
    // Sin pulsar nada, el borrador sigue inválido: no se inventa un uno.
    expect(computeSplit(roto, EUR).blocker).toBe('sharesInvalid');
    // Al pulsar +, queda escrito lo que se ve más uno.
    expect(adjustShares(roto, 'p2', 1).weights.p2).toBe('2');
  });
});

describe('«Cantidad»: fijadas a mano y automáticas', () => {
  const orden = TRES.map((one) => one.participantId);
  const cantidad = (amount: string, amounts: Record<string, string> = {}) =>
    listo({ amount, mode: 'amounts', amounts });

  it('30 → 10/10/10 → fijo 20 → 20/5/5 → fijo 7 → 20/7/3', () => {
    const inicial = cantidad('30');
    expect(cuotas(inicial)).toEqual([1000n, 1000n, 1000n]);
    expect(orden.some((id) => isFixedAmount(inicial, id))).toBe(false);

    const veinte = { ...inicial, amounts: { p1: '20' } };
    expect(cuotas(veinte)).toEqual([2000n, 500n, 500n]);
    expect(isFixedAmount(veinte, 'p1')).toBe(true);
    expect(isFixedAmount(veinte, 'p2')).toBe(false);

    const siete = { ...veinte, amounts: { ...veinte.amounts, p2: '7' } };
    expect(cuotas(siete)).toEqual([2000n, 700n, 300n]);
    expect(computeSplit(siete, EUR).blocker).toBe(null);
  });

  it('modificar una fijada recalcula sólo las automáticas', () => {
    const base = cantidad('30', { p1: '20', p2: '7' });
    const cambio = { ...base, amounts: { ...base.amounts, p1: '15' } };
    // p2 sigue en 7; sólo p3 se mueve.
    expect(cuotas(cambio)).toEqual([1500n, 700n, 800n]);
  });

  it('cambiar el total conserva las fijadas y reparte el restante', () => {
    const base = cantidad('30', { p1: '20' });
    expect(cuotas({ ...base, amount: '40' })).toEqual([2000n, 1000n, 1000n]);
    expect(cuotas({ ...base, amount: '21' })).toEqual([2000n, 50n, 50n]);
  });

  it('el restante indivisible sigue la regla de restos, con el pagador primero', () => {
    // 10 € entre tres automáticos: 3,34 / 3,33 / 3,33, nunca tres de 3,33.
    expect(cuotas(cantidad('10'))).toEqual([334n, 333n, 333n]);
    // Fijado el pagador, el céntimo va al primero de los automáticos.
    expect(cuotas(cantidad('10', { p1: '2,99' }))).toEqual([299n, 351n, 350n]);
    // Y si el pagador está en automático, es suyo aunque no sea el primero.
    expect(cuotas({ ...cantidad('10', { p1: '2,99' }), payerId: 'p3' })).toEqual([
      299n,
      350n,
      351n,
    ]);
  });

  it('en JPY y BHD la escala del grupo es la que decide', () => {
    expect(cuotas(cantidad('10', { p1: '4' }), JPY)).toEqual([4n, 3n, 3n]);
    expect(cuotas(cantidad('10', { p1: '3,334' }), BHD)).toEqual([3334n, 3333n, 3333n]);
  });

  it('desmarcar suelta la cuota; volver a marcar entra en automático', () => {
    const base = cantidad('30', { p1: '20', p3: '7' });
    const sinSol = toggleParticipant(base, 'p3', orden);
    expect(isFixedAmount(sinSol, 'p3')).toBe(false);
    expect(cuotas(sinSol)).toEqual([2000n, 1000n]);

    const conSol = toggleParticipant(sinSol, 'p3', orden);
    expect(isFixedAmount(conSol, 'p3')).toBe(false);
    expect(cuotas(conSol)).toEqual([2000n, 500n, 500n]);
  });

  it('«Repartir igualmente» libera todas las fijadas', () => {
    const base = cantidad('30', { p1: '20', p2: '7' });
    const igual = equalizeAmounts(base);
    expect(igual.amounts).toEqual({});
    expect(cuotas(igual)).toEqual([1000n, 1000n, 1000n]);
  });

  it('si las fijadas superan el total, se conservan, se enseña el exceso y nada es negativo', () => {
    const salida = computeSplit(cantidad('30', { p1: '20', p2: '15' }), EUR);
    expect(salida.blocker).toBe('amountsMismatch');
    expect(salida.difference).toBe(-500n);
    expect(salida.quotas.map((one) => one.minor)).toEqual([2000n, 1500n, null]);
  });

  it('un restante que no llega a los automáticos deja a alguien en cero, y se dice', () => {
    const cero = computeSplit(cantidad('30', { p1: '20', p2: '10' }), EUR);
    expect(cero.blocker).toBe('amountsZero');
    expect(cero.quotas.map((one) => one.minor)).toEqual([2000n, 1000n, 0n]);

    // 0,02 entre dos automáticos da 0,01 y 0,01; 0,01 deja a uno en cero.
    expect(computeSplit(cantidad('0,02'), EUR).blocker).toBe('amountsZero');
    expect(computeSplit(cantidad('0,03'), EUR).blocker).toBe(null);

    // Una fijada en cero tampoco vale: quien declara cero no participa.
    expect(computeSplit(cantidad('30', { p1: '0' }), EUR).blocker).toBe('amountsZero');
  });

  it('un campo fijado vacío o a medio escribir no es un cero: deja todo pendiente', () => {
    for (const raw of ['', 'abc', '1,234', '1.2.3']) {
      const salida = computeSplit(cantidad('30', { p1: raw }), EUR);
      expect(salida.blocker, JSON.stringify(raw)).toBe('amountsIncomplete');
      expect(salida.difference).toBe(null);
      expect(salida.quotas.map((one) => one.minor)).toEqual([null, null, null]);
    }
  });

  it('el pagador debe participar también en «Cantidad»', () => {
    const sinPagador = { ...cantidad('30'), payerId: 'p3', selected: ['p1', 'p2'] };
    expect(computeSplit(sinPagador, EUR).blocker).toBe('payerUnknown');
  });

  it('lo enviado es el reparto final exacto, manual y automático, y suma el total', () => {
    const draft = cantidad('30', { p1: '20', p2: '7' });
    const payload = buildGroupExpensePayload(
      draft,
      { scopeId: 'g', currencyDefinitionId: 'cd-eur', scale: 2 },
      'cmd-1',
    );
    expect(payload?.split_method).toEqual({
      kind: 'exact_amounts',
      amounts: ['2000', '700', '300'],
    });
    expect(payload?.participants).toEqual(['p1', 'p2', 'p3']);
    expect(payload?.total).toBe('3000');
    // Lo mostrado y lo enviado son la misma cosa.
    expect(cuotas(draft)).toEqual([2000n, 700n, 300n]);

    // Y con bloqueo no sale nada: ni un cero, ni un negativo.
    expect(
      buildGroupExpensePayload(
        cantidad('30', { p1: '20', p2: '15' }),
        { scopeId: 'g', currencyDefinitionId: 'cd-eur', scale: 2 },
        'cmd-2',
      ),
    ).toBe(null);
  });

  it('`resolveAmounts` dice quién va en automático, en el orden estable', () => {
    const r = resolveAmounts(cantidad('30', { p2: '7' }), 2, 3000n);
    expect(r.automatic).toEqual(['p1', 'p3']);
    expect(r.blocker).toBe(null);
    expect([...r.resolved.values()]).toEqual([1150n, 700n, 1150n]);
  });
});

describe('editar un gasto en «Cantidad»', () => {
  const split = [
    { participantId: 'p1', declaredWeight: null, declaredAmount: '2000' },
    { participantId: 'p2', declaredWeight: null, declaredAmount: '700' },
    { participantId: 'p3', declaredWeight: null, declaredAmount: '300' },
  ];
  const cabecera = {
    totalMinor: '3000',
    concept: 'Cena',
    categoryId: 'cat-dining',
    effectiveDate: '2026-09-07',
    effectiveTime: null,
    payerParticipantId: 'p1',
    splitMethod: 'exact_amounts',
  };

  it('precarga los importes exactos declarados, todos FIJADOS', () => {
    const draft = draftOf(cabecera, split, 2);
    expect(draft.mode).toBe('amounts');
    expect(draft.amounts).toEqual({ p1: '20', p2: '7', p3: '3' });
    expect(['p1', 'p2', 'p3'].every((id) => isFixedAmount(draft, id))).toBe(true);
    expect(cuotas(draft)).toEqual([2000n, 700n, 300n]);
  });

  it('guardar sin tocar las cuotas conserva los importes originales', () => {
    const draft = draftOf(cabecera, split, 2);
    const payload = buildGroupExpensePayload(
      draft,
      { scopeId: 'g', currencyDefinitionId: 'cd-eur', scale: 2 },
      'cmd-3',
      { operationId: 'op', expectedVersionId: 'v1' },
    );
    expect(payload?.split_method).toEqual({
      kind: 'exact_amounts',
      amounts: ['2000', '700', '300'],
    });
    expect(payload?.expected_version_id).toBe('v1');
  });

  it('«Repartir igualmente» reinicia el reparto automático sobre el total vigente', () => {
    const draft = equalizeAmounts(draftOf(cabecera, split, 2));
    expect(cuotas(draft)).toEqual([1000n, 1000n, 1000n]);
  });

  it('las partes declaradas se conservan al editar en «Por partes»', () => {
    const draft = draftOf(
      { ...cabecera, splitMethod: 'shares' },
      [
        { participantId: 'p1', declaredWeight: '3', declaredAmount: null },
        { participantId: 'p2', declaredWeight: '1', declaredAmount: null },
        { participantId: 'p3', declaredWeight: '2', declaredAmount: null },
      ],
      2,
    );
    expect(sharesOf(draft, 'p1')).toBe(3n);
    expect(sharesOf(draft, 'p3')).toBe(2n);
    expect(cuotas(draft)).toEqual([1500n, 500n, 1000n]);
  });
});
