import { describe, expect, it } from 'vitest';

import type { ParticipantPresence } from '../../src/features/groups/participant-presence';
import {
  EXACT_LIMIT,
  greedyPayments,
  optimalPayments,
  type Position,
  proposePayments,
  type SuggestedPayment,
  suggestionOf,
} from '../../src/features/groups/suggested-payments';

/**
 * «PAGOS SUGERIDOS», como función pura sobre posiciones en unidades menores.
 *
 * Lo que se afirma son INVARIANTES del resultado —conservación exacta, ningún
 * pago a uno mismo ni en cero ni negativo, determinismo— sobre casos escritos
 * y sobre posiciones generadas; que el exacto ES el mínimo, contra un método
 * INDEPENDIENTE (todas las particiones en bloques de suma cero) en casos
 * pequeños; y cómo se interpreta para la pantalla.
 */

function pos(entries: Record<string, bigint>): Position[] {
  return Object.entries(entries).map(([participantId, minor]) => ({ participantId, minor }));
}

/** Lo que cada persona paga (negativo) o recibe (positivo) según la propuesta. */
function netOf(payments: readonly SuggestedPayment[]): Map<string, bigint> {
  const net = new Map<string, bigint>();
  for (const one of payments) {
    net.set(one.from, (net.get(one.from) ?? 0n) - one.minor);
    net.set(one.to, (net.get(one.to) ?? 0n) + one.minor);
  }
  return net;
}

function assertInvariants(positions: readonly Position[], payments: readonly SuggestedPayment[]) {
  const net = netOf(payments);
  for (const one of positions) {
    expect(net.get(one.participantId) ?? 0n, one.participantId).toBe(one.minor);
  }
  for (const one of payments) {
    expect(one.minor > 0n).toBe(true);
    expect(one.from).not.toBe(one.to);
  }
  const pending = positions.filter((one) => one.minor !== 0n).length;
  expect(payments.length).toBeLessThanOrEqual(Math.max(0, pending - 1));
}

/**
 * EL MÉTODO INDEPENDIENTE: el mínimo por definición. Se enumeran TODAS las
 * particiones del conjunto en bloques (números de Bell: 877 con siete
 * elementos), se cuentan las que tienen todos los bloques a suma cero y se
 * toma la de más bloques: el mínimo de pagos es n − k. No comparte nada con
 * la programación dinámica: ni máscaras, ni recurrencia, ni reconstrucción.
 */
function minimumByPartitions(positions: readonly Position[]): number {
  const items = positions.filter((one) => one.minor !== 0n);
  let bestBlocks = 0;
  const blocks: bigint[][] = [];
  const walk = (index: number) => {
    if (index === items.length) {
      if (blocks.every((block) => block.reduce((acc, v) => acc + v, 0n) === 0n)) {
        bestBlocks = Math.max(bestBlocks, blocks.length);
      }
      return;
    }
    const value = (items[index] as Position).minor;
    for (const block of blocks) {
      block.push(value);
      walk(index + 1);
      block.pop();
    }
    blocks.push([value]);
    walk(index + 1);
    blocks.pop();
  };
  walk(0);
  return items.length - bestBlocks;
}

/** Un generador determinista: la misma semilla, los mismos casos. */
function rng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state;
  };
}

function balanced(next: () => number, count: number, spread: number): Position[] {
  const positions: Position[] = [];
  let sum = 0n;
  for (let i = 0; i < count - 1; i += 1) {
    const minor = BigInt((next() % (2 * spread + 1)) - spread);
    positions.push({ participantId: `p${String(i).padStart(2, '0')}`, minor });
    sum += minor;
  }
  positions.push({ participantId: `p${String(count - 1).padStart(2, '0')}`, minor: -sum });
  return positions;
}

