# ADR-004 — Identidad física de la definición monetaria

- **Estado:** Aceptado
- **Fecha:** 2026-08-23

## Contexto

[ADR-003](ADR-003-money-representation.md) §3 ya decidió lo esencial: cada
definición monetaria usada por hechos financieros tiene una **identidad interna
estable e inmutable**, y esa identidad **no es el código ISO 4217**, que es un
atributo visible de la definición. De ahí se sigue la regla de agregación —dos
importes solo se suman si comparten definición monetaria— y la inmutabilidad del
significado monetario de un hecho histórico.

[`data-model.md`](../architecture/data-model.md) §10 añadió una regla en la otra
dirección: **una identidad estable identifica una única definición coherente**.
Dos valores que digan tener la misma identidad y se contradigan en escala o en
código no son definiciones distintas, son un dato corrupto, y operar con ellos
es inválido.

El dominio, implementado en la Fase 3.B, la trata como **opaca**:

```ts
export type CurrencyDefinitionId = Brand<string, 'CurrencyDefinitionId'>;
```

`src/domain/money/currency-definition.ts` lo dice sin ambigüedad: la identidad se
transporta y se compara, **nunca se interpreta**, y no implica UUID, ni entero,
ni el código ISO.

**Lo único pendiente era su representación física en PostgreSQL**, y ADR-003 lo
dejó explícitamente fuera de alcance: «el identificador concreto de una
definición monetaria» pertenece al diseño del esquema. Ese diseño es la Fase
3.C, y esta decisión es su primera pieza.

**Por qué merece un ADR propio.** La identidad aparecerá en la clave primaria del
catálogo y en una clave foránea de **cada fila que contenga dinero**: importes
originales, importes derivados por ámbito, tipos de cambio y participaciones.
Cambiarla después no es alterar una columna: es tocar todas esas tablas y todas
esas claves foráneas. Es la decisión de **peor reversibilidad** de la Fase 3.C, y
por eso se decide antes de escribir la primera migración.

## Decisión

**La identidad física persistida de una definición monetaria es un `UUID` fijo y
sembrado.**

### 1. Tipo y origen del valor

- En PostgreSQL, la columna de identidad es de tipo **`UUID`**.
- Los `UUID` del catálogo son **fijos y están versionados en seeds y fixtures**.
  No se generan en el momento de instalar cada entorno.
- **La misma definición monetaria tiene el mismo `UUID` en local, en CI y en
  producción.** Que un entorno asigne un valor distinto a la misma definición es
  un defecto, no una variación admisible.

### 2. El identificador no significa nada

- **El `UUID` no tiene semántica de negocio.**
- **No se parsea**, ni se usa para inferir código, escala, versión ni ningún otro
  metadato.
- `code`, `scale` y los demás atributos de la definición **permanecen separados
  de la identidad** y son las columnas que se consultan cuando se necesita el
  código ISO o la escala.

### 3. Lo que esta decisión no cambia

- **El dominio no se entera.** `CurrencyDefinitionId` sigue siendo
  `Brand<string>` opaco. Esta es una decisión de **persistencia**; `src/domain/`
  no gana ninguna capacidad de interpretar el identificador y no debe ganarla.
- **Sigue vigente la regla de coherencia** de `data-model.md` §10: una misma
  identidad no puede corresponder a metadatos monetarios contradictorios.
- ADR-003 §3 sigue gobernando qué es una definición monetaria y cuándo dos
  importes son agregables. Este ADR solo fija con qué tipo se escribe su
  identidad.

### 4. Vectores de prueba

`tests/vectors/` es la fuente única de expectativas y hoy usa identidades
textuales legibles (`cd-eur-1`, `cd-eur-0`, `cd-jpy-1`).

> **La futura adaptación de los vectores deberá usar `UUID` fijos y
> reproducibles como fixtures**, insertados literalmente tanto en la
> implementación de referencia como en la autoritativa.

**No se introduce una capa dinámica de traducción** entre identidades de vector e
identidades de servidor. Una traducción en el arnés es precisamente donde una
divergencia entre las dos implementaciones puede esconderse sin que ningún test
la vea, que es lo contrario de lo que los vectores existen para conseguir
(ADR-002 §7).

**Los vectores no se modifican con este ADR.** Cuándo y cómo se adaptan pertenece
al diseño del arnés de pruebas contra servidor.

## Alternativas consideradas

**A · `TEXT` opaco asignado por Nomey**, del estilo `cd-eur-1`, con un `CHECK` de
forma y un vector trampa cuyo identificador no se pareciera a su código.

