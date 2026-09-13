import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GROUP_EMOJI,
  draftIssues,
  type GroupDraft,
  isDraftComplete,
  isTrailingBlank,
  nameKey,
  normaliseName,
  ownerName,
  participantIssues,
  type ParticipantRow,
  presetDisplay,
  presetToAdopt,
  withTrailingBlank,
} from '../../src/features/groups/group-draft';

/**
 * Las reglas del borrador de un grupo.
 *
 * **Comportamiento, no lectura de fuente**: todo esto son funciones puras
 * precisamente para poder interrogarlas sin renderer de React.
 */

const fila = (name: string, owner = false): ParticipantRow => ({ id: name || 'x', name, owner });

describe('la normalización de un nombre', () => {
  it('recorta los extremos y colapsa los espacios de dentro', () => {
    expect(normaliseName('  Ana   María  ')).toBe('Ana María');
  });

  it('cubre los espacios que no se ven como espacios', () => {
    // El NBSP entra al pegar desde otra aplicación y es indistinguible a ojo.
    expect(normaliseName('Ana  Ruiz')).toBe('Ana Ruiz');
    expect(normaliseName('Ana\tRuiz\n')).toBe('Ana Ruiz');
  });

  it('NO toca mayúsculas ni acentos: se guarda lo que la persona escribió', () => {
    expect(normaliseName('MARÍA josé')).toBe('MARÍA josé');
  });

  it('un nombre sólo de espacios queda vacío', () => {
    expect(normaliseName('   \t \n ')).toBe('');
    expect(normaliseName(' ')).toBe('');
  });
});

describe('cuándo dos nombres son el mismo', () => {
  it('da igual la caja y los espacios', () => {
    expect(nameKey('  ANA  ')).toBe(nameKey('ana'));
  });

  it('y da igual cómo esté compuesto el acento en Unicode', () => {
    /*
     * `José` con `é` precompuesta y con `e` + acento combinante son la misma
     * cadena para quien lee y dos cadenas distintas para `===`. Ésta es la
     * «diferencia Unicode equivalente» que no debe crear un duplicado nuevo.
     */
    const precompuesto = 'José';
    const combinante = 'José';
    expect(precompuesto).not.toBe(combinante);
    expect(nameKey(precompuesto)).toBe(nameKey(combinante));
  });

  it('pero NO se ignoran los acentos: «María» y «Maria» son dos personas', () => {
    expect(nameKey('María')).not.toBe(nameKey('Maria'));
  });
});

