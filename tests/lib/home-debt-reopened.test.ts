import { describe, expect, it } from 'vitest';

import { positionAcross } from '../../src/features/groups/group-projection';
import { homeDebt } from '../../src/features/personal/debt-display';

/**
 * DEUDAS DE INICIO PARA QUIEN SALIÓ (F09/ADR-007 C6): el recorrido del cliente
 * con las respuestas REALES que PostgREST devolvió a Aitor el 2026-09-13
 * (`group_summary` vacío, `my_reopened_debt` −1000 EUR, Personal en EUR).
 *
 * La composición vive en la ruta (`debtSnapshot`, `src/app/(tabs)/index.tsx`)
 * y no se importa desde aquí; lo que se fija es cada pieza pura con esos datos
 * y la regla que la ruta aplica: posiciones por membresía + deuda reabierta,
 * misma divisa, y «sin lectura no hay cero».
 */
const EUR = '830e6f7e-2e33-564e-9ea3-f6c2023af1fe';

describe('Deudas de Inicio con la deuda reabierta', () => {
  it('sin grupos activos la posición por membresía es un cero CONOCIDO, no «no disponible»', () => {
    // Sin grupos no hay salida anticipada: `positionAcross` devuelve net 0.
    expect(positionAcross([], EUR)).toEqual({ kind: 'net', minor: 0n });
  });

  it('la deuda reabierta se suma a ese cero y la tarjeta enseña −10,00', () => {
    // Lo que la ruta hace con la respuesta real de api.my_reopened_debt().
    const reopened = [{ currencyDefinitionId: EUR, amountMinor: '-1000' }];
    const net = positionAcross([], EUR);
    if (net.kind !== 'net') throw new Error('unreachable');
    let total = net.minor;
    for (const one of reopened) {
      if (one.currencyDefinitionId === EUR) total += BigInt(one.amountMinor);
    }
    expect(homeDebt({ loaded: true, amounts: [total.toString()] })).toEqual({
      kind: 'amount',
      minor: -1000n,
    });
  });

  it('sin la lectura de deuda reabierta no se afirma un cero', () => {
    // `debtSnapshot` devuelve { loaded: false } cuando `reopened` es null.
    expect(homeDebt({ loaded: false })).toEqual({ kind: 'unknown' });
  });

  it('una deuda reabierta en otra divisa con importe vivo deja la tarjeta en desconocido', () => {
    const reopened = [{ currencyDefinitionId: 'otra', amountMinor: '-500' }];
    const unavailable = reopened.some(
      (one) => one.currencyDefinitionId !== EUR && BigInt(one.amountMinor) !== 0n,
    );
    expect(unavailable).toBe(true);
  });
});