Fue la **recomendación del análisis de la Fase 3.C**, y su argumento era real:
los vectores compartidos ya llevan identidades textuales, de modo que el arnés
podría insertarlas literalmente sin traducir nada.

**Descartada** porque resuelve el problema de la traducción a costa de crear
otro: un identificador legible **invita a ser interpretado**. La única defensa
posible era un test que reventara si alguien lo parseaba — una mitigación, no una
imposibilidad. El argumento de los vectores no exige identificadores legibles:
exige identificadores **fijos y reproducibles**, y un `UUID` sembrado lo es
igual.

**B · Entero de secuencia**, `SMALLINT` o `INTEGER`.

Es la opción de menor huella —2 o 4 bytes frente a 16— y la que elegiría por
defecto quien mire solo el catálogo, que tendrá menos de doscientas filas.

**Descartada** por dos motivos. Para ser reproducible entre entornos habría que
fijar los enteros literalmente en el seed y renunciar a la secuencia como fuente
de verdad; sin eso, `dev` y `prod` asignan identidades distintas a la misma
moneda y los vectores dejan de ser comparables. Y **cruza la frontera hacia el
cliente como número JSON**, lo que obliga a explicar por qué ese número sí y los
importes no. Numéricamente es seguro —un `smallint` es exacto en un `number` de
JavaScript—, pero diluye una regla que gana valor por ser absoluta.

**C · El código ISO como identidad.**

**Descartada por ADR-003**, que es su alternativa C: en los tres casos reales
—redenominación, continuidad con código distinto, y dos definiciones del mismo
código creadas al corregir una errata propia— Nomey sumaría importes no
homogéneos y mostraría un total falso sin avisar. No se reabre aquí.

**D · Clave natural versionada**, del estilo `EUR@1`.

Cumple la letra de ADR-003 —la identidad no es solo el código— pero **invita a
parsearse**: `split('@')[0]` reintroduce el código ISO como identidad en el
primer sitio donde a alguien le resulte cómodo, y el fallo resultante es
silencioso. Es exactamente el modo de fallo contra el que existe ADR-003.
**Descartada.**

**E · Clave compuesta `(code, version)`.**

**Descartada**: mete el código ISO dentro de la clave foránea de cada fila con
dinero, que es precisamente lo que ADR-003 §3 impide que sea la identidad. Es la
alternativa C con una columna más y con el doble de coste estructural en cada
join.

## Consecuencias

### A favor

- **Máxima opacidad.** No hay nada que parsear, así que no hay nada que alguien
  pueda parsear por comodidad. La defensa deja de descansar en un test.
- **Formato estándar de PostgreSQL** para claves primarias y foráneas, con
  soporte nativo, tipo dedicado e índices bien entendidos.
- **Tamaño fijo**, 16 bytes, sin cabecera varlena ni dependencia de la longitud
  del valor.
- **Cruza la frontera hacia JavaScript como `string`**, sin cast y sin excepción
  a la regla de ADR-003 §6.
- **Evita identificadores semánticos** y, con ellos, la reintroducción encubierta
  del código ISO como identidad.
- **Se alinea de forma natural con el contrato opaco del dominio**: el tipo
  físico y el tipo de dominio dicen lo mismo.

### En contra

- **Peor legibilidad al depurar** que un identificador textual descriptivo. Una
  consulta de saldos con varios `UUID` distintos no se lee de un vistazo, y esa
  fricción se paga a diario durante el resto de la Fase 3.
- **16 bytes por identidad**, en cada fila que contenga dinero. Frente a un
  `BIGINT` de importe y sus timestamps el peso relativo es pequeño, pero es real.
- **Cambiar después la identidad física sería una migración amplia**: columna
  nueva, backfill, intercambio de claves foráneas en todas las tablas
  monetarias. Existe el camino, pero es una operación de esquema completa.
- **Obliga a sembrar.** Un `UUID` generado por defecto sería más cómodo y
  rompería la reproducibilidad entre entornos; la comodidad queda expresamente
  descartada y hay que sostener el seed.

## Fuera de alcance

No quedan resueltos ni prejuzgados por este ADR:

- **La forma del catálogo de definiciones monetarias**: qué columnas tiene, cómo
  se versiona y de dónde salen sus filas.
- **Cómo se representa la identidad al cruzar la frontera de lectura** —vista,
  función o adaptador—, que pertenece al mecanismo de la frontera textual.
- **El schema donde vive el catálogo**, que fija
  [ADR-005](ADR-005-schema-topology.md).
- **El momento y la forma de adaptar `tests/vectors/`**, más allá de la
  restricción de §4.
