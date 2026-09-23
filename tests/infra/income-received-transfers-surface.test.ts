import { describe, expect, it } from 'vitest';

import HOME from '../../src/app/(tabs)/index.tsx?raw';
import PROJECTION from '../../src/features/personal/projection.ts?raw';
import STATISTICS from '../../src/features/personal/statistics.ts?raw';
import CI from '../../.github/workflows/ci.yml?raw';
import CHECK from '../../supabase/checks/income-received-transfers.sql?raw';
import MIGRATION from '../../supabase/migrations/20261002120000_income_includes_received_transfers.sql?raw';
import FX_READS from '../../supabase/migrations/20261001120000_fx_personal_reads.sql?raw';
import TRANSFERS_MIGRATION from '../../supabase/migrations/20260926120000_transfer_proposals.sql?raw';

/**
 * UNA TRANSFERENCIA PERSONAL RECIBIDA CUENTA EN «INGRESOS» (F12.E, 2026-09-22).
 *
 * La decisión, en una frase: **una transferencia Personal → Personal aceptada
 * contribuye al agregado de Ingresos de quien la recibe, sin convertirse en
 * una segunda operación de ingreso**.
 *
 * Lo que este fichero vigila es dónde vive esa regla —en la capa
 * autoritativa, no en una suma del cliente— y las cuatro cosas que la harían
 * mentir sin fallar: contar dos veces, contar una liquidación de grupo,
 * contar lo enviado, o inventar una fecha. Lo que sólo la base puede
 * demostrar lo mide `supabase/checks/income-received-transfers.sql`.
 */

const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** El SQL sin sus comentarios: lo que se ejecuta, no lo que se explica. */
const sql = (source: string) => source.replace(/--.*$/gm, '');

