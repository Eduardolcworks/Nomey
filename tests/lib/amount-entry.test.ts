import { describe, expect, it } from 'vitest';

import {
  type AmountEntry,
  amountComplete,
  amountEntryFromMinor,
  amountParts,
  amountTones,
  amountTouched,
  amountValue,
  applyAmountInput,
  backspaceAmount,
  EMPTY_AMOUNT,
  toMinorUnits,
} from '../../src/features/personal/movement-entry';

/**
 * La edición del importe, tecla a tecla.
 *
 * Se prueba el REDUCTOR y no la pantalla: el campo de texto es sólo un
 * capturador de teclado —invisible y sin cursor—, así que todo lo que puede
 * salir mal vive aquí y se puede ejecutar.
 *
 * `escribir` reproduce lo que hace el campo: entrega la cadena canónica
 * anterior con el carácter añadido al final, que es lo único que la persona
 * puede hacer sin cursor. `borrar` entrega una cadena más corta.
 */

const EUR = 2;

function escribir(entry: AmountEntry, teclas: string, scale = EUR): AmountEntry {
  let out = entry;
  for (const tecla of teclas) {
    out = applyAmountInput(out, amountValue(out) + tecla, scale);
  }
  return out;
}

function borrar(entry: AmountEntry, scale = EUR): AmountEntry {
  return applyAmountInput(entry, amountValue(entry).slice(0, -1), scale);
}

function visto(entry: AmountEntry, scale = EUR): string {
  const { whole, fraction } = amountParts(entry, scale);
  return fraction === '' ? whole : `${whole},${fraction}`;
}

describe('escribir la parte entera', () => {
  it('el estado inicial es una cantidad, no un hueco', () => {
    expect(visto(EMPTY_AMOUNT)).toBe('0,00');
    expect(amountTouched(EMPTY_AMOUNT)).toBe(false);
  });

  /** Los casos exactos del contrato, uno por uno. */
  it('los dígitos sustituyen al cero inicial en vez de acumularse detrás', () => {
    expect(visto(escribir(EMPTY_AMOUNT, '5'))).toBe('5,00');
    expect(visto(escribir(EMPTY_AMOUNT, '53'))).toBe('53,00');
    expect(visto(escribir(EMPTY_AMOUNT, '538'))).toBe('538,00');
  });

  it('y nunca aparece un cero a la izquierda', () => {
    expect(visto(escribir(EMPTY_AMOUNT, '05'))).toBe('5,00');
    expect(visto(escribir(EMPTY_AMOUNT, '0005'))).toBe('5,00');
  });

  it('los céntimos siguen a cero mientras no se pulse el separador', () => {
    expect(visto(escribir(EMPTY_AMOUNT, '538'))).toBe('538,00');
    expect(amountComplete(escribir(EMPTY_AMOUNT, '538'), EUR)).toBe(false);
  });
});

describe('pasar a los céntimos', () => {
  it('el separador no cambia la cifra, sólo a dónde va lo siguiente', () => {
    expect(visto(escribir(EMPTY_AMOUNT, '53'))).toBe('53,00');
    expect(visto(escribir(EMPTY_AMOUNT, '53,'))).toBe('53,00');
  });

  it('el primer dígito decimal ocupa el primer céntimo', () => {
    expect(visto(escribir(EMPTY_AMOUNT, '53,4'))).toBe('53,40');
  });

  it('y el segundo lo termina', () => {
    expect(visto(escribir(EMPTY_AMOUNT, '53,49'))).toBe('53,49');
  });

  it('los ejemplos del contrato, tal cual', () => {
    expect(visto(escribir(EMPTY_AMOUNT, ',53'))).toBe('0,53');
    expect(visto(escribir(EMPTY_AMOUNT, '0,01'))).toBe('0,01');
    expect(visto(escribir(EMPTY_AMOUNT, '12,75'))).toBe('12,75');
    expect(visto(escribir(EMPTY_AMOUNT, '125,49'))).toBe('125,49');
  });

  it('un punto vale como separador, venga del teclado que venga', () => {
    expect(visto(escribir(EMPTY_AMOUNT, '53.49'))).toBe('53,49');
  });

  it('un segundo separador no abre un tercer grupo', () => {
    expect(visto(escribir(EMPTY_AMOUNT, '1,2,3'))).toBe('1,23');
  });

  it('y no entra un tercer decimal', () => {
    expect(visto(escribir(EMPTY_AMOUNT, '1,234'))).toBe('1,23');
  });
});

