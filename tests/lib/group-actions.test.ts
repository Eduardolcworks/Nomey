import { describe, expect, it, vi } from 'vitest';

import { Glass, GlassAndroid } from '../../src/ui/theme/elevation';
import {
  DESCRIPTION_LINES,
  GROUP_ACTIONS,
  groupActionHandler,
  SHEET_RATIO,
  sheetHeight,
} from '../../src/features/groups/group-actions';

/**
 * Las dos acciones del `+` de Grupos.
 *
 * **Comportamiento, no lectura de fuente.** El orden y el reparto de
 * manejadores viven en datos y en una función precisamente para poder
 * interrogarlos: sin renderer de React, la alternativa habría sido buscar
 * cadenas en el JSX, y eso falla cuando alguien reescribe una línea sin cambiar
 * nada.
 *
 * El cruce de manejadores es el fallo que esto existe para impedir: con dos
 * `onPress` escritos a mano, intercambiarlos es un error de una línea y las dos
 * tarjetas seguirían pulsándose, cada una haciendo lo de la otra.
 */

describe('las dos acciones de Grupos', () => {
  it('son exactamente dos, en el orden acordado', () => {
    expect(GROUP_ACTIONS.map((action) => action.key)).toEqual(['create', 'join']);
  });

  it('cada una con su icono, y no comparten ninguno', () => {
    // El `+` es el de la acción principal y el QR el de unirse. Compartirlos
    // borraría la única diferencia visual entre las dos tarjetas.
    expect(GROUP_ACTIONS.map((action) => action.symbol)).toEqual(['add', 'qr']);
    expect(new Set(GROUP_ACTIONS.map((a) => a.symbol)).size).toBe(GROUP_ACTIONS.length);
  });

  it('cada una con su cadena, y no comparten ninguna', () => {
    expect(GROUP_ACTIONS.map((action) => action.labelKey)).toEqual([
      'groups.createGroup',
      'groups.joinGroup',
    ]);
    const claves = new Set(GROUP_ACTIONS.map((action) => action.labelKey));
    expect(claves.size).toBe(GROUP_ACTIONS.length);
  });

  it('cada una con su descripción, y ninguna repite la del título', () => {
    // La descripción es además la indicación accesible de la tarjeta: si
    // repitiera el título, el lector de pantalla diría dos veces lo mismo.
    expect(GROUP_ACTIONS.map((action) => action.descriptionKey)).toEqual([
      'groups.createGroupDescription',
      'groups.joinGroupDescription',
    ]);
    const claves = new Set(GROUP_ACTIONS.map((action) => action.descriptionKey));
    expect(claves.size).toBe(GROUP_ACTIONS.length);
    for (const action of GROUP_ACTIONS) {
      expect(action.descriptionKey).not.toBe(action.labelKey);
    }
  });

  it('una opción NO puede disparar la de la otra', () => {
    const create = vi.fn();
    const join = vi.fn();

    groupActionHandler('create', { create, join })();
    expect(create).toHaveBeenCalledTimes(1);
    expect(join).not.toHaveBeenCalled();

    groupActionHandler('join', { create, join })();
    expect(join).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('y el reparto es total: cada clave declarada tiene su manejador', () => {
    // Si mañana se añade una tercera acción, esto falla hasta que se reparta.
    const llamadas: string[] = [];
    for (const action of GROUP_ACTIONS) {
      groupActionHandler(action.key, {
        create: () => llamadas.push('create'),
        join: () => llamadas.push('join'),
      })();
    }
    expect(llamadas).toEqual(['create', 'join']);
  });
});

describe('el alto de la hoja', () => {
  it('ronda el 30 % de la pantalla', () => {
    expect(sheetHeight(2400)).toBe(720);
    expect(SHEET_RATIO).toBe(0.3);
  });

  it('se queda dentro de la banda acordada en cualquier pantalla', () => {
    // Una hoja de alto fijo ocupa media pantalla en un teléfono pequeño y una
    // franja en una tableta; el porcentaje la hace adaptable y la banda impide
    // que en una pantalla muy alargada quede apretada o nadando.
    for (const alto of [1280, 1920, 2400, 2960, 3200]) {
      const h = sheetHeight(alto);
      expect(h / alto).toBeGreaterThanOrEqual(0.28);
      expect(h / alto).toBeLessThanOrEqual(0.32);
    }
  });

  it('crece con la pantalla, y devuelve píxeles enteros', () => {
    expect(sheetHeight(2400)).toBeGreaterThan(sheetHeight(1920));
    expect(Number.isInteger(sheetHeight(2401))).toBe(true);
  });
});

/**
 * EL HUECO RESERVADO A LA DESCRIPCIÓN.
 *
 * Es un dato y no un número dentro del componente porque decide una propiedad
 * que se ve: con el mismo hueco en las dos tarjetas los bloques miden igual,
 * y por eso los títulos se alinean entre sí y las descripciones también. Con
 * cada bloque ajustado a su contenido, la frase larga salta de línea, la corta
 * no, y los dos títulos quedan a alturas distintas.
 */
describe('el hueco de la descripción', () => {
  it('reserva sitio para las dos líneas que necesita la cadena más larga', () => {
    expect(DESCRIPTION_LINES).toBe(2);
  });

  it('y nunca es una sola: una sola línea es no reservar nada', () => {
    // Con una, el hueco vuelve a depender del contenido y la alineación entre
    // las dos tarjetas se pierde en cuanto una cadena crece.
    expect(DESCRIPTION_LINES).toBeGreaterThanOrEqual(2);
  });
});

describe('el emblema lila es el mismo cristal que el del `+`', () => {
  it('mismas alfas y mismos radios: cambia el tono, no la construcción', () => {
    /*
     * Dos emblemas que se leen como la misma pieza en dos colores sólo lo hacen
     * si comparten geometría y pesos. Si alguien retoca una alfa «para que se
     * vea mejor» el lila, dejan de ser la misma pieza y esto lo dice.
     */
    const alfa = (color: string) => Number(/,\s*([\d.]+)\)$/.exec(color)?.[1]);

    expect(alfa(Glass.join.border)).toBe(alfa(Glass.action.border));
    expect(alfa(Glass.join.highlight)).toBe(alfa(Glass.action.highlight));
    expect(alfa(Glass.join.tint)).toBe(alfa(Glass.action.tint));

    const accion = Glass.action.lens ?? [];
    const unirse = Glass.join.lens ?? [];
    expect(unirse).toHaveLength(accion.length);
    for (const [i, capa] of unirse.entries()) {
      expect(capa.offsetY).toBe(accion[i].offsetY);
      expect(capa.blurRadius).toBe(accion[i].blurRadius);
      expect(capa.inset ?? false).toBe(accion[i].inset ?? false);
      expect(alfa(String(capa.color))).toBe(alfa(String(accion[i].color)));
    }
  });

  it('y sí cambia el tono: ninguno de sus colores es el del ámbar', () => {
    expect(Glass.join.border).not.toBe(Glass.action.border);
    expect(Glass.join.tint).not.toBe(Glass.action.tint);
  });

  it('Android recalibra los dos igual, o ninguno', () => {
    // Si `action` necesita corrección en Android, `join` la necesita idéntica:
    // es el mismo material.
    const a = GlassAndroid.action ?? {};
    const j = GlassAndroid.join ?? {};
    expect(Object.keys(j).sort()).toEqual(Object.keys(a).sort());
  });
});

/**
 * LA LENTE SE PARTE EN DOS, Y SÓLO SE QUITA UNA MITAD.
 *
 * El halo exterior de estos dos materiales es lo que hace que el `+` del dock
 * lea como luz sostenida sobre el negro, y ahí está aprobado. Dentro de una
 * tarjeta no hay fondo del que separarse: el resplandor se derrama sobre el
 * relleno y el disco deja de leerse como una pieza.
 *
 * `lens="inner"` no reescribe ningún valor ni recorta el círculo: filtra la
 * lista que ya existe con el mismo corte que `castsShadow` aplica a la del
 * estado. Lo que se interroga aquí es que ese corte deje algo a los dos lados
 * —si no, o no habría halo que quitar, o quitarlo se llevaría por delante el
 * brillo interior y el volumen— y que ámbar y lila se partan por el mismo sitio.
 */
describe('el corte de la lente', () => {
  /*
   * El MISMO predicado que `outerHalf` / `innerHalf`, escrito aquí porque
   * `ui/theme/depth.ts` importa `Platform` en ejecución y no se puede montar
   * sin React Native — que es justamente por lo que `elevation.ts` es dato puro.
   * Que la implementación use el filtro compartido y no una regla nueva se fija
   * por fuente en `tests/infra/groups-add-selector.test.ts`.
   */
  const haciaFuera = (capa: { inset?: boolean }) => capa.inset !== true;

  const lentes = [
    ['iOS · action', Glass.action.lens ?? []],
    ['iOS · join', Glass.join.lens ?? []],
    ['Android · action', GlassAndroid.action?.lens ?? []],
    ['Android · join', GlassAndroid.join?.lens ?? []],
  ] as const;

  it.each(lentes)('%s: hay halo que quitar Y brillo que conservar', (_nombre, lente) => {
    expect(lente.filter(haciaFuera).length).toBeGreaterThan(0);
    expect(lente.filter((capa) => !haciaFuera(capa)).length).toBeGreaterThan(0);
  });

  it('ámbar y lila se parten por el mismo sitio, en las dos plataformas', () => {
    // Ésta es la equivalencia que sí debe mantenerse: el tono cambia, el reparto
    // de capas no. Si un día alguien le quitara el halo sólo a uno, los dos
    // emblemas dejarían de ser la misma pieza en dos colores.
    const fuera = (lente: readonly { inset?: boolean }[]) => lente.filter(haciaFuera).length;
    expect(fuera(Glass.join.lens ?? [])).toBe(fuera(Glass.action.lens ?? []));
    expect(fuera(GlassAndroid.join?.lens ?? [])).toBe(fuera(GlassAndroid.action?.lens ?? []));
  });
});