describe('la regla vive en la capa autoritativa', () => {
  /**
   * El total de la tarjeta sale de `api.personal_statistics`, no de sumar
   * filas en Inicio. Un parche visual habría dejado la cifra dependiendo de
   * qué página se hubiera cargado.
   */
  it('el total sigue saliendo del agregado del servidor, no de la pantalla', () => {
    expect(HOME).toContain('projected.statistics.income_total');
    expect(strip(HOME)).not.toMatch(/income_total\s*[+=]|sum\(.*transfer/i);
    expect(STATISTICS).toContain('readonly income_total: string;');
  });

  it('el sumando nuevo está en la SQL, y sólo en `income_total`', () => {
    expect(MIGRATION).toContain(
      '+ coalesce((select sum(rt.amount)\n                    from sec.my_received_transfers(p_from, p_to) rt), 0)',
    );
    // `expense_total` y las categorías quedan literalmente como estaban:
    // enviar NO es gasto, y esa decisión no se ha tomado.
    const expense = MIGRATION.slice(
      MIGRATION.indexOf("'expense_total'"),
      MIGRATION.indexOf("'categories'"),
    );
    expect(expense).not.toContain('my_received_transfers');
    const categories = MIGRATION.slice(MIGRATION.indexOf("'categories'"));
    expect(categories).not.toContain('my_received_transfers');
  });

  /**
   * LA BASE ES F11.C, Y ESTO ES LO QUE LO GUARDA.
   *
   * Las dos migraciones hacen `create or replace` de la MISMA función, así
   * que la segunda en aplicarse pisa entera a la primera. Si alguien
   * reconstruyera ésta sobre el cuerpo anterior, el §3 de F11.C —el desglose
   * por categoría en la magnitud ASENTADA— desaparecería sin que nada
   * fallara. Aquí se comprueba línea a línea que sigue.
   */
  it('conserva la semántica de F11.C línea a línea, y sólo añade el sumando', () => {
    for (const piece of [
      "and pe.accounting_class = 'income'",
      "and pe.accounting_class = 'expense'",
      'from sec.my_shared_expense_shares(p_from, p_to) sh), 0)',
      "and po.operation_class = 'personal_expense'",
      // El §3 de F11.C: la magnitud asentada, no la declarada.
      'select po.category_id, - po.balance_amount::bigint as amount',
    ]) {
      expect(FX_READS, piece).toContain(piece);
      expect(MIGRATION, piece).toContain(piece);
    }
    // Y lo que F11.C corrigió NO puede volver: la magnitud declarada.
    expect(MIGRATION).not.toContain('po.original_amount::bigint as amount');
  });

  /**
   * El cuerpo de la función, carácter a carácter: el de F11.C con CINCO
   * líneas añadidas y ninguna quitada.
   */
  it('el cuerpo combinado es el de F11.C más el sumando, y nada más', () => {
    const cuerpo = (source: string) => {
      const start = source.indexOf(
        'create or replace function api.personal_statistics(p_from date default null, p_to date default null)',
      );
      const mark = '\n  ) from api.personal_scope ps;\nend;\n';
      return source.slice(start, source.indexOf(mark, start) + mark.length);
    };
    const suma =
      '      + coalesce((select sum(rt.amount)\n' +
      '                    from sec.my_received_transfers(p_from, p_to) rt), 0)\n';
    const nuestro = cuerpo(MIGRATION);
    expect(nuestro).toContain(suma);
    /*
     * Quitados el sumando y sus tres líneas de comentario, lo que queda es
     * EXACTAMENTE el cuerpo de F11.C. Es la comprobación fuerte: no se
     * perdió ni se cambió una sola línea suya.
     */
    const sinSuma = nuestro
      .split('\n')
      .filter((line) => !line.startsWith('      -- F12.E:'))
      .filter((line) => !line.startsWith('      -- un internal_transfer'))
      .filter((line) => !line.startsWith('      -- sumando de arriba'))
      .join('\n')
      .replace(suma, '');
    expect(sinSuma).toBe(cuerpo(FX_READS));
  });
});

describe('sin doble conteo', () => {
  /**
   * Un `internal_transfer` escribe DOS efectos de saldo y ninguno económico,
   * así que el primer sumando de `income_total` —la dimensión económica de
   * ingreso— no puede haberlo contado ya. Es lo que hace que sumar el
   * segundo no duplique nada.
   */
  it('la transferencia no produce dimensión económica: el otro sumando no la vio', () => {
    expect(TRANSFERS_MIGRATION).toContain(
      "(gen_random_uuid(), v_version, v_from, 'transfer', v_p.currency_definition_id, - v_p.amount),",
    );
    expect(TRANSFERS_MIGRATION).toContain(
      "(gen_random_uuid(), v_version, v_to,   'transfer', v_p.currency_definition_id,   v_p.amount);",
    );
    // La columna económica ni se nombra en ese insert.
    const insert = TRANSFERS_MIGRATION.slice(
      TRANSFERS_MIGRATION.indexOf('insert into core.effect'),
      TRANSFERS_MIGRATION.indexOf('insert into core.transfer_part'),
    );
    expect(insert).not.toContain('economic_amount');
  });

  it('no se crea ninguna operación de ingreso paralela', () => {
    expect(strip(MIGRATION)).not.toMatch(/insert into core\.(operation|effect|operation_version)/);
    expect(MIGRATION).toContain('stable');
  });

  it('`personal_operation` sigue sin listar la clase, así que la lista no gana una fila falsa', () => {
    // `api.personal_operation` sólo se nombra donde ya se nombraba —el
    // desglose por categorías de gasto—, nunca en `income_total`.
    const income = sql(MIGRATION).slice(
      sql(MIGRATION).indexOf("'income_total'"),
      sql(MIGRATION).indexOf("'expense_total'"),
    );
    expect(income).not.toContain('api.personal_operation');
    expect(CHECK).toContain('A5 personal_operation gano una fila con la transferencia');
    expect(CHECK).toContain('A6 la transferencia recibida no sale UNA vez en my_transfers');
  });

  it('la proyección local PARTE del total del servidor y sólo le suma lo encolado', () => {
    expect(PROJECTION).toContain('moneyFromMinorString(server.income_total, currency),');
    expect(PROJECTION).toContain("deriveEconomicTotal(effects, sid, 'income', currency),");
    // Una transferencia nunca pasa por la cola, así que `locals` no la trae.
    expect(strip(PROJECTION)).not.toMatch(/transfer/i);
  });
});

describe('qué cuenta y qué no', () => {
  it('sólo `internal_transfer`: una liquidación de grupo no es un ingreso', () => {
    expect(MIGRATION).toContain("and o.operation_class = 'internal_transfer'");
    expect(sql(MIGRATION)).not.toContain("accounting_class = 'transfer'");
    expect(CHECK).toContain('E1 un settlement_by_transfer recibido conto como Ingreso');
  });

  it('sólo el lado RECIBIDO: lo enviado no entra ni resta', () => {
    expect(MIGRATION).toContain('and e.balance_amount > 0');
    expect(CHECK).toContain('C1 lo ENVIADO entro en los Ingresos del emisor');
    expect(CHECK).toContain('C2 lo enviado se convirtio en gasto del emisor');
  });

  it('sólo lo ACEPTADO: una propuesta no es nada', () => {
    // Una propuesta no produce efecto, así que no hay nada que filtrar; el
    // check lo mide en los cuatro estados.
    expect(CHECK).toContain('A2 una propuesta PENDIENTE ya sumo en Ingresos');
    expect(CHECK).toContain('B1 una propuesta RECHAZADA sumo en Ingresos');
    expect(CHECK).toContain('B2 una propuesta CANCELADA sumo en Ingresos');
    expect(CHECK).toContain('B3 una propuesta CADUCADA sumo en Ingresos');
  });

  it('y el corte del Personal de F10 se respeta', () => {
    expect(MIGRATION).toContain('and sec.counts_in_personal(e.scope_id, o.id)');
  });
});

describe('la fecha y la moneda', () => {
  /**
   * `effective_date` es la MISMA con la que el agregado acota su intervalo y
   * la misma que `api.my_transfers` publica; `record_internal_transfer` la
   * escribe como `current_date` en la transacción de la aceptación. No se
   * inventa ninguna fecha nueva.
   */
  it('el intervalo se acota con la fecha efectiva, que es la de la aceptación', () => {
    expect(MIGRATION).toContain('and (p_from is null or ov.effective_date >= p_from)');
    expect(MIGRATION).toContain('and (p_to   is null or ov.effective_date <= p_to)');
    expect(TRANSFERS_MIGRATION).toContain('v_date := current_date;');
    expect(CHECK).toContain('F2 una transferencia de hoy entro en un intervalo anterior');
  });

  /**
   * No hay FX que decidir: la aceptación se rehúsa salvo que la divisa sea la
   * BASE de los dos Personales, así que lo recibido ya está en la base de
   * quien recibe.
   */
  it('no se abre ninguna conversión: la aceptación ya exige la base de los dos', () => {
    expect(TRANSFERS_MIGRATION).toContain(
      'perform sec.assert_no_conversion(v_to,   v_p.currency_definition_id);',
    );
    expect(sql(MIGRATION)).not.toMatch(/fx_|frozen_conversion|exchange/i);
  });
});

describe('el ayudante reducido', () => {
  it('es definer, sin EXECUTE para public, y publica tres columnas del ámbito propio', () => {
    expect(MIGRATION).toContain('security definer');
    expect(MIGRATION).toContain(
      'revoke execute on function sec.my_received_transfers(date, date) from public;',
    );
    expect(MIGRATION).toContain(
      'grant  execute on function sec.my_received_transfers(date, date) to authenticated;',
    );
    expect(MIGRATION).toContain('and s.owner_user_id = (select auth.uid())');
    expect(MIGRATION).toContain("set search_path = ''");
  });

  it('y el cliente no puede nombrarlo: sin USAGE sobre `sec`', () => {
    expect(CHECK).toContain('G4 authenticated tiene USAGE sobre sec');
    expect(CHECK).toContain('G5 un tercero ve transferencias ajenas');
    expect(CHECK).toContain('G7 el emisor ve como recibidas las que envio');
  });
});

describe('el desglose explica su total', () => {
  it('Ingresos lista también las transferencias recibidas del intervalo', () => {
    expect(HOME).toContain('const incomeTransfers = transfers.transfers.filter(');
    expect(HOME).toContain("(one) => one.direction === 'incoming' && one.groupScopeId === null,");
    expect(HOME).toContain('const incomeLines = interleaveActivity(');
    expect(HOME).toContain('function IncomeGroup({');
    expect(HOME).toContain('lines={incomeLines}');
  });

  it('la cuenta de la tarjeta es la del desglose, no otra', () => {
    expect(HOME).toContain(
      "const shown = kind === 'income' ? incomeLines.length : expenses.length;",
    );
    expect(HOME).toContain('count={shown}');
  });

  it('y es la MISMA fila de Movimientos recientes, no una copia', () => {
    expect(HOME).toContain('renderTransfer={renderTransfer}');
    expect(HOME).toContain('renderOperation={renderOperation}');
    // `IncomeGroup` no construye filas: sólo decide el orden.
    const group = HOME.slice(HOME.indexOf('function IncomeGroup({'));
    expect(group.slice(0, group.indexOf('function ExpenseGroup'))).not.toContain('<MovementRow');
  });
});

describe('CI lo ejecuta', () => {
  it('el check está registrado y termina con rollback', () => {
    expect(CI).toContain('supabase/checks/income-received-transfers.sql');
    expect(CHECK.trim().endsWith('rollback;')).toBe(true);
  });
});
