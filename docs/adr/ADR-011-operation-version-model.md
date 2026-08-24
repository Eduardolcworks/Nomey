# ADR-011 — Modelo físico de operaciones, versiones y comandos cliente

- **Estado:** Aceptado
- **Fecha:** 2026-08-24

## Contexto

[ADR-002](ADR-002-accounting-model.md) §6 y
[`data-model.md`](../architecture/data-model.md) §7 fijan que **los hechos son
inmutables**, que **corregir crea una versión nueva** que sustituye a la
anterior sin mutarla, y que **saldos y estadísticas se derivan de la versión
vigente**. Lo que faltaba era cómo se representa eso físicamente.

[ADR-009](ADR-009-authoritative-write-boundary.md) fijó la frontera de escritura
—funciones por clase, payload `jsonb`, writer de mínimo privilegio sometido a
RLS, transacción única— y [ADR-010](ADR-010-client-operation-idempotency.md) la
idempotencia del origen cliente, con unicidad
`(created_by, client_operation_id)` **transversal a todas las clases**. Ambos
**delegaron aquí** la forma física.

**El experimento E17** midió los detalles que quedaban abiertos: el ciclo entre
operación y versión, las restricciones de linaje, la reclamación del comando
antes de que exista su resultado, y cómo representa el catálogo las políticas
aplicables a `PUBLIC`. Evidencia en
[`supabase/e17/`](../../supabase/e17/README.md).

## Decisión

### 1. `core.operation` — identidad estable

Representa la **identidad del concepto contable**, y **una sola tabla sirve a
todas las clases de operación**.

Propiedades conceptuales: `operation_id` estable · clase de operación ·
atribución · fecha de creación · `current_version_id`.

**La fila es estable.** En el camino normal **solo puede cambiar el mecanismo
que selecciona la versión vigente**.

> **La clave de idempotencia del cliente NO vive aquí**, y esto corrige
> expresamente la propuesta inicial del análisis. El motivo está en §5.

### 2. `core.operation_version` — la unidad histórica

Cada corrección **conserva la misma operación**, **crea una versión nueva** y
**crea efectos nuevos**; **no modifica la versión anterior** ni **elimina
efectos históricos**.

Propiedades conceptuales: `id` · `operation_id` · `version_no >= 1` ·
`supersedes_version_id` · atribución · instante de creación · **los datos
autoritativos resueltos que pertenecen a esa versión**.

> **Este ADR no decide que esos datos vivan en una única columna
> `resolved_state jsonb`.** Su representación física —columnas tipadas, tablas
> relacionadas, JSONB o una combinación— **la decide D11**. Aquí se fija
> únicamente que **la versión es la unidad histórica a la que pertenecen**.

### 3. `core.effect` — efectos por versión

Los efectos **pertenecen a una versión concreta**. Una corrección genera efectos
nuevos para la versión nueva, **conserva** los de las anteriores, **no genera
efectos de reversión** solo por corregir, y **no modifica** los históricos.

Qué efectos son **económicamente vigentes** depende de la versión que seleccione
`operation.current_version_id`.

> **Traspaso obligatorio a D11.** Debe existir una **superficie o proyección
> canónica de efectos económicamente vigentes**, de modo que las consultas
> normales **no tengan que reimplementar a mano el filtro por versión vigente**.
> Olvidarlo suma efectos históricos y actuales y produce cifras infladas que no
> fallan: es el modo de fallo silencioso más probable de este modelo.

### 4. Creación atómica de operación y versión

**UUID pregenerados más una clave foránea compuesta y diferible:**

```
(operation.id, operation.current_version_id)
    → operation_version (operation_id, id)     DEFERRABLE INITIALLY DEFERRED
```

Así `current_version_id` puede ser **`NOT NULL` desde el primer `INSERT`**, la
operación puede insertarse apuntando a una V1 que se creará dentro de la misma
transacción, y **al commit esa versión debe existir y pertenecer a esa misma
operación**.