describe('los dos algoritmos conservan la posición de cada uno', () => {
  it('todos a cero: ningún pago', () => {
    expect(greedyPayments(pos({ ana: 0n, edu: 0n, sol: 0n }))).toEqual([]);
    expect(optimalPayments(pos({ ana: 0n, edu: 0n }))).toEqual([]);
    expect(proposePayments([])).toEqual({ payments: [], exact: true });
  });

  it('un deudor y varios acreedores: paga a cada uno lo suyo, el mayor primero', () => {
    const positions = pos({ ana: -2000n, edu: 500n, aitor: 1500n });
    const expected = [
      { from: 'ana', to: 'aitor', minor: 1500n },
      { from: 'ana', to: 'edu', minor: 500n },
    ];
    expect(greedyPayments(positions)).toEqual(expected);
    expect(optimalPayments(positions)).toEqual(expected);
    assertInvariants(positions, expected);
  });

  it('varios deudores y un acreedor: cada uno le paga lo suyo', () => {
    const positions = pos({ ana: -700n, luis: -300n, edu: 1000n });
    const expected = [
      { from: 'ana', to: 'edu', minor: 700n },
      { from: 'luis', to: 'edu', minor: 300n },
    ];
    expect(greedyPayments(positions)).toEqual(expected);
    expect(optimalPayments(positions)).toEqual(expected);
  });

  it('deudas cruzadas: menos pagos que pares, y sin pasar por nadie', () => {
    const cruzado = pos({ ana: -1000n, edu: 1000n, luis: -250n, sol: 250n });
    expect(greedyPayments(cruzado)).toHaveLength(2);
    expect(optimalPayments(cruzado)).toHaveLength(2);
    assertInvariants(cruzado, optimalPayments(cruzado) ?? []);
  });

  it('céntimos y desempates: importe descendente y, a igualdad, identidad ascendente', () => {
    const positions = pos({ zoe: -2n, edu: 1n, aitor: 1n });
    const expected = [
      { from: 'zoe', to: 'aitor', minor: 1n },
      { from: 'zoe', to: 'edu', minor: 1n },
    ];
    expect(greedyPayments(positions)).toEqual(expected);
    expect(optimalPayments(positions)).toEqual(expected);
  });

  it('no proponen nada sobre saldos que no suman cero', () => {
    expect(() => greedyPayments(pos({ ana: -100n, edu: 99n }))).toThrow(/SUGGESTION_UNBALANCED/);
    expect(() => optimalPayments(pos({ ana: -100n, edu: 99n }))).toThrow(/SUGGESTION_UNBALANCED/);
  });
});

describe('el exacto es el mínimo; el voraz, no siempre', () => {
  it('el contraejemplo del voraz: 8, 7 y 5 contra 12 y 8 → voraz 4, mínimo 3', () => {
    const positions = pos({ a8: -8n, b7: -7n, c5: -5n, x12: 12n, y8: 8n });
    const greedy = greedyPayments(positions);
    expect(greedy).toHaveLength(4);
    assertInvariants(positions, greedy);

    const exact = optimalPayments(positions) ?? [];
    expect(exact).toHaveLength(3);
    expect(exact).toEqual(
      expect.arrayContaining([
        { from: 'a8', to: 'y8', minor: 8n },
        { from: 'b7', to: 'x12', minor: 7n },
        { from: 'c5', to: 'x12', minor: 5n },
      ]),
    );
    assertInvariants(positions, exact);
    expect(minimumByPartitions(positions)).toBe(3);
  });

  it('coincide con el mínimo por particiones en casos pequeños generados', () => {
    const next = rng(20260911);
    let strictlyBetter = 0;
    for (let round = 0; round < 250; round += 1) {
      const count = 2 + (next() % 6); // hasta 7: 877 particiones
      const positions = balanced(next, count, 6); // valores pequeños: empates y sumas cero frecuentes
      const exact = optimalPayments(positions) ?? [];
      const greedy = greedyPayments(positions);
      const minimum = minimumByPartitions(positions);

      expect(exact.length, JSON.stringify(positions.map((p) => String(p.minor)))).toBe(minimum);
      expect(greedy.length).toBeGreaterThanOrEqual(minimum);
      if (greedy.length > minimum) strictlyBetter += 1;
      assertInvariants(positions, exact);
      assertInvariants(positions, greedy);
    }
    // Y el contraste no es vacío: en algunos casos el voraz se queda corto.
    expect(strictlyBetter).toBeGreaterThan(0);
  });

  it('es determinista: el orden de entrada no cambia la propuesta, en los dos', () => {
    const next = rng(7);
    for (let round = 0; round < 50; round += 1) {
      const positions = balanced(next, 2 + (next() % 9), 40);
      const shuffled = [...positions].sort(() => (next() % 2 === 0 ? -1 : 1));
      expect(optimalPayments(shuffled)).toEqual(optimalPayments(positions));
      expect(greedyPayments(shuffled)).toEqual(greedyPayments(positions));
    }
  });

  it('las invariantes se sostienen sobre posiciones generadas hasta el límite exacto', () => {
    const next = rng(99);
    for (let round = 0; round < 60; round += 1) {
      const positions = balanced(next, 2 + (next() % (EXACT_LIMIT - 1)), 10000);
      const exact = optimalPayments(positions) ?? [];
      assertInvariants(positions, exact);
      expect(exact.length).toBeLessThanOrEqual(greedyPayments(positions).length);
    }
  });
});