describe('cuándo se cierra el teclado', () => {
  /** Sólo al COMPLETAR los céntimos, que es lo único que termina la cantidad. */
  it('escribiendo enteros no se cierra nunca', () => {
    for (const teclas of ['5', '53', '538', '1234567']) {
      expect(amountComplete(escribir(EMPTY_AMOUNT, teclas), EUR), teclas).toBe(false);
    }
  });

  it('con un solo céntimo tampoco', () => {
    expect(amountComplete(escribir(EMPTY_AMOUNT, '53,4'), EUR)).toBe(false);
  });

  it('con los dos, sí', () => {
    expect(amountComplete(escribir(EMPTY_AMOUNT, '53,49'), EUR)).toBe(true);
    expect(amountComplete(escribir(EMPTY_AMOUNT, ',53'), EUR)).toBe(true);
    expect(amountComplete(escribir(EMPTY_AMOUNT, '0,01'), EUR)).toBe(true);
  });

  /**
   * **Generalizado por escala.** En una moneda sin decimales no hay céntimos
   * que completar, así que no hay momento en que la cantidad se dé por
   * terminada — y cerrar el teclado mientras se escribe una cifra entera sería
   * lo contrario de lo pedido.
   */
  it('en una moneda sin decimales no se cierra jamás', () => {
    const yen = escribir(EMPTY_AMOUNT, '1200', 0);
    expect(visto(yen, 0)).toBe('1200');
    expect(amountComplete(yen, 0)).toBe(false);
  });

  it('y el separador ni siquiera entra en esa moneda', () => {
    expect(visto(escribir(EMPTY_AMOUNT, '12,5', 0), 0)).toBe('125');
  });

  /** Con tres decimales hacen falta tres para terminar, no dos. */
  it('con escala tres hacen falta los tres', () => {
    expect(amountComplete(escribir(EMPTY_AMOUNT, '1,23', 3), 3)).toBe(false);
    expect(amountComplete(escribir(EMPTY_AMOUNT, '1,234', 3), 3)).toBe(true);
    expect(visto(escribir(EMPTY_AMOUNT, '1,234', 3), 3)).toBe('1,234');
  });
});

describe('borrar', () => {
  it('se come los céntimos escritos, de uno en uno', () => {
    let e = escribir(EMPTY_AMOUNT, '12,53');
    expect(visto(e)).toBe('12,53');
    e = borrar(e);
    expect(visto(e)).toBe('12,50');
    e = borrar(e);
    expect(visto(e)).toBe('12,00');
  });

  /**
   * Y sin céntimos, la pulsación sale de la parte decimal Y se come un entero.
   * Si sólo saliera, la cifra visible no cambiaría y el botón parecería roto.
   */
  it('y luego vuelve a la parte entera, sin una pulsación muerta', () => {
    let e = escribir(EMPTY_AMOUNT, '12,53');
    e = borrar(borrar(e));
    expect(visto(e)).toBe('12,00');
    e = borrar(e);
    expect(visto(e)).toBe('1,00');
    e = borrar(e);
    expect(visto(e)).toBe('0,00');
  });

  it('borrar sobre una cantidad vacía no rompe nada', () => {
    expect(visto(borrar(borrar(EMPTY_AMOUNT)))).toBe('0,00');
    expect(amountValue(EMPTY_AMOUNT)).toBe('');
  });

  it('nunca se ve un estado que no sea una cantidad', () => {
    let e = escribir(EMPTY_AMOUNT, '12,53');
    for (let i = 0; i < 8; i += 1) {
      expect(visto(e)).toMatch(/^\d+,\d{2}$/);
      e = borrar(e);
    }
  });
});