Medido en E17: **A1** commit correcto · **A2**, sin crear V1, falla `23503` ·
**A3**, apuntando a la versión de otra operación, falla `23503` — **la misma
restricción cubre los dos fallos**, por ser compuesta.

**No se adopta el modelo con columna nullable**, que dejaría el estado
inconsistente representable de forma permanente. PostgreSQL no permite diferir
`NOT NULL`, así que esa variante no puede validar el invariante al commit.

### 5. `core.client_command` — la unidad de idempotencia

**La unidad de idempotencia es el comando cliente, no la operación contable.**

Existe una tabla separada para los **comandos cliente aceptados**, que conserva:
actor · `client_operation_id` · `command_type` · `command_contract_version` ·
`canonical_intent` · `result_operation_id` · `result_version_id` · fecha de
aceptación.

**Unicidad:** `UNIQUE (created_by, client_operation_id)`, **transversal a todas
las clases cliente**. **Nunca se incluye `command_type` en esa unicidad**, que
es lo que ADR-010 prohíbe expresamente.

**Por qué la clave no puede vivir en la operación:**

```
K1 → crear A      → V1
K2 → corregir A   → V2
K3 → corregir A   → V3
```

Son **tres comandos distintos**, cada uno sujeto a ADR-010, y **A es una sola
operación**. Con la clave en `operation` habría una única casilla: o se
sobrescribe —y K1 pierde su idempotencia— o K2 y K3 no la tienen. La segunda no
es inocua: un reintento tardío de K2, tras una corrección posterior de otra
persona, **revertiría esa corrección en silencio**.

Los tres comandos apuntan a **la misma operación** y a **versiones distintas**.

**Restricción del resultado**, también compuesta y diferible:

```
(result_operation_id, result_version_id)
    → operation_version (operation_id, id)
```

Impide que un comando declare como resultado la operación A y una versión que
pertenece a B.

### 6. Solo comandos aceptados

`client_command` **participa en la misma transacción autoritativa que su
resultado**. Medido en E17: comando reclamado más operación aceptada, ambos
confirman · comando reclamado más fallo posterior, **ambos revierten** · el
primer competidor confirma, el segundo espera y **hace replay** · el primer
competidor revierte, **el segundo puede reclamar la clave**.

> **Solo se persisten comandos aceptados.** Esta tabla **no es un registro de
> intentos rechazados**.

### 7. `client_command` es INSERT-only

Con los identificadores del resultado pregenerados, el comando **se inserta una
sola vez y ya completo**. En el camino normal: el writer tiene **`INSERT`**, no
`UPDATE`, no `DELETE`, y **la fila es inmutable una vez aceptado el comando**.

La clave foránea diferible es lo que permite referenciar un resultado que
todavía no existe físicamente pero **debe existir al commit**.

### 8. `canonical_intent`

Es **la intención enviada por el cliente, canonicalizada exclusivamente por el
servidor**. Es **distinta del estado autoritativo resuelto**, y sirve para la
idempotencia, la auditoría del comando y determinar la igualdad de reintentos.

La canonicalización **materializa los defaults semánticos** · trata ausente y
`null` como equivalentes **solo cuando el contrato diga que lo son** ·
**conserva el orden cuando el orden significa algo** —`data-model.md` §5 guarda
el orden estable de participantes con la operación— · **no degrada ni reformatea
los valores exactos** · y **nunca la calcula el cliente**.

### 9. Versión del contrato de canonicalización

Se adopta una columna explícita, **`command_contract_version`**. **No se
codifica la versión dentro de `command_type`.**

`command_type` representa **la clase** del comando. Meter la versión dentro haría
que subir el contrato convirtiera `record_group_expense` en otro valor, y **el
replay de un comando antiguo se leería como una clase distinta** — el conflicto
que ADR-010 §3 reserva para otra cosa.