describe('la selección del algoritmo', () => {
  it('cuenta personas CON saldo, no miembros: catorce con saldo y muchos a cero sigue siendo exacto', () => {
    const next = rng(3);
    const withBalance = balanced(next, EXACT_LIMIT, 500);
    const zeros = Array.from({ length: 20 }, (_, i) => ({ participantId: `z${i}`, minor: 0n }));
    const proposal = proposePayments([...zeros, ...withBalance]);
    expect(proposal.exact).toBe(true);
    assertInvariants(withBalance, proposal.payments);
  });

  it('quince con saldo: voraz, y se dice', () => {
    const next = rng(4);
    const positions = balanced(next, EXACT_LIMIT + 1, 500);
    const proposal = proposePayments(positions);
    expect(proposal.exact).toBe(false);
    expect(proposal.payments).toEqual(greedyPayments(positions));
    expect(optimalPayments(positions)).toBeNull();
  });

  /**
   * LOS LÍMITES DE REPRESENTABILIDAD. Las sumas del exacto son enteros de 64
   * bits: nada pasa por coma flotante, así que más allá de 2^53 sigue siendo
   * exacto; la única cota es la del entero de 64 bits, calculada en bigint
   * antes de escribir nada, y por encima se cae al voraz sin truncar.
   */
  it('por encima de 2^53 el exacto sigue siendo exacto: un caso que un Float64 rompería', () => {
    // En coma flotante, 2^53 + 1 se redondea a 2^53 y la suma dejaría de ser
    // cero; en enteros suma cero y la propuesta existe y cuadra.
    const big = 2n ** 53n;
    const positions = pos({ a: big + 1n, b: 1n, c: -(big + 2n) });
    expect(Number(big + 1n) + Number(1n) + Number(-(big + 2n))).not.toBe(0);
    const exact = optimalPayments(positions);
    expect(exact).not.toBeNull();
    assertInvariants(positions, exact ?? []);
    expect(exact).toHaveLength(2);

    // Y una partición sólo visible en enteros: {2^53+1, −(2^53+1)} y {3, −3}.
    const pair = pos({ a: big + 1n, b: -(big + 1n), c: 3n, d: -3n });
    expect(optimalPayments(pair)).toHaveLength(2);
    expect(proposePayments(pair).exact).toBe(true);
  });

  it('en el borde del entero de 64 bits: dentro es exacto; fuera, voraz sin truncar', () => {
    // La cota es la suma de MAGNITUDES (lo que se debe más lo que se cobra),
    // que es el doble de lo que suman los positivos.
    const max = 2n ** 63n - 1n;
    const positive = 2n ** 62n - 1n; // magnitud total 2^63 − 2: cabe
    const inside = pos({ a: -(2n ** 61n), b: -(2n ** 61n - 1n), c: positive });
    const exact = optimalPayments(inside);
    expect(exact).not.toBeNull();
    assertInvariants(inside, exact ?? []);
    expect(exact?.reduce((acc, one) => acc + one.minor, 0n)).toBe(positive);
    expect(2n * positive <= max).toBe(true);

    // Magnitud total 2^63: ya no cabe. Voraz, y los importes siguen exactos.
    const outside = pos({ a: -(2n ** 61n), b: -(2n ** 61n), c: 2n ** 62n });
    expect(optimalPayments(outside)).toBeNull();
    const proposal = proposePayments(outside);
    expect(proposal.exact).toBe(false);
    assertInvariants(outside, proposal.payments);
    expect(proposal.payments.every((one) => typeof one.minor === 'bigint')).toBe(true);
  });

  it('la cota se decide antes de escribir nada: un saldo individual fuera de 64 bits también cae al voraz', () => {
    const over = 2n ** 63n;
    const positions = pos({ a: -over, b: over });
    expect(optimalPayments(positions)).toBeNull();
    expect(proposePayments(positions)).toEqual({
      payments: [{ from: 'a', to: 'b', minor: over }],
      exact: false,
    });
  });

  it('en el límite de catorce el exacto cuesta milisegundos, no segundos (medido aquí, no en el iPhone)', () => {
    const next = rng(2026);
    const samples: number[] = [];
    for (let round = 0; round < 20; round += 1) {
      const positions = balanced(next, EXACT_LIMIT, 100000);
      const started = performance.now();
      const exact = optimalPayments(positions);
      samples.push(performance.now() - started);
      expect(exact).not.toBeNull();
    }
    const worst = Math.max(...samples);
    const median = [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)] ?? 0;
    // eslint-disable-next-line no-console -- la medida es el resultado de la prueba
    console.info(
      `optimalPayments n=14: mediana ${median.toFixed(2)} ms, peor ${worst.toFixed(2)} ms`,
    );
    expect(worst).toBeLessThan(100);
  });
});

