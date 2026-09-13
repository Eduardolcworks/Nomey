import { describe, expect, it } from 'vitest';

import SCREEN from '../../src/app/group/[id].tsx?raw';
import CARD from '../../src/features/groups/suggested-payments-card.tsx?raw';
import MODEL from '../../src/features/groups/suggested-payments.ts?raw';
import SERVICE from '../../src/features/groups/group-service.ts?raw';
import DOMAIN_README from '../../src/domain/README.md?raw';

/**
 * «PAGOS SUGERIDOS»: lo estructural. Las invariantes del cálculo viven en
 * `tests/lib/suggested-payments.test.ts`; aquí, de dónde salen los datos, qué
 * NO hace esta pieza y dónde vive.
 */

describe('la tarjeta', () => {
  it('va bajo la lista de Saldos, sobre los MISMOS saldos, sin filtros ni página', () => {
    expect(SCREEN).toContain('<SuggestedPaymentsCard');
    expect(SCREEN).toContain('balances={movements.balances}');
    // Los saldos son el conjunto entero de `api.group_balance`: sin límite ni filtro.
    const lectura = SERVICE.slice(
      SERVICE.indexOf('export async function fetchGroupBalances'),
      SERVICE.indexOf('export type GroupPositionRow'),
    );
    expect(lectura).not.toMatch(/\.limit\(|\.range\(|minMinor|categoryId/);
  });

  it('el oblongo amarillo abre y cierra; la propuesta se deriva de los saldos, sin guardar nada', () => {
    expect(CARD).toContain('tone="brand"');
    expect(CARD).toContain('setOpen((value) => !value);');
    // Derivada de los saldos con la tarjeta abierta; nada guardado ni efecto.
    expect(CARD).toContain('() => (open ? suggestionOf(balances, presenceOf, reopened) : null)');
    expect(CARD).toContain('[open, balances, presenceOf, reopened]');
    expect(CARD).not.toMatch(/useEffect|AsyncStorage|queueStore|rpc\(/);
  });

  it('nombres y cifras reales; el importe no cede ante un nombre largo', () => {
    expect(CARD).toContain('format.money(money(payment.minor, currency))');
    expect(CARD).toContain('name={Symbols.arrowRight}');
    expect(CARD).toMatch(/names: \{[\s\S]*flex: 1,\s*minWidth: 0/);
    expect(CARD).toMatch(/amount: \{[\s\S]*flexShrink: 0/);
    expect(CARD).toContain("t(suggestion.exact ? 'group.suggestExact' : 'group.suggestGreedy')");
    expect(CARD).toContain("t('group.allSettled')");
  });

  it('la tarjeta no escribe: «Saldado» avisa a la pantalla y el modelo sigue puro', () => {
    expect(CARD).not.toMatch(
      /useSettleParticipant|useRecordPayment|useAnnul|record_|rpc\(|Alert\.alert|supabase/,
    );
    expect(CARD).toContain('onSettle(payment);');
    expect(MODEL).not.toMatch(/supabase|rpc|fetch/);
  });
});

describe('inactivos y no disponible', () => {
  it('quien salió con saldo bloquea la propuesta entera y se nombra; a cero, no', () => {
    expect(MODEL).toContain(
      "if (inactive.length > 0) return { kind: 'inactive', participantIds: inactive };",
    );
    expect(MODEL).toContain('const pending = remaining.filter((one) => one.minor !== 0n);');
    expect(CARD).toContain("t('group.suggestInactive'");
  });

  it('saldos que no cuadran o datos rotos: no disponible, sin compensar', () => {
    expect(MODEL).toContain('SUGGESTION_UNBALANCED');
    expect(MODEL).toContain("if (minor === null) return { kind: 'unavailable' };");
    expect(CARD).toContain("t('group.suggestUnavailable')");
  });
});

describe('dónde vive, y por qué', () => {
  it('en la feature, no en el dominio: el README del dominio sigue diciendo la verdad', () => {
    expect(DOMAIN_README).toContain(
      'La minimización del número de pagos para saldar un\ngrupo no está implementada',
    );
    expect(MODEL).not.toContain("from '@/domain'");
  });

  it('promete el mínimo sólo cuando el exacto lo garantiza; el voraz dice «propuesta»', () => {
    expect(MODEL).toContain('export const EXACT_LIMIT = 14;');
    expect(MODEL).toContain('if (pending.length <= EXACT_LIMIT) {');
    expect(MODEL).toContain('**No garantiza el mínimo**');
    expect(MODEL).toContain('O(n · 2^n)');
  });

  it('las sumas del exacto son enteras: ningún importe pasa por coma flotante', () => {
    expect(MODEL).toContain('new BigInt64Array(size)');
    expect(MODEL).toContain('const INT64_MAX = 2n ** 63n - 1n;');
    expect(MODEL).toContain('if (magnitude > INT64_MAX) return null;');
    expect(MODEL).not.toMatch(/Float64Array|Number\(|parseFloat|MAX_SAFE_INTEGER/);
  });
});