> **Invariante:** cada `client_command` determina **inequívocamente** las reglas
> de canonicalización bajo las que fue aceptado. El replay de un comando antiguo
> se interpreta **según ese contrato**, no con los defaults actuales.

No se diseña aquí un marco completo de versionado de API.

### 10. Sin hash en v1

**No se almacena huella ni hash adicional.**

El índice `(created_by, client_operation_id)` **ya reduce la comparación a una
única fila**; después solo hay que comparar una intención canonicalizada contra
otra. Un hash **no aporta corrección**, **no hace falta para buscar**, duplica
la representación y **reduce la capacidad de diagnóstico**: no dice qué cambió.

Puede reconsiderarse con evidencia futura de necesidad de rendimiento. **El
cliente nunca calcula hashes**, en ninguna variante.

### 11. Restricciones de linaje

Todas verificadas en E17:

| Invariante                                | Mecanismo                                                    |
| ----------------------------------------- | ------------------------------------------------------------ |
| Numeración válida                         | `CHECK (version_no >= 1)`                                    |
| Sin duplicados                            | `UNIQUE (operation_id, version_no)`                          |
| V1 sin predecesor, V>1 con predecesor     | `CHECK ((version_no = 1) = (supersedes_version_id IS NULL))` |
| Sin autorreferencia                       | `CHECK (supersedes_version_id <> id)` cuando exista          |
| Predecesor de la **misma** operación      | FK compuesta `(operation_id, supersedes_version_id)`         |
| Versión vigente de la **misma** operación | FK compuesta `(id, current_version_id)`                      |

> **Estas restricciones no pueden garantizar por sí solas que
> `supersedes_version_id` sea exactamente la versión que estaba vigente
> inmediatamente antes.** Una V4 podría superseder a V2 sin violar ninguna. **Ese
> invariante pertenece a la frontera autoritativa** (§12), y no se intenta
> simularlo con una restricción imposible.

### 12. Correcciones concurrentes

Una corrección de cliente incluye conceptualmente **`expected_version_id`**.

Para un comando **nuevo**: localizar y serializar la operación · comprobar que
`current_version_id == expected_version_id` · si no coincide, **conflicto
estable** · crear versión y efectos · mover el puntero.

La serialización puede materializarse con `SELECT ... FOR UPDATE` o con un
compare-and-swap equivalente; la sintaxis puede esperar a la implementación.
**Preferencia conceptual: el CAS sobre `current_version_id`**, porque integra el
bloqueo y la comprobación en una sola operación y no se puede olvidar la mitad.

`UNIQUE (operation_id, version_no)` actúa como **backstop estructural**.

> **No se usa la restricción como único control de concurrencia.** Solo detecta
> la carrera simultánea, **no la edición obsoleta secuencial**: una corrección
> basada en una versión vieja que llegue _después_ de que otra confirmara
> calcularía el siguiente `version_no` sin chocar con nada, y sobrescribiría en
> silencio. Eso es «último escritor gana», y no se acepta.

### 13. El replay se resuelve antes que la concurrencia optimista

Orden invariante:

1. autenticar el actor;
2. reclamar o localizar `(created_by, client_operation_id)`;
3. si existe con **la misma clase** y **la misma intención según su contrato** →
   **replay**;
4. si existe y no coincide → **conflicto**;
5. **solo si es un comando nuevo**: autorización actual, comprobación de
   `expected_version_id`, derivación y persistencia.

Sin este orden, el replay legítimo de K2 —tras existir ya V3— fallaría como
edición obsoleta, el cliente concluiría que su corrección no se aplicó, y podría
generar una intención nueva. Es justo el duplicado que ADR-010 existe para
impedir.

### 14. Inmutabilidad

> **Las correcciones nunca modifican ni eliminan versiones ni efectos
> históricos, y los caminos normales de la aplicación no reciben capacidad de
> modificarlos ni de borrarlos.**

