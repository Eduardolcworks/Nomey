import { describe, expect, it } from 'vitest';

import HOME from '../../src/app/(tabs)/index.tsx?raw';
import MODEL from '../../src/features/personal/expense-share.ts?raw';
import ROW from '../../src/features/personal/share-row.tsx?raw';
import SERVICE from '../../src/features/personal/personal-service.ts?raw';
import HOOK from '../../src/features/personal/use-personal-home.ts?raw';
import MOVEMENT_ROW from '../../src/features/personal/movement-row.tsx?raw';
import CI from '../../.github/workflows/ci.yml?raw';
import CHECK from '../../supabase/checks/personal-expense-breakdown.sql?raw';
import MIGRATION from '../../supabase/migrations/20260912120000_personal_expense_share_rows.sql?raw';

/**
 * EL DESGLOSE DE GASTOS EXPLICA SU TOTAL. Lo estructural: de dónde salen las
 * cuotas, que son las mismas que suma el total, que Movimientos recientes no
 * cambia, y cómo se pinta una cuota. Lo que sólo la base puede demostrar
 * —reconciliación exacta, corrección, anulación, historial tras salir,
 * aislamiento— lo mide `supabase/checks/personal-expense-breakdown.sql`.
 */

function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** El SQL sin sus comentarios `--`: se afirma sobre lo que se ejecuta. */
function sql(text: string): string {
  return text.replace(/--.*$/gm, '');
}

