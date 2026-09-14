import { describe, expect, it } from 'vitest';

import { currencyDefinition, money } from '../../src/domain';
import {
  groupPosition,
  positionAmount,
  positionLabel,
  positionState,
  positionTone,
} from '../../src/features/groups/group-position';
import { formatMoney } from '../../src/lib/format/money';
import { formatLocale } from '../../src/lib/i18n/locales';
import { pluralCategory } from '../../src/lib/i18n/plural';
import { translate } from '../../src/lib/i18n/translate';

/**
 * LA POSICIÓN NETA DE UN GRUPO: cálculo, estados, colores y formato.
 *
 * Todo puro, y por eso se interroga por comportamiento y no por estructura. Lo
 * que la tarjeta hace con esto se comprueba aparte, en
 * `tests/infra/groups-list-surface.test.ts`.
 */

/**
 * Los espacios que `Intl` mete entre cifra y símbolo son duros o finos, no el
 * de la barra espaciadora. Se normalizan para comparar, igual que hace
 * `tests/lib/format.test.ts`.
 */
const plano = (texto: string) => texto.replace(/[   ]/g, ' ');

/** Las locales, tipadas como las tipa `tests/lib/format.test.ts`. */
const ES = formatLocale('es-ES');
const EN = formatLocale('en');

const EUR = currencyDefinition({ id: 'eur', code: 'EUR', scale: 2 });
const JPY = currencyDefinition({ id: 'jpy', code: 'JPY', scale: 0 });
const BHD = currencyDefinition({ id: 'bhd', code: 'BHD', scale: 3 });

describe('la resta que define la posición', () => {
  it('suma con signo: lo que me deben menos lo que debo', () => {
    // +30 de Ana, +45 de Luis, −12 que yo debo a Marta.
    expect(groupPosition(['3000', '4500', '-1200'])).toEqual({ kind: 'net', minor: 6300n });
  });

  it('una colección VACÍA es cero de verdad, no «no se sabe»', () => {
    /*
     * Es la diferencia entre este contrato y un valor por defecto: «no debo
     * nada» es un hecho, y se puede afirmar cuando la ausencia es real.
     */
    expect(groupPosition([])).toEqual({ kind: 'net', minor: 0n });
  });

  /**
   * **Aquí se comprobaba que `GROUP_DEBT_AMOUNTS` seguía vacía**, y con ello
   * que «Saldado» era una conclusión y no un valor por defecto.
   *
   * La constante se ha retirado, y la razón es que la prueba no podía fallar
   * cuando el mundo cambió: F9 abrió la ruta a `record_group_expense`, cada
   * tarjeta empezó a decir «Saldado · 0,00» sobre grupos con deuda, y esta
   * prueba siguió en verde porque comprobaba la constante contra sí misma.
   *
   * Lo que la sustituye comprueba la posición REAL de un grupo tal y como
   * llega de `net_position`, que es el dato que ahora pinta la tarjeta.
   */
  it('una posición real llega como un solo importe con signo', () => {
    expect(groupPosition(['1000'])).toEqual({ kind: 'net', minor: 1000n });
    expect(groupPosition(['-1000'])).toEqual({ kind: 'net', minor: -1000n });
  });

  it('ausente NO es cero: es no disponible', () => {
    expect(groupPosition(null)).toEqual({ kind: 'unavailable' });
    expect(groupPosition(undefined)).toEqual({ kind: 'unavailable' });
  });

  it('un importe ilegible tumba TODA la posición, no sólo su sumando', () => {
    /*
     * Una cifra que no se puede defender no se convierte en el resto de la
     * suma. Antes que afirmar un saldo parcial como si fuera el total, no se
     * afirma nada.
     */
    expect(groupPosition(['3000', 'doce'])).toEqual({ kind: 'unavailable' });
    expect(groupPosition(['3000', '12.50'])).toEqual({ kind: 'unavailable' });
  });

  it('la cadena vacía tampoco cuela como cero', () => {
    /*
     * `BigInt('')` y `BigInt('   ')` devuelven `0n` SIN lanzar, que es «no hay
     * dato» colapsando a cero por otra puerta.
     */
    expect(groupPosition([''])).toEqual({ kind: 'unavailable' });
    expect(groupPosition(['   '])).toEqual({ kind: 'unavailable' });
  });

  it('aguanta importes que no caben en un número de coma flotante', () => {
    // 2^53 + 1 en unidad mínima: exacto con bigint, roto con `number`.
    expect(groupPosition(['9007199254740993'])).toEqual({
      kind: 'net',
      minor: 9007199254740993n,
    });
  });
});