El writer: **sin `UPDATE` ni `DELETE`** sobre versiones ni efectos · **`UPDATE`
únicamente del mecanismo que selecciona la versión vigente** en `operation`,
**idealmente mediante `GRANT` por columna**.

**No se fija que nunca pueda existir ningún borrado administrativo.** Quedan
**fuera de este ADR**: retención, eliminación de cuenta, requisitos legales y
purga administrativa expresamente autorizada. Un trigger de respaldo puede
proteger los caminos privilegiados, pero **la política definitiva de purga no se
decide aquí**.

### 15. Políticas RLS

Semántica exacta, que corrige una imprecisión del análisis:

> **Las políticas permisivas se combinan mediante `OR` entre aquellas
> aplicables al rol actual.** Una política `TO authenticated` **no** se suma
> automáticamente a una `TO <writer>`.

E17 midió además que una política creada **sin `TO`** y otra creada **`TO
PUBLIC`** se representan **igual** en el catálogo: `polroles = {0}`. La sintaxis
original **no es recuperable**.

**Regla normativa:**

> **Ninguna política de `core` puede ser aplicable a `PUBLIC`, salvo excepción
> explícita, justificada y documentada.**

El test comprueba **semántica efectiva**, no sintaxis:

```sql
select polname from pg_policy where polrelid in (…tablas de core…)
 and 0 = any(polroles);
```

Se usa `0 = ANY(polroles)` y no la igualdad exacta con `{0}` porque expresa el
invariante —`PUBLIC` está entre los roles aplicables— sin depender de cómo el
motor represente hoy esa lista. Medido: PostgreSQL **colapsa** `TO public, otro`
a `{0}` con un aviso, de modo que hoy ambas formulaciones coinciden; se prefiere
la que lo es **por construcción** y no por casualidad.

Los tests y la configuración deben comprobar además que **el writer no sea
miembro accidental** de roles cuyas políticas no debería heredar. E17 midió que
un rol con sus atributos **no es miembro de `authenticated`**, pero tiene
`rolinherit = true`, así que heredaría los de cualquier rol del que sí se le
hiciera miembro.

**No se adopta `RESTRICTIVE`**: hoy no existe un invariante que lo justifique
frente a las claves foráneas, los `CHECK` y las políticas dirigidas a roles
concretos.

### 16. Deuda pendiente

**No se resuelve aquí.** Se conserva el invariante que midió E15:

> **La comprobación y el consumo de la deuda pendiente deben serializarse
> atómicamente.**

El mecanismo espera a **D11**, porque depende de si existe una fila de deuda
materializada o si la deuda se deriva de los efectos.

## Alternativas consideradas

**A · Una fila mutable por operación.** La más simple de consultar.
**Descartada por ADR-002 §6**, que prohíbe mutar los hechos. No es una
alternativa viva; se recoge por contraste.

**B · Sin tabla de operación**, con la identidad como `operation_group_id`
repetido en cada versión. Ahorra una tabla. **Descartada** porque replica
`created_by` y la identidad en cada fila, y **la unicidad de la clave de
idempotencia se volvería una restricción parcial y frágil**: la segunda versión
de una corrección chocaría con su propia clave.

**C · Log de eventos y proyección.** Historial completo por construcción.
**Descartada por desproporción**, la misma razón por la que ADR-002 descartó el
libro mayor de partida doble.

**D · Bandera `is_current` en la versión**, con índice único parcial, en lugar
del puntero. **Descartada** porque obligaría a **mutar una fila de la tabla de
hechos inmutables** en cada corrección, que es exactamente lo que este modelo
quiere hacer imposible.

**E · Temporalidad `valid_from` / `valid_to`.** Correcta si hiciera falta
consultar «cómo se veía el mundo el martes». **Descartada**: `data-model.md` §7
pide diferenciar versiones y derivar de la vigente, no consultar el pasado como
si fuera presente. Añade rangos, exclusiones y un modo de fallo nuevo
—solapamientos— por una capacidad que el producto no ha pedido.