describe('lo que no se acepta', () => {
  it('letras y signos se ignoran en silencio', () => {
    expect(visto(escribir(EMPTY_AMOUNT, '1a2b'))).toBe('12,00');
    // El signo lo pone la clase de movimiento, no quien escribe.
    expect(visto(escribir(EMPTY_AMOUNT, '-50'))).toBe('50,00');
    expect(visto(escribir(EMPTY_AMOUNT, '+50'))).toBe('50,00');
  });

  /**
   * **Sobre un campo VACÍO no hay pegado que distinguir.** Toda cadena empieza
   * por la cadena vacía, así que el reductor no puede saber si llegó de golpe o
   * tecleada, y la lee como pulsaciones: el primer separador abre los céntimos
   * y lo que sobra no entra. Es lo mismo que se obtiene tecleándolo, así que no
   * hay incoherencia — sólo un límite de lo que el evento del campo informa.
   */
  it('sobre vacío se lee como si se hubiera tecleado', () => {
    expect(visto(applyAmountInput(EMPTY_AMOUNT, '1.234,567 EUR', EUR))).toBe('1,23');
    expect(visto(applyAmountInput(EMPTY_AMOUNT, 'nada', EUR))).toBe('0,00');
  });

  /**
   * Sustituyendo lo que había sí se relee entero, y ahí manda el ÚLTIMO
   * separador: en  el punto agrupa millares y la coma separa
   * decimales; en  es al revés. Los decimales son siempre el grupo
   * final, así que el último acierta en las dos convenciones.
   */
  it('sustituyendo lo escrito se relee, y el último separador es el decimal', () => {
    const cinco = escribir(EMPTY_AMOUNT, '5');
    expect(visto(applyAmountInput(cinco, '1.234,56', EUR))).toBe('1234,56');
    expect(visto(applyAmountInput(cinco, '1,234.56', EUR))).toBe('1234,56');
    expect(visto(applyAmountInput(cinco, '9.999', EUR))).toBe('9,99');
  });
});

describe('la precisión monetaria no se toca', () => {
  /**
   * El reductor produce la MISMA cadena canónica de siempre, y quien la pasa a
   * unidades mínimas sigue siendo `toMinorUnits`, sobre texto y `bigint`.
   */
  it('la cadena canónica sigue convirtiéndose exactamente', () => {
    for (const [teclas, minor] of [
      ['53,49', 5349n],
      [',53', 53n],
      ['0,01', 1n],
      ['538', 53800n],
      ['12,70', 1270n],
    ] as const) {
      expect(toMinorUnits(amountValue(escribir(EMPTY_AMOUNT, teclas)), EUR), teclas).toBe(minor);
    }
  });

  /** El caso que un `parseFloat` estropea: 0,29 sale 28.999… al multiplicar. */
  it('y el céntimo que el coma flotante pierde sigue exacto', () => {
    expect(toMinorUnits(amountValue(escribir(EMPTY_AMOUNT, '0,29')), EUR)).toBe(29n);
    expect(toMinorUnits(amountValue(escribir(EMPTY_AMOUNT, '90071992547409,91')), EUR)).toBe(
      9007199254740991n,
    );
  });

  it('la cantidad vacía no es cero: no hay importe todavía', () => {
    expect(toMinorUnits(amountValue(EMPTY_AMOUNT), EUR)).toBeNull();
  });
});

describe('backspaceAmount es la regla, no un efecto de la cadena', () => {
  it('se puede llamar directamente y hace lo mismo', () => {
    const doce = escribir(EMPTY_AMOUNT, '12,53');
    expect(visto(backspaceAmount(doce))).toBe('12,50');
  });
});

/**
 * El color dice EN QUÉ PUNTO va la edición, no si el campo tiene foco.
 *
 * La cifra se lee siempre entera —`5,00` y no `5`—, así que sin distinguir
 * tonos no habría forma de saber si esos ceros los escribió la persona o están
 * ahí para completar la forma. Un `5,00` todo encendido afirma que hay cero
 * céntimos puestos a mano, y no los hay.
 *
 * Se prueba sobre `amountTones`, que deriva los tres del MISMO estado del
 * editor: no hay un segundo indicador de presentación que pueda quedarse
 * desincronizado, y por eso borrar recupera los tonos sin código propio.
 */