describe('la propuesta para la pantalla', () => {
  const active: ParticipantPresence = {
    isActive: true,
    eligibleUntil: null,
    isRetired: false,
    isDeparted: false,
  };
  const gone: ParticipantPresence = {
    isActive: false,
    eligibleUntil: '2026-09-10',
    isRetired: false,
    isDeparted: false,
  };
  const row = (participantId: string, netMinor: string) => ({ participantId, netMinor });

  it('todo saldado, sin pagos de cero', () => {
    expect(suggestionOf([row('ana', '0'), row('edu', '0')], () => active)).toEqual({
      kind: 'settled',
    });
  });

  it('lista, exacta, con saldos activos', () => {
    expect(suggestionOf([row('ana', '-500'), row('edu', '500')], () => active)).toEqual({
      kind: 'ready',
      payments: [{ from: 'ana', to: 'edu', minor: 500n }],
      exact: true,
    });
  });

  it('quien salió con saldo pendiente bloquea la propuesta, nombrado, sin recalcular el resto', () => {
    const presence = (id: string) => (id === 'ana' ? gone : active);
    const out = suggestionOf([row('ana', '-550'), row('luis', '350'), row('edu', '200')], presence);
    expect(out).toEqual({ kind: 'inactive', participantIds: ['ana'] });
  });

  it('un par REABIERTO con quien salió entra como pago fijo y no bloquea (F09/ADR-007 C6, excepción 2)', () => {
    // «Prueba» el 2026-09-13: Aitor (fuera) −10, Edu +10; el servidor publica Aitor → Edu 10.
    const presence = (id: string) => (id === 'aitor' ? gone : active);
    const reopened = [
      { debtorParticipantId: 'aitor', creditorParticipantId: 'edu', amountMinor: '1000' },
    ];
    expect(suggestionOf([row('aitor', '-1000'), row('edu', '1000')], presence, reopened)).toEqual({
      kind: 'ready',
      payments: [{ from: 'aitor', to: 'edu', minor: 1000n, reopened: true }],
      exact: true,
    });
    // Con más saldo entre activos, el par fijo va delante y el resto se calcula sin él (no se duplica).
    const out = suggestionOf(
      [row('aitor', '-1000'), row('edu', '1500'), row('bea', '-500')],
      presence,
      reopened,
    );
    expect(out).toEqual({
      kind: 'ready',
      payments: [
        { from: 'aitor', to: 'edu', minor: 1000n, reopened: true },
        { from: 'bea', to: 'edu', minor: 500n },
      ],
      exact: true,
    });
    // Lo que el par no explica de un inactivo sigue bloqueando, y se nombra.
    expect(suggestionOf([row('aitor', '-1500'), row('edu', '1500')], presence, reopened)).toEqual({
      kind: 'inactive',
      participantIds: ['aitor'],
    });
    // Un par ilegible o con alguien que no está en los saldos: nada se inventa.
    expect(
      suggestionOf([row('aitor', '-1000'), row('edu', '1000')], presence, [
        { debtorParticipantId: 'nadie', creditorParticipantId: 'edu', amountMinor: '1000' },
      ]).kind,
    ).toBe('unavailable');
  });

  it('quien salió a cero no bloquea nada; sin presencia conocida no se supone inactivo', () => {
    const presence = (id: string) => (id === 'ana' ? gone : active);
    expect(
      suggestionOf([row('ana', '0'), row('luis', '-300'), row('edu', '300')], presence).kind,
    ).toBe('ready');
    expect(suggestionOf([row('ana', '-300'), row('edu', '300')], () => null).kind).toBe('ready');
  });

  it('datos incompletos o que no cuadran: no disponible, sin inventar compensaciones', () => {
    for (const rows of [
      [row('ana', '-300'), row('edu', '299')],
      [row('ana', 'abc'), row('edu', '300')],
      [row('ana', '3.5'), row('edu', '-3.5')],
    ]) {
      expect(suggestionOf(rows, () => active)).toEqual({ kind: 'unavailable' });
    }
  });

  it('se rehace con los saldos nuevos: no hay nada guardado', () => {
    expect(suggestionOf([row('ana', '-500'), row('edu', '500')], () => active).kind).toBe('ready');
    expect(suggestionOf([row('ana', '0'), row('edu', '0')], () => active).kind).toBe('settled');
  });
});