**F · Clave de idempotencia en `operation_version`** en lugar de una tabla
propia. Funciona y evita una tabla. **Descartada** porque mete columnas de
transporte en la tabla de hechos contables inmutables, y porque las versiones
originadas por recurrencias, importaciones o backend —que ADR-010 deja
abiertas— tendrían esas columnas a `NULL`: campos que solo significan algo para
algunas filas, el patrón que ADR-002 rechazó al descartar la transacción única
con discriminador.

**G · `current_version_id` nullable durante la transacción**, en vez de UUID
pregenerados. Evita las claves diferibles. **Descartada**: PostgreSQL no permite
diferir `NOT NULL`, así que **el estado inconsistente quedaría representable de
forma permanente** y ninguna restricción lo detectaría al commit.

**H · Versión del contrato codificada en `command_type`.** Evita una columna.
**Descartada** por su efecto concreto: un cambio de contrato haría que el replay
de un comando antiguo se leyera como **clase distinta**, convirtiendo un
reintento legítimo en conflicto.

**I · Hash de la intención además del `jsonb`.** **Descartada en v1** por §10.

## Consecuencias

### A favor

- **Corregir nunca produce efectos de reversión** ni saldos negados: el filtro
  por versión vigente deja de incluir los antiguos, y ya está.
- **El historial es consultable sin estructuras adicionales**, y qué cambió se
  obtiene diferenciando el `canonical_intent` de dos comandos o los datos de dos
  versiones, sin un registro de cambios que pueda derivar.
- **La coherencia es estructural**: seis restricciones cubren el linaje, y dos
  claves compuestas impiden que un puntero cruce operaciones.
- **La idempotencia cubre creaciones y correcciones con el mismo mecanismo**, y
  solo persisten los comandos aceptados.
- **`client_command` es INSERT-only**, así que la superficie mutable del modelo
  se reduce a un único puntero.

### En contra

- **Toda consulta de saldo o deuda depende del filtro por versión vigente**, y
  olvidarlo produce **cifras infladas que no fallan**. Es el riesgo dominante, y
  su mitigación —la proyección canónica— **queda en D11**, no aquí.
- **Los efectos de versiones antiguas ocupan espacio para siempre.** Es el
  precio del historial.
- **Una tabla más** y un `INSERT` adicional por operación, frente a poner la
  clave en la operación. Es el coste de que la idempotencia cubra las
  correcciones.
- **Las claves foráneas diferibles tienen una trampa operativa medida**: borrar
  con sentencias sueltas viola el puntero al confirmar cada una, así que la
  limpieza debe ir dentro de una transacción. Costará una confusión a quien lo
  encuentre por primera vez.
- **`expected_version_id` traslada trabajo al cliente**, que debe conservar qué
  versión creía vigente y saber qué hacer ante un conflicto.
- **La reversibilidad es media-baja**: la forma de las tablas de hechos es cara
  de cambiar una vez hay datos.

## Fuera de alcance

**D10** resolverá la identidad y referencia de los participantes sin cuenta allí
donde los efectos necesiten apuntarlos. **No altera** el modelo de operación,
versión y comando.

**D11** resolverá: la forma física de los datos autoritativos de cada versión ·
persistido frente a derivado · **la proyección canónica de efectos vigentes** ·
**el lock definitivo de la deuda**.

También quedan fuera, y **no se prejuzgan**: la **anulación o cancelación** como
concepto distinto de la corrección —que hoy no aparece en ningún documento
normativo— · retención y purga · la **regla concreta de resolución del tipo de
cambio**.

**Requisito previo a la implementación, no parte de este ADR:** harán falta
vectores compartidos que cubran una corrección —V1 = 60, V2 = 75, V1 histórica,
solo V2 cuenta económicamente—, el **replay de la corrección sin crear V3**, y
la **corrección obsoleta dando conflicto**. Hoy `tests/vectors/scenarios.json`
no contiene ningún caso de corrección.