describe('qué parte de la cifra ya es suya', () => {
  /** Cómo se leería la cifra: mayúscula lo encendido, minúscula lo pendiente. */
  function leido(entry: AmountEntry, scale = EUR): string {
    const { whole, fraction } = amountParts(entry, scale);
    const t = amountTones(entry);
    // Lo pendiente va entre corchetes: un dígito no tiene mayúscula.
    const pieza = (texto: string, tone: 'entered' | 'pending') =>
      tone === 'entered' ? texto : `[${texto}]`;

    return fraction === ''
      ? pieza(whole, t.whole)
      : pieza(whole, t.whole) + pieza(',', t.separator) + pieza(fraction, t.fraction);
  }

  it('sin escribir nada, la cifra entera está pendiente', () => {
    expect(leido(EMPTY_AMOUNT)).toBe('[0][,][00]');
  });

  it('con enteros, sólo el entero se enciende', () => {
    expect(leido(escribir(EMPTY_AMOUNT, '5'))).toBe('5[,][00]');
    expect(leido(escribir(EMPTY_AMOUNT, '53'))).toBe('53[,][00]');
  });

  /** La coma encendida es lo que dice «ahora van los céntimos», sin cursor. */
  it('al pulsar la coma se enciende ella, y los céntimos siguen pendientes', () => {
    expect(leido(escribir(EMPTY_AMOUNT, '53,'))).toBe('53,[00]');
  });

  it('y desde cero, el propio cero se enciende con ella', () => {
    expect(leido(escribir(EMPTY_AMOUNT, ','))).toBe('0,[00]');
  });

  /**
   * Con el PRIMER decimal se encienden LOS DOS. Dejar el segundo cero apagado
   * en `53,40` lo leería como un hueco, cuando lo que queda es una cantidad
   * terminada a la que todavía se le puede añadir un dígito.
   */
  it('el primer céntimo enciende la fracción entera', () => {
    expect(leido(escribir(EMPTY_AMOUNT, '53,4'))).toBe('53,40');
  });

  it('y el segundo no cambia nada del color', () => {
    expect(leido(escribir(EMPTY_AMOUNT, '53,49'))).toBe('53,49');
  });

  it('la secuencia completa del contrato, paso a paso', () => {
    let e = EMPTY_AMOUNT;
    expect(leido(e)).toBe('[0][,][00]');
    e = escribir(e, '5');
    expect(leido(e)).toBe('5[,][00]');
    e = escribir(e, ',');
    expect(leido(e)).toBe('5,[00]');
    e = escribir(e, '3');
    expect(leido(e)).toBe('5,30');
    e = escribir(e, '7');
    expect(leido(e)).toBe('5,37');
    expect(amountComplete(e, EUR)).toBe(true);
  });

  it('y la que empieza por la coma', () => {
    let e = escribir(EMPTY_AMOUNT, ',');
    expect(leido(e)).toBe('0,[00]');
    e = escribir(e, '5');
    expect(leido(e)).toBe('0,50');
    e = escribir(e, '3');
    expect(leido(e)).toBe('0,53');
    expect(amountComplete(e, EUR)).toBe(true);
  });

  /**
   * **Borrar recupera los tonos porque no hay tonos que recuperar**: los tres
   * se derivan del estado, así que una fracción no se queda encendida por haber
   * estado activa antes.
   */
  it('borrar devuelve los tonos al estado real del editor', () => {
    let e = escribir(EMPTY_AMOUNT, '5,37');
    expect(leido(e)).toBe('5,37');
    e = borrar(e);
    expect(leido(e)).toBe('5,30');
    e = borrar(e);
    // Sin céntimos escritos vuelven a estar pendientes, pero la coma sigue
    // encendida: se sigue dentro de la parte decimal.
    expect(leido(e)).toBe('5,[00]');
    e = borrar(e);
    // Y esta pulsación sale de la parte decimal y se come el entero.
    expect(leido(e)).toBe('[0][,][00]');
  });

  it('nunca queda una fracción encendida sin dígitos escritos', () => {
    let e = escribir(EMPTY_AMOUNT, '12,53');
    for (let i = 0; i < 8; i += 1) {
      const tones = amountTones(e);
      if (tones.fraction === 'entered') expect(e.fraction.length).toBeGreaterThan(0);
      e = borrar(e);
    }
  });

  /** En una moneda sin decimales no hay fracción que encender. */
  it('sin decimales sólo hay una pieza', () => {
    expect(leido(escribir(EMPTY_AMOUNT, '1200', 0), 0)).toBe('1200');
  });
});

/**
 * EMPEZAR SOBRE UN EDITOR VACÍO, que es lo que hace «Editar disponible».
 *
 * Allí el Disponible actual se enseña como referencia apagada y **no es el
 * valor del campo**: el borrador arranca vacío. Estas pruebas fijan lo que eso
 * significa para el parser — que es exactamente lo mismo que en un alta, y ése
 * es el punto: no hay un segundo comportamiento.
 */