describe('la lectura', () => {
  it('se apoya en la MISMA función reducida que suma el total: no hay segunda atribución', () => {
    expect(MIGRATION).toContain('from sec.my_shared_expense_shares(p_from, p_to) sh');
    expect(MIGRATION).toContain('create function sec.my_shared_expense_share_row(');
    expect(MIGRATION).toContain('security definer');
    // Sin membresía: F09/ADR-003 conserva el historial personal de quien salió.
    expect(sql(MIGRATION)).not.toContain('is_member');
    // La api es invoker y delega; el cuerpo se resuelve al crearse.
    const api = MIGRATION.slice(MIGRATION.indexOf('create function api.personal_expense_share('));
    expect(api).not.toContain('security definer');
    expect(api).toContain('begin atomic');
    expect(api).toContain('select * from sec.my_shared_expense_share_row(p_from, p_to);');
  });

  it('publica contexto contextual, nunca vínculos globales, y la cifra es la cuota', () => {
    expect(MIGRATION).toContain('py.display_name');
    expect(MIGRATION).toContain('sh.amount::text');
    expect(MIGRATION).toContain('ov.original_amount::text');
    expect(sql(MIGRATION)).not.toMatch(/l\.user_id|auth\.users|user_id as/);
    // Ni un efecto, ni personal_operation, ni personal_statistics tocados.
    expect(sql(MIGRATION)).not.toMatch(
      /insert into core\.effect|personal_operation|personal_statistics\(/,
    );
  });

  it('el cliente pide las cuotas ENTERAS, página a página, con el intervalo y el orden de la lista', () => {
    expect(SERVICE).toContain("rpc('personal_expense_share'");
    expect(SERVICE).toContain('for (let offset = 0; ; offset += PAGE_SIZE) {');
    expect(SERVICE).toContain('if (page.length < PAGE_SIZE) return rows;');
    expect(SERVICE).toContain(".order('effective_time', { ascending: false, nullsFirst: false })");
    // Y en la misma ventana quieta que las estadísticas y la lista.
    // (F11.C añadió el catálogo monetario al mismo bloque; las cuotas siguen en él.)
    expect(HOOK).toContain('const [statistics, page, shares, currencies] = await Promise.all([');
    expect(HOOK).toContain('fetchExpenseShares(range),');
    expect(HOOK).toContain('shares: current?.shares ?? EMPTY_SHARES,');
  });
});

describe('el desglose', () => {
  it('son los gastos personales de la proyección MÁS las cuotas, en el orden de la lista', () => {
    expect(HOME).toContain("(op) => movementKind(op.operation_class) === 'expense'");
    expect(HOME).toContain('const expenses = expenseLines(personalExpenses, home.shares);');
    expect(MODEL).toContain('compareOperations(orderKeys(a), orderKeys(b))');
    // La fila de CAJA del compartido queda fuera del desglose…
    expect(code(HOME)).not.toContain("kind === 'expense' || kind === 'shared'");
    // …y Movimientos recientes sigue pintando la proyección entera, ahora
    // intercalada con las transferencias de `my_transfers` (F12.C): la
    // proyección es la primera lista que se le da a la mezcla.
    expect(HOME).toContain('const activity = interleaveActivity(\n    projected.operations,');
    expect(HOME).toContain(': renderOperation(entry.operation),');
    expect(HOME).toContain('function ExpenseGroup(');
  });

  it('las personales conservan su fila, su proyección y sus acciones; las páginas que faltan se dicen', () => {
    expect(HOME).toContain('key={operation.render_key}');
    expect(HOME).toContain(
      '<MoreRow remaining={more.remaining} loading={home.loadingMore} onPress={home.loadMore} />',
    );
    expect(HOME.match(/<MovementRow/g)).toHaveLength(3);
  });

  it('el total y el diagrama siguen saliendo de las estadísticas, nunca de sumar filas', () => {
    expect(HOME).toContain('categorySlices(projected.statistics.categories');
    expect(code(HOME)).not.toMatch(/shares\.reduce|share_amount/);
  });
});

describe('la fila de una cuota', () => {
  it('cerrada: emoji real del grupo, nombre del grupo, categoría, y mi cuota en su divisa', () => {
    expect(ROW).toContain('{share.group_emoji ?? ');
    expect(ROW).toContain("share.group_display_name ?? t('home.sharedGroupUnknown')");
    expect(ROW).toContain("categoryName(category, t) ?? t('home.categoryUnknown')");
    // F11/ADR-003: la cuota que se enseña es la PERSONAL, en la base del Modo
    // Personal, que es la que suman los totales de esta misma pantalla.
    expect(ROW).toContain('-BigInt(share.personal_amount),');
    expect(ROW).toContain('share.personal_currency_definition_id');
    expect(ROW).toContain('id: share.currency_definition_id,');
    // El importe no cede ante un nombre largo.
    expect(ROW).toMatch(/copy: \{[\s\S]*flex: 1,\s*minWidth: 0/);
    expect(ROW).toMatch(/amounts: \{[\s\S]*flexShrink: 0/);
  });

  it('desplegada: concepto, pagado por, importe total y fecha; sin editar ni eliminar', () => {
    expect(ROW).toContain("t('home.detailConcept')");
    expect(ROW).toContain("t('home.detailPaidBy')");
    expect(ROW).toContain("t('home.detailTotal')");
    expect(ROW).toContain("t('home.detailDate')");
    // Y el total, en la moneda DECLARADA.
    expect(ROW).toContain('BigInt(share.total_amount),');
    expect(ROW).toContain('share.original_currency_definition_id');
    expect(ROW).not.toMatch(
      /IconButton|onEdit|onDelete|SwipeToDelete|Symbols\.delete|Symbols\.edit/,
    );
    // El estado explícito cuando el contexto no llega; la cuota se conserva.
    expect(ROW).toContain("share.payer_display_name ?? t('home.sharedPayerUnknown')");
  });

  it('misma anatomía y despliegue que MovementRow', () => {
    for (const piece of [
      'width: 34,',
      'paddingLeft: 34 + Spacing.sm,',
      'borderBottomWidth: StyleSheet.hairlineWidth,',
    ]) {
      expect(ROW).toContain(piece);
      expect(MOVEMENT_ROW).toContain(piece);
    }
    expect(ROW).toContain(
      "accessibilityHint={t(expanded ? 'home.movementCollapse' : 'home.movementExpand')}",
    );
  });
});

describe('lo que la base demuestra, y CI ejecuta', () => {
  it('cinco filas que explican 110, a medias 10/10, caja intacta, lo ajeno fuera, corrección, anulación, intervalo, reconciliación, aislamiento e historial', () => {
    for (const marker of [
      'B4 las cinco filas no explican el total',
      'C1b Viajes no dice que pago Edu',
      'C2 un gasto en el que no participo aparece como consumo mio',
      'C3 mi pago no sale como 20,00 de caja',
      'D1 tras corregir',
      'D2 la anulada sigue en el desglose',
      'E2 categoria %s: filas %s <> diagrama %s',
      'F1b Ana ve gastos personales de Edu',
      'F3c el contexto se perdio al salir',
    ]) {
      expect(CHECK).toContain(marker);
    }
    expect(CHECK.trim().endsWith('rollback;')).toBe(true);
    expect(CI).toContain('supabase/checks/personal-expense-breakdown.sql');
  });
});
