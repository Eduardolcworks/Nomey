# ADR-008 — Frontera de datos exactos

- **Estado:** Aceptado
- **Fecha:** 2026-08-24

## Contexto

[ADR-003](ADR-003-money-representation.md) §6 fijó la garantía: **ningún importe
monetario ni tipo de cambio cruza JSON como número**, y añadió que la regla es
la garantía, **no un mecanismo** — cuál la produce se decidiría al diseñar el
esquema. Este ADR elige ese mecanismo.

El problema tiene tres representaciones y solo la última rompe:

| Dónde                             | Qué pasa                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------- |
| **Valor exacto en PostgreSQL**    | `BIGINT` y `NUMERIC` guardan y devuelven el valor exacto, con su escala declarada |
| **Representación JSON del cable** | PostgREST emite un **número JSON** cuyos bytes son correctos                      |
| **Tipo recibido en JavaScript**   | `JSON.parse` lo convierte a `number`, exacto solo hasta 2⁵³                       |

> **La degradación no la produce PostgreSQL ni PostgREST: la produce
> `JSON.parse`.** Es silenciosa, sin error y con HTTP 200. Con `NUMERIC` se
> pierde además la escala declarada.

Medido en **E11** —evidencia en [`supabase/e11/`](../../supabase/e11/README.md),
resultado normativo en ADR-003 §10—, que además demostró que **lo determinante
es el cast a texto, no el camino de acceso**: un RPC que devuelve `bigint` sin
castear falla igual que una tabla.

**La dirección de escritura es distinta y se olvida.** La midió **E14**,
evidencia en [`supabase/e14/`](../../supabase/e14/README.md):

- Un parámetro SQL `text` **acepta un número JSON y lo coacciona a texto**.
  PostgREST conserva exactamente los dígitos recibidos, pero **no exige** que el
  tipo JSON original fuese `string`.
- La degradación ocurre **dentro del cliente**:
  `JSON.stringify({ v: 9007199254740993 })` emite `{"v":9007199254740992}`. El
  servidor recibiría una cadena perfectamente exacta **del valor equivocado**.
- Con un payload `jsonb`, `jsonb_typeof` **sí distingue** `string` de `number`
  sobre los mismos bytes.

[ADR-006](ADR-006-privilege-model.md) §5 ya fijó que las lecturas del cliente
atraviesan vistas de `api` declaradas `security_invoker`, con la RLS de `core`
como autoridad por fila. Este ADR **se apoya en ese camino y no lo sustituye**.

## Decisión

### 1. Lectura

El camino normativo es:

```
core (tipo exacto)  →  api security_invoker view  →  representación textual
                    →  JSON string  →  cliente / domain
```

Para **cualquier valor exacto susceptible de degradarse en JavaScript**
—`BIGINT`, `NUMERIC`, importes, coeficientes exactos y equivalentes—, la
superficie `api` **expone texto, nunca un número JSON**.

### 2. Invariante estructural de la superficie cliente

> **Ninguna columna `int8` ni `numeric` de la superficie cliente `api` puede
> quedar expuesta directamente.**

Si un valor de esos tipos debe salir, **se transforma explícitamente a texto en
la superficie**, o se proyecta mediante otra representación segura aprobada.

**Deberá existir un test de catálogo que haga fallar CI si se viola.** Es una
comprobación por consulta, no por revisión visual.

Esto **no** afecta a tipos discretos seguros —escalas pequeñas, banderas,
enumerados, contadores acotados—, que no están en riesgo de degradación y no
necesitan tratamiento textual.

### 3. Escritura

**No se adopta la regla «todos los parámetros SQL serán `text`».** E14 demostró
que un parámetro `text` **no conserva información sobre el tipo JSON original**,
porque PostgREST coacciona los números. Tiparlo como `text` sigue siendo
preferible a tiparlo `bigint` —no invita a enviar un número— pero **no es una
garantía**, y presentarlo como tal sería falso.

La norma es esta:

> **Todo valor exacto procedente del cliente cruza JSON como `string`, y la
> frontera autoritativa debe poder comprobar que su tipo JSON original era
> `string` antes de convertirlo al tipo SQL exacto.**

Después de esa comprobación, y en este orden: **validar forma**, **validar
rango**, y **convertir** a `BIGINT`, `NUMERIC` u otro tipo exacto.

> **El mecanismo concreto que observa y rechaza el tipo JSON incorrecto
> pertenece a D7.** E14 demostró que `jsonb_typeof` **podría** hacerlo; este ADR
> **no decide** que la frontera de escritura deba usar `jsonb`. Convertir esa
> evidencia en decisión sería exactamente el error que ADR-005 §4 advierte.

Una consecuencia que conviene enunciar: la validación de forma por expresión
regular es **necesaria pero insuficiente por sí sola**, porque
`"9007199254740992"` supera cualquier regex — ya viene degradado.

### 4. Tipo de cambio

La representación de frontera se alinea con el dominio existente:

- **`coefficient`** cruza como **JSON `string`**;
- **`scale`** cruza como **entero discreto y acotado**.

**No se introduce un decimal canónico como segundo contrato de transporte**, y
**no se añade ningún constructor nuevo al dominio** para acomodar la API.