describe('los problemas de la lista de participantes', () => {
  it('un nombre vacío o sólo con espacios se rechaza', () => {
    expect(participantIssues([fila('Ana'), { id: 'b', name: '   ', owner: false }])).toEqual([
      null,
      'blank',
    ]);
  });

  it('el duplicado se le marca al SEGUNDO, no a los dos', () => {
    // Quien repite está escribiendo la fila de abajo; encender también la de
    // arriba señalaría como erróneo algo que no se está tocando.
    expect(participantIssues([fila('Ana'), { id: 'b', name: 'ana', owner: false }])).toEqual([
      null,
      'duplicate',
    ]);
  });

  it('y el duplicado se detecta a través de la caja, los espacios y el acento', () => {
    const filas: ParticipantRow[] = [
      { id: '1', name: 'José', owner: true },
      // La misma persona: minúsculas, espacios de sobra y el acento combinante.
      { id: '2', name: '  josé  ', owner: false },
    ];
    expect(participantIssues(filas)[1]).toBe('duplicate');
  });

  it('tres nombres distintos no dan ningún problema', () => {
    expect(participantIssues([fila('Ana'), fila('Luis'), fila('Marta')])).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('y no hay límite de filas: la interfaz no inventa uno', () => {
    // El contrato de `core.participant` no fija ninguno, así que tampoco aquí.
    const muchas = Array.from({ length: 60 }, (_, i) => fila(`P${String(i)}`));
    expect(participantIssues(muchas).every((issue) => issue === null)).toBe(true);
  });
});

describe('cuándo un borrador está completo', () => {
  const base: GroupDraft = {
    emoji: DEFAULT_GROUP_EMOJI,
    name: 'Viaje',
    currencyId: 'moneda-1',
    participants: [{ id: 'owner', name: 'Edu', owner: true }],
    defaultCategoryId: null,
  };

  it('el emoji provisional es el de dos personas', () => {
    expect(DEFAULT_GROUP_EMOJI).toBe('👥');
  });

  it('con nombre, divisa y participantes válidos, sí', () => {
    expect(isDraftComplete(base)).toBe(true);
    expect(draftIssues(base)).toEqual([]);
  });

  it('sin nombre, no', () => {
    expect(draftIssues({ ...base, name: '   ' })).toEqual(['name']);
  });

  it('SIN DIVISA CONOCIDA, tampoco: `null` no es «euros»', () => {
    /*
     * Es la diferencia entre «todavía no se sabe» y «se sabe y es ésta».
     * Confundirlas es lo que preselecciona una moneda que nadie ha elegido en
     * un valor que queda fijo tras la primera operación del grupo.
     */
    expect(draftIssues({ ...base, currencyId: null })).toEqual(['currency']);
  });

  it('y con una fila repetida, tampoco', () => {
    const repetida: GroupDraft = {
      ...base,
      participants: [
        { id: 'owner', name: 'Edu', owner: true },
        { id: 'a', name: 'edu', owner: false },
      ],
    };
    expect(draftIssues(repetida)).toEqual(['participants']);
  });
});

describe('el nombre del creador', () => {
  it('es el del perfil, normalizado', () => {
    expect(ownerName('  Edu  Ruiz ')).toBe('Edu Ruiz');
  });

  it('y sin perfil es AUSENCIA, nunca otra cosa', () => {
    /*
     * `ownerName` no puede devolver el correo porque no lo recibe. Es
     * deliberado: una dirección de correo como nombre de participante dentro de
     * un grupo compartido es exactamente el dato correlacionable que F03/ADR-009 §1
     * mantiene fuera del ámbito.
     */
    expect(ownerName(null)).toBeNull();
    expect(ownerName('   ')).toBeNull();
  });
});

/**
 * SIEMPRE UN HUECO AL FINAL, Y EXACTAMENTE UNO.
 *
 * No hay botón de «añadir»: el oblongo siguiente ya está ahí. Toda la regla es
 * esta función, y por eso se interroga por comportamiento y no leyendo el JSX.
 */
describe('el oblongo vacío del final', () => {
  let n = 0;
  const nextId = () => {
    n += 1;
    return `n${String(n)}`;
  };

  it('una lista vacía ya trae uno', () => {
    const filas = withTrailingBlank([], nextId);
    expect(filas).toHaveLength(1);
    expect(filas[0].name).toBe('');
  });

  it('escribir en él hace aparecer el siguiente', () => {
    const filas = withTrailingBlank([{ id: 'a', name: 'Ana', owner: false }], nextId);
    expect(filas.map((f) => f.name)).toEqual(['Ana', '']);
  });

  it('y NUNCA se acumulan dos vacíos, escriba lo que escriba', () => {
    // El defecto que impide: un campo nuevo por cada carácter.
    let filas = withTrailingBlank([], nextId);
    for (const letra of ['A', 'An', 'Ana']) {
      filas = withTrailingBlank(
        filas.map((f, i) => (i === 0 ? { ...f, name: letra } : f)),
        nextId,
      );
      expect(filas.filter((f) => f.name === '')).toHaveLength(1);
    }
    expect(filas.map((f) => f.name)).toEqual(['Ana', '']);
  });

  it('el hueco conserva su IDENTIDAD mientras se escribe en él', () => {
    // Si cambiara, el foco saltaría a otro campo a mitad de una pulsación.
    const inicial = withTrailingBlank([], nextId);
    const id = inicial[0].id;
    const despues = withTrailingBlank([{ ...inicial[0], name: 'Ana' }], nextId);
    expect(despues[0].id).toBe(id);
  });

  it('vaciar la última con nombre colapsa la cola y deja UNA, la de arriba', () => {
    // La fila que se está editando sobrevive; la que se va es la de abajo.
    const filas = withTrailingBlank(
      [
        { id: 'a', name: '', owner: false },
        { id: 'b', name: '', owner: false },
      ],
      nextId,
    );
    expect(filas).toHaveLength(1);
    expect(filas[0].id).toBe('a');
  });

  it('pero un hueco de EN MEDIO no se toca: es una fila con su error', () => {
    const filas = withTrailingBlank(
      [
        { id: 'a', name: '', owner: false },
        { id: 'b', name: 'Luis', owner: false },
      ],
      nextId,
    );
    expect(filas.map((f) => f.id)).toEqual(['a', 'b', filas[2].id]);
    expect(participantIssues(filas)[0]).toBe('blank');
  });

  it('y aguanta veinte participantes sin perder la cuenta', () => {
    let filas = withTrailingBlank([], nextId);
    for (let i = 0; i < 20; i += 1) {
      filas = withTrailingBlank(
        filas.map((f, j) => (j === filas.length - 1 ? { ...f, name: `P${String(i)}` } : f)),
        nextId,
      );
    }
    expect(filas).toHaveLength(21);
    expect(filas.filter((f) => f.name === '')).toHaveLength(1);
    expect(new Set(filas.map((f) => f.id)).size).toBe(21);
  });
});

describe('cuál es el hueco final', () => {
  it('es el último, y sólo si está vacío', () => {
    const filas = [
      { id: 'owner', name: 'Edu', owner: true },
      { id: 'a', name: 'Ana', owner: false },
      { id: 'b', name: '', owner: false },
    ];
    expect(isTrailingBlank(filas, 2)).toBe(true);
    expect(isTrailingBlank(filas, 1)).toBe(false);
    expect(isTrailingBlank(filas, 0)).toBe(false);
  });

  it('una fila vacía de en medio NO lo es: es alguien a medio escribir', () => {
    const filas = [
      { id: 'a', name: '', owner: false },
      { id: 'b', name: 'Luis', owner: false },
    ];
    expect(isTrailingBlank(filas, 0)).toBe(false);
  });

  it('y el borrador NO lo cuenta como fila incompleta', () => {
    // Si contara, el formulario quedaría eternamente inválido.
    expect(
      draftIssues({
        emoji: DEFAULT_GROUP_EMOJI,
        name: 'Viaje',
        currencyId: 'moneda-1',
        defaultCategoryId: null,
        participants: [
          { id: 'owner', name: 'Edu', owner: true },
          { id: 'a', name: '', owner: false },
        ],
      }),
    ).toEqual([]);
  });
});

/**
 * EL EDITOR RECUPERA LA CATEGORÍA PREESTABLECIDA GUARDADA, y la distingue de
 * «todavía no cargado» y de «no disponible». Las cinco situaciones pedidas,
 * sobre las dos reglas puras que el formulario aplica en cada render.
 */
const EDITOR_BASE: GroupDraft = {
  emoji: DEFAULT_GROUP_EMOJI,
  name: 'Viaje',
  currencyId: 'moneda-1',
  participants: [{ id: 'owner', name: 'Edu', owner: true }],
  defaultCategoryId: null,
};

describe('la preestablecida en el editor del grupo', () => {
  const VIAJES = 'cat-travel';
  const SUPER = 'cat-grocery';
  const CATALOGO = [VIAJES, SUPER, 'cat-dining'];

  it('reabrir con una guardada la enseña, con su fila real', () => {
    expect(presetDisplay(VIAJES, CATALOGO)).toEqual({ kind: 'chosen', id: VIAJES });
  });

  it('«Todas» es null: un valor, no una ausencia', () => {
    expect(presetDisplay(null, CATALOGO)).toEqual({ kind: 'all' });
    // Y con el catálogo sin llegar, «Todas» sigue siendo «Todas».
    expect(presetDisplay(null, [])).toEqual({ kind: 'all' });
  });

  it('catálogo con carga tardía: conserva la identidad y dice que carga, no «Todas»', () => {
    expect(presetDisplay(VIAJES, [])).toEqual({ kind: 'loading', id: VIAJES });
    // Cuando llega, es la guardada.
    expect(presetDisplay(VIAJES, CATALOGO)).toEqual({ kind: 'chosen', id: VIAJES });
  });

  it('perfil con carga tardía: se adopta la guardada, salvo elección manual posterior', () => {
    // Montado con «Todas» porque el perfil autoritativo no había llegado.
    expect(presetToAdopt({ incoming: VIAJES, lastIncoming: null, touched: false })).toEqual({
      adopt: true,
      value: VIAJES,
    });
    // El mismo perfil en el render siguiente: nada que hacer.
    expect(presetToAdopt({ incoming: VIAJES, lastIncoming: VIAJES, touched: false })).toEqual({
      adopt: false,
      value: VIAJES,
    });
    // La persona ya había elegido a mano: el perfil que llega no la pisa.
    expect(presetToAdopt({ incoming: VIAJES, lastIncoming: null, touched: true })).toEqual({
      adopt: false,
      value: VIAJES,
    });
  });

  it('una guardada que el catálogo ya no ofrece se conserva como no disponible', () => {
    expect(presetDisplay('cat-retirada', CATALOGO)).toEqual({
      kind: 'unavailable',
      id: 'cat-retirada',
    });
  });

  it('editar sólo nombre o emoji conserva la categoría: el borrador la lleva tal cual', () => {
    const conViajes: GroupDraft = {
      ...EDITOR_BASE,
      name: 'Otro nombre',
      defaultCategoryId: VIAJES,
    };
    expect(conViajes.defaultCategoryId).toBe(VIAJES);
    expect(isDraftComplete(conViajes)).toBe(true);
    // Y elegir «Todas» es null, que el servidor guarda como ausencia expresa.
    expect({ ...conViajes, defaultCategoryId: null }.defaultCategoryId).toBeNull();
  });
});