describe('los tres estados, y el seguro', () => {
  it('positivo es «te deben», negativo «debes», cero «saldado»', () => {
    expect(positionState({ kind: 'net', minor: 1n })).toBe('owed');
    expect(positionState({ kind: 'net', minor: -1n })).toBe('owing');
    expect(positionState({ kind: 'net', minor: 0n })).toBe('settled');
  });

  it('y lo no interpretable NO se presenta como saldado', () => {
    /*
     * El requisito literal: si apareciera un grupo con operaciones que este
     * cliente no sabe leer, la tarjeta no puede mentir diciendo que está en paz.
     */
    expect(positionState({ kind: 'unavailable' })).toBe('unavailable');
    expect(positionState({ kind: 'unavailable' })).not.toBe('settled');
  });

  it('cada estado tiene su etiqueta, y ninguna se repite', () => {
    const etiquetas = (['owed', 'owing', 'settled', 'unavailable'] as const).map(positionLabel);
    expect(etiquetas).toEqual([
      'group.owedToYou',
      'group.youOwe',
      'group.settled',
      'group.positionUnknown',
    ]);
    expect(new Set(etiquetas).size).toBe(4);
  });

  it('rojo si debes, verde si te deben, blanco en paz — y apagado sin dato', () => {
    expect(positionTone('owing')).toBe('negative');
    expect(positionTone('owed')).toBe('positive');
    expect(positionTone('settled')).toBe('text');
    expect(positionTone('unavailable')).toBe('textDisabled');
  });

  it('el importe se enseña SIN signo: la dirección la dice la etiqueta', () => {
    expect(positionAmount({ kind: 'net', minor: -1200n })).toBe(1200n);
    expect(positionAmount({ kind: 'net', minor: 1200n })).toBe(1200n);
    expect(positionAmount({ kind: 'net', minor: 0n })).toBe(0n);
    // Y sin dato no hay cifra que enseñar.
    expect(positionAmount({ kind: 'unavailable' })).toBe(null);
  });
});

describe('el formato, en la divisa base del grupo', () => {
  it('cero se dice como cero de esa divisa, con su escala', () => {
    expect(plano(formatMoney(money(0n, EUR), ES))).toBe('0,00 €');
    // Y NUNCA se presuponen dos decimales (F02/ADR-001 §3).
    expect(plano(formatMoney(money(0n, JPY), ES))).toBe('0 JPY');
    expect(plano(formatMoney(money(0n, BHD), ES))).toBe('0,000 BHD');
  });

  it('un importe grande se agrupa, y sigue siendo exacto', () => {
    expect(plano(formatMoney(money(123456789n, EUR), ES))).toBe('1.234.567,89 €');
  });

  it('un importe pequeño no se redondea a nada', () => {
    expect(plano(formatMoney(money(1n, EUR), ES))).toBe('0,01 €');
  });
});

describe('la pluralización del contador', () => {
  it('uno es singular y todo lo demás plural, en las dos locales', () => {
    for (const locale of ['es-ES', 'en'] as const) {
      expect(pluralCategory(locale, 1)).toBe('one');
      expect(pluralCategory(locale, 0)).toBe('other');
      expect(pluralCategory(locale, 2)).toBe('other');
      expect(pluralCategory(locale, 17)).toBe('other');
    }
  });

  it('y el catálogo dice lo correcto en cada forma', () => {
    const decir = (locale: 'es-ES' | 'en', count: number) =>
      translate(
        locale,
        pluralCategory(locale, count) === 'one'
          ? 'group.participantsOne'
          : 'group.participantsOther',
        { count },
      );

    expect(decir('es-ES', 1)).toBe('1 participante');
    expect(decir('es-ES', 2)).toBe('2 participantes');
    expect(decir('es-ES', 12)).toBe('12 participantes');
    expect(decir('en', 1)).toBe('1 participant');
    expect(decir('en', 3)).toBe('3 participants');
  });
});

describe('la etiqueta accesible', () => {
  it('nombra el grupo, los participantes y la posición completa', () => {
    const posicion = `${translate('es-ES', 'group.settled')} ${formatMoney(money(0n, EUR), ES)}`;
    expect(
      plano(
        translate('es-ES', 'groups.cardLabel', {
          name: 'Viaje a Portugal',
          participants: translate('es-ES', 'group.participantsOther', { count: 3 }),
          position: posicion,
        }),
      ),
    ).toBe('Viaje a Portugal, 3 participantes, Saldado 0,00 €');
  });

  it('y en inglés dice la dirección correcta cuando hay deuda', () => {
    const posicion = `${translate('en', 'group.youOwe')} ${formatMoney(money(1250n, EUR), EN)}`;
    expect(
      plano(
        translate('en', 'groups.cardLabel', {
          name: 'Flat',
          participants: translate('en', 'group.participantsOne', { count: 1 }),
          position: posicion,
        }),
      ),
    ).toBe('Flat, 1 participant, You owe €12.50');
  });
});