Es compatible con ADR-003, que en su §4 define conceptualmente el tipo de cambio
**mediante coeficiente entero y escala decimal**, y cuyo §6 aclara que «la
escala interna es un detalle de representación». El invariante 11 se cumple: el
coeficiente cruza como cadena; la escala **no es el tipo de cambio**, es un
exponente, igual que la escala de una definición monetaria.

Coincide además con el contrato que ya existe en `tests/vectors/`.

### 5. Identidad de la definición monetaria

`CurrencyDefinitionId` es un `UUID` ([ADR-004](ADR-004-currency-definition-identity.md)),
que cruza JSON de forma natural como `string`. **No necesita cast textual
adicional ni tratamiento monetario especial.** No es una excepción a la regla:
sencillamente no está en riesgo.

### 6. Filtrado, ordenación y agregación

**No se decide que Nomey no pueda filtrar ni ordenar por importe.** Esa
limitación no se adopta.

> **El cliente no realiza comparaciones numéricas directamente sobre las
> representaciones textuales expuestas, ni depende de la semántica lexicográfica
> de PostgREST sobre ellas.**

Filtrar, ordenar y agregar por importe **siguen permitidos**, y ocurren:

1. **numéricamente dentro del servidor**, sobre los tipos exactos;
2. **antes** de la serialización;
3. exponiendo después el resultado exacto mediante la representación segura.

La API concreta que lo permita pertenece a fases posteriores.

### 7. Tipos generados

Los tipos de Supabase se generan sobre la superficie **`api`**, no sobre `core`.

El objetivo es estructural: como en `api` no existe ningún `int8` ni `numeric`
alcanzable (§2), **los campos exactos expuestos aparecen como `string` y no
puede aparecer un `number` engañoso** para un importe.

**Los tipos generados siguen sin ser una frontera de seguridad por sí solos**
—ADR-003 lo dice y no cambia—, pero dejan de ser una trampa.
**`src/types/database.ts` no se edita a mano bajo ninguna circunstancia.**

## Alternativas consideradas

**A · Vistas con `::text` para leer, y nada más.**

Cubre la lectura, que es la mitad medida por E11, y encaja sin fricción con el
camino de ADR-006. **Descartada como solución completa** porque no dice nada de
la escritura, que es la dirección donde el fallo es más difícil de detectar: un
importe degradado entra como un valor plausible y queda persistido exacto.

**B · RPC para todo**, lectura y escritura, devolviendo `json` o `text`
construidos dentro de la función.

Es coherente y concentra el cast en un solo tipo de objeto. **Descartada** por
una razón de encaje, no de corrección: **sustituiría el camino de lectura ya
aprobado** en ADR-006 §5 —vistas `security_invoker` con la RLS de `core` como
autoridad— y volvería a poner la autorización dentro de cada función, que es
justo el modo de fallo abierto que ADR-006 descartó tras medirlo en E13.

**C · Adaptador de cliente que reserializa lo recibido.**

**Descartada como mecanismo único, y el motivo es concluyente:** cuando el
adaptador recibe el objeto, el `JSON.parse` de la respuesta **ya ocurrió**. No
hay nada que recuperar. Un adaptador solo funciona si el valor le llega ya como
cadena. **Es complemento, nunca sustituto.**

**D · Parámetros `text` como garantía de escritura.**

Era la recomendación del análisis previo a E14. **Descartada como garantía**
—que no como práctica— por la medición: PostgREST coacciona los números a texto,
así que un parámetro `text` no distingue un cliente correcto de uno que ya
degradó el valor. Se conserva la forma, se retira la afirmación de que basta.

## Consecuencias

### A favor

- **Una regla enunciable en una línea y comprobable por catálogo**: en `api` no
  hay `int8` ni `numeric` alcanzable.
- **No depende de que nadie recuerde castear**: si la tabla no es alcanzable, no
  existe camino sin cast.
- **Cubre las dos direcciones**, y nombra explícitamente la que se olvida.
- **Los tipos generados dejan de mentir** sobre los importes.
- El contrato del tipo de cambio **coincide con el dominio y con los vectores**,
  sin código nuevo ni segundo formato.

### En contra

- **Cada columna monetaria se escribe dos veces**: una en la tabla, otra en la
  superficie que la proyecta.
- **Filtrar y ordenar por importe deja de ser gratuito**: hay que ofrecer una
  API de servidor que lo haga numéricamente, y esa API todavía no existe. Es
  trabajo desplazado, no funcionalidad perdida.
- **La garantía de escritura no queda cerrada aquí.** ADR-008 fija la
  obligación; sin el mecanismo de D7, la obligación no está implementada. Es
  deliberado, pero significa que **D6 por sí solo no protege la escritura**.
- **La forma de escritura conocida hoy exige un payload estructurado o
  equivalente**, lo que condiciona —sin decidirla— la firma de las funciones de
  D7.

## Fuera de alcance

Pertenecen a **D7** y **no quedan resueltos ni prejuzgados**:

- la **forma real del payload** de escritura;
- **cómo se comprueba el tipo JSON original**;
- las **funciones autoritativas**, su firma y su ejecución;
- **autenticación y autorización** de la escritura;
- la **validación semántica** completa;
- la **atomicidad** y la derivación de efectos;
- los **errores** y su relación con la **idempotencia**.

**ADR-008 fija únicamente el contrato exacto de transporte.**