describe('empezar sobre un editor vacío', () => {
  const scale = 2;

  /** La primera cifra escribe una cantidad nueva. No hay nada a lo que añadir. */
  it('la primera cifra empieza la cantidad', () => {
    const uno = applyAmountInput(EMPTY_AMOUNT, '5', scale);
    expect(amountParts(uno, scale)).toEqual({ whole: '5', fraction: '00' });
  });

  /** Y la siguiente continúa por la izquierda, como siempre. */
  it('las siguientes continúan la parte entera', () => {
    let entry = applyAmountInput(EMPTY_AMOUNT, '5', scale);
    entry = applyAmountInput(entry, amountValue(entry) + '0', scale);
    entry = applyAmountInput(entry, amountValue(entry) + '0', scale);
    expect(amountParts(entry, scale)).toEqual({ whole: '500', fraction: '00' });
  });

  /**
   * **La coma como primera tecla entra en decimales sobre cero**, que es la
   * semántica que el editor ya tenía. No se inventa ninguna otra.
   */
  it('la coma como primera tecla abre los decimales sobre cero', () => {
    let entry = applyAmountInput(EMPTY_AMOUNT, ',', scale);
    expect(amountParts(entry, scale)).toEqual({ whole: '0', fraction: '00' });
    expect(entry.inFraction).toBe(true);

    entry = applyAmountInput(entry, amountValue(entry) + '5', scale);
    expect(amountParts(entry, scale)).toEqual({ whole: '0', fraction: '50' });

    entry = applyAmountInput(entry, amountValue(entry) + '3', scale);
    expect(amountParts(entry, scale)).toEqual({ whole: '0', fraction: '53' });
  });

  /**
   * **Y el borrado sobre un editor vacío no hace nada**, que es lo que hace
   * imposible que toque la referencia: no es que se proteja, es que no hay
   * nada que borrar.
   */
  it('el borrado sobre un editor vacío lo deja igual', () => {
    expect(applyAmountInput(EMPTY_AMOUNT, '', scale)).toEqual(EMPTY_AMOUNT);
    expect(amountTouched(applyAmountInput(EMPTY_AMOUNT, '', scale))).toBe(false);
  });

  /** Un editor vacío no está tocado; con la coma ya sí. */
  it('la coma cuenta como haber empezado', () => {
    expect(amountTouched(EMPTY_AMOUNT)).toBe(false);
    expect(amountTouched(applyAmountInput(EMPTY_AMOUNT, ',', scale))).toBe(true);
  });
});

/**
 * UN IMPORTE PRECARGADO SE PUEDE SEGUIR ESCRIBIENDO.
 *
 * Aquí estaba el segundo fallo de la ventana de corregir, y no en el campo ni
 * en el teclado: `amountEntryFromMinor` siembra la cifra vigente con los
 * céntimos COMPLETOS y `inFraction: true`, que es justo el estado saturado que
 * `pushDigit` rechaza —«el tercer decimal no entra»—. Cada tecla devolvía el
 * MISMO objeto, `setEntry` no cambiaba nada, el campo controlado volvía a su
 * texto anterior y la cifra se quedaba clavada. El campo tenía foco y el
 * teclado estaba abierto: parecía roto sin estarlo.
 *
 * Las otras dos ventanas no lo veían porque arrancan de `EMPTY_AMOUNT`, que no
 * está saturado — la misma asimetría de siempre entre la que falla y las que no.
 *
 * La regla del tercer decimal NO cambia: sigue rechazando el tercero cuando la
 * persona ha escrito los dos. Lo que cambia es que un importe **precargado y
 * todavía sin tocar** se comporta como una selección completa: la primera cifra
 * lo sustituye.
 */
describe('un importe precargado se puede volver a escribir', () => {
  const cargado = amountEntryFromMinor('4280', EUR);

  it('se precarga entero y se lee tal cual', () => {
    expect(visto(cargado)).toBe('42,80');
    expect(amountValue(cargado)).toBe('42.80');
  });

  it('la primera cifra lo sustituye en vez de rebotar', () => {
    const tras = escribir(cargado, '5');
    expect(visto(tras)).toBe('5,00');
    expect(tras).not.toEqual(cargado);
  });

  it('y a partir de ahí se escribe como cualquier otro', () => {
    expect(visto(escribir(cargado, '512,34'))).toBe('512,34');
  });

  it('borrar sigue quitando un céntimo, no la cifra entera', () => {
    expect(visto(borrar(cargado))).toBe('42,80');
    expect(amountValue(borrar(cargado))).toBe('42.8');
  });

  it('y después de borrar ya no sustituye: la persona ya está escribiendo', () => {
    expect(visto(escribir(borrar(cargado), '5'))).toBe('42,85');
  });

  it('la regla del tercer decimal sigue en pie para lo tecleado', () => {
    expect(visto(escribir(EMPTY_AMOUNT, '12,539'))).toBe('12,53');
  });
});
