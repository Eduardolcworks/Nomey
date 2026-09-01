# ADR-027 — La categoría es del gasto, y el icono es una clave semántica

- **Estado:** Aceptado
- **Fecha:** 2026-09-01
- **Supersede parcialmente:** [ADR-021](ADR-021-category-catalogue.md), §1, §2,
  §3, §4, §5 y la primera consecuencia aceptada. El resto de ADR-021 sigue
  vigente y **no se reabre**: la baja lógica (§7), que renombrar alcance al
  histórico (§6), la frontera de escritura en `nomey_provisioner` (§8) y la
  vista `api.category` con `security_invoker` (§9).

## Contexto

ADR-021 modeló las categorías con **dos familias** —`expense` e `income`— y una
columna `applies_to` que las separaba, con FK compuesta desde
`core.movement_detail` para hacerlo estructural. Era un modelo correcto para el
contrato de producto que existía entonces: «categoría siempre presente para
ingreso y gasto».

**Ese contrato de producto cambió.** La revisión de la pantalla de Inicio, ya con
datos reales delante, dejó ver que la categoría del ingreso no informa de nada:
sus tres valores sembrados —Nómina, Ingreso extra, Otros— no son una
clasificación del dinero que entra, son una paráfrasis del concepto que la
persona ya escribió. La tarjeta de categorías, que es donde la clasificación
rinde, mide **gasto**: es la pregunta «¿en qué se me va?». Para el ingreso la
pregunta equivalente sería «¿de dónde viene?», y esa no tiene respuesta útil con
tres opciones fijas ni la pide nadie.

Dos problemas más aparecieron en la misma revisión, y se resuelven aquí porque
tocan la misma relación:

- **El icono se guardaba como nombre de SF Symbol.** `fork.knife`, `figure.run`.
  ADR-021 lo aceptó explícitamente como consecuencia («acopla el dato a la
  familia de iconos que consuma la UI»). Medido: `expo-symbols` sólo resuelve
  Material Symbols en Android cuando el nombre se declara como `{ ios, android }`
  en el cliente, así que un nombre de iOS en la base **deja Android sin icono** y
  no hay ningún sitio donde arreglarlo sin volver a acoplar.
- **El color no estaba decidido.** La primera implementación derivaba el color de
  un hash del UUID, que es estable y accesible pero **arbitrario**: Alimentación
  salía del color que le tocara. Para las diez de sistema eso es una decisión de
  producto que nadie había tomado.

**Lo que ya estaba decidido y esta decisión no reabre:** que ninguna cadena
visible viva fuera del catálogo de i18n · que ninguna tabla se cree sin su policy
en la misma migración ([ADR-006](ADR-006-privilege-model.md)) · que el actor
salga del JWT · que `core.client_command` sea la unidad de idempotencia
([ADR-011](ADR-011-operation-version-model.md) §5) · que las escrituras no
contables pasen por `nomey_provisioner`
([ADR-019](ADR-019-personal-provisioning.md)).

## Decisión

### 1. La categoría es un hecho del gasto, y vive en su propia relación

```
core.expense_category (operation_version_id PK → operation_version,
                       category_id NOT NULL → category)
```

`movement_detail.category_id` y `movement_detail.applies_to` **desaparecen**.
`core.movement_detail` se queda con lo que toda versión de movimiento tiene —el
concepto—, y lo que sólo el gasto tiene se va a una relación propia.

Es la misma forma que ADR-020 §2 ya fijó para el resto del contenido de la
versión, y por la misma razón: **lo que una clase tiene y otra no, no se modela
como columna nullable de una tabla común.** Una columna nullable obliga a que
cada lector decida qué significa el `NULL` —«no aplica» o «falta»— y esas dos
cosas no son la misma. Con la relación aparte, la ausencia de fila significa una
cosa sola: esta versión no es un gasto.

### 2. Qué garantiza «todo gasto tiene categoría», exactamente

Es la parte de esta decisión que más fácil sería describir mal, así que se
enuncia por partes y con lo que se midió de cada una:

| Afirmación                               | Qué la sostiene                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Como mucho una** categoría por versión | **Estructural.** La clave primaria sobre `operation_version_id`                                   |
| **La que hay es real**                   | **Estructural.** `NOT NULL` más la FK a `core.category`                                           |
| **Al menos una**, en todo gasto          | **No es estructural.** La frontera autoritativa más el cierre de las escrituras directas a `core` |

**«Al menos una» no puede ser una restricción**, y conviene entender por qué
antes de que alguien intente añadirla: la condición depende de
`operation.operation_class`, que vive en **otra tabla**. Un `CHECK` no puede
mirarla, y un trigger que lo hiciera sería una regla de negocio escondida en el
esquema, que es lo que la frontera autoritativa existe para evitar
([ADR-009](ADR-009-authoritative-write-boundary.md)).

**Medido**, con la sonda de §0 y con la sección **J** de
`supabase/checks/movement-anatomy.sql`:

- cero `CHECK` y cero triggers que exijan la fila;
- un gasto sin `category_id` por la frontera → `PAYLOAD_INVALID · 400`;
- `authenticated` no tiene `USAGE` sobre `core`, ni un solo privilegio distinto
  de `SELECT`, ni una sola policy de escritura: insertar una versión a mano,
  borrar la fila de categoría de un gasto o ponérsela a un ingreso devuelven
  **`permission denied for schema core`**;
- dos categorías para la misma versión → `duplicate key`.

**Decir que una FK o un `NOT NULL` lo garantizan por sí solos sería falso.** Lo
que garantizan es que una fila **existente** apunte a una categoría real.

### 3. El ingreso no tiene categoría, y el rechazo es de forma

`category_id` deja de ser un campo admisible de `api.record_personal_income`.
Mandarlo devuelve **`PAYLOAD_INVALID · 400`**, no `CATEGORY_NOT_USABLE · 422`:
el rechazo ocurre en `sec.assert_payload_shape`, **antes** de mirar a qué apunta
el identificador.

La diferencia importa y por eso las pruebas mandan un UUID **real y vigente**: si
el rechazo dependiera de la categoría, uno válido pasaría, y el campo habría
vuelto a existir por la puerta de atrás.

Esto **cambia la intención canónica del ingreso**, y por tanto su idempotencia.
Un pago pendiente escrito con el contrato anterior y reintentado con el nuevo no
compararía igual. Se acepta deliberadamente porque **no hay producción**: es el
único momento en que este cambio es gratis.

### 4. Diez categorías de sistema, y cinco dadas de baja

El catálogo vigente, en su orden:

| Orden | Clave                            | Icono           |
| ----- | -------------------------------- | --------------- |
| 10    | `category.expense.groceries`     | `groceries`     |
| 20    | `category.expense.dining`        | `dining`        |
| 30    | `category.expense.transport`     | `transport`     |
| 40    | `category.expense.housing`       | `home`          |
| 60    | `category.expense.health`        | `health`        |
| 70    | `category.expense.leisure`       | `leisure`       |
| 80    | `category.expense.shopping`      | `shopping`      |
| 100   | `category.expense.subscriptions` | `subscriptions` |
| 110   | `category.expense.travel`        | `travel`        |
| 120   | `category.expense.other`         | `other`         |

Las cinco retiradas —las tres de ingreso, más Suministros y Educación— se dan de
**baja lógica**, nunca `DELETE`, que es ADR-021 §7 sin modificar. Suministros y
Educación salen por solaparse con Hogar y con Ocio o Compras según el caso, y
porque una lista de diez se recorre de un vistazo y una de doce no.

**Los huecos del orden —50, 90— son deliberados**: dejan sitio para insertar sin
renumerar lo que ya existe.

Las identidades no se regeneran. Siguen siendo los UUID v5 de ADR-021 §3, con
el nombre que ya tenían, **incluida la familia en el nombre** aunque la familia
ya no exista como columna: cambiar la receta cambiaría los identificadores, y
`core.expense_category` los referencia.

**Las quince claves de i18n se quedan**, también las cinco retiradas. El gasto
que usó Suministros sigue existiendo y hay que saber nombrarlo; quitarlas de
`SYSTEM_CATEGORY_KEYS` pintaría ese histórico sin nombre.

### 5. El icono es una clave semántica de Nomey, no un nombre de plataforma

El vocabulario cerrado, en un `CHECK` sobre `core.category`: las diez de arriba,
más las cuatro de las categorías retiradas, más `tag` como genérico —quince—.
`api.create_custom_category` acepta un subconjunto de once: las diez vigentes y
`tag`.

Quién traduce la clave a un símbolo es el cliente, en
`src/ui/theme/category-palette.ts`, con un par `{ ios, android }` por clave. Es
exactamente lo contrario del acoplamiento que ADR-021 aceptó: **la base dice qué
significa el icono y el cliente decide cómo se dibuja en cada plataforma.**

Una clave desconocida —incluido un nombre de SF Symbol como `figure.run`— se
rechaza con `PAYLOAD_INVALID · 400`. Sin icono, se cae en `other`, no en un
hueco.

### 6. Los diez colores son una decisión de producto, y el hash es el respaldo

Las diez de sistema llevan **color explícito por UUID**, en el cliente. Las
personalizadas no lo llevan y siguen resolviéndose por el hash FNV-1a estable
sobre su identificador, que es lo que garantiza que la misma categoría salga del
mismo color en el sector y en la leyenda sin que nadie elija.

Que el color viva en el cliente y no en la base es deliberado: es una decisión de
**diseño**, sujeta a la dirección visual y a sus reglas de contraste, y cambiarla
no debería ser una migración. Lo que la base fija es la **identidad**; el color
es una lectura de esa identidad, como el icono.

La paleta se midió contra el fondo de la aplicación: **contraste mínimo 5.11:1**,
y ningún par de colores separado sólo por tono o sólo por luminosidad.

### 7. Qué queda igual

Corregir un gasto sigue exigiendo la categoría: una corrección **declara la
versión entera**, no un delta ([ADR-011](ADR-011-operation-version-model.md) §4),
así que la categoría vuelve a ser obligatoria en cada una. Omitirla es
`PAYLOAD_INVALID · 400`.

La autorización al asignar es la de ADR-021 §5 **menos la comprobación de
familia**, que ya no tiene sentido: inexistente, ajena y dada de baja siguen
devolviendo `CATEGORY_NOT_USABLE · 422`, y las dos primeras con **el mismo
mensaje** a propósito —distinguirlas revelaría que la categoría de otra persona
existe—. La excepción de la baja lógica se mantiene: una categoría retirada sigue
sirviendo para **corregir** el movimiento que ya la usaba, porque si no, darla de
baja dejaría incorregible todo lo que la referenciara.

## Consecuencias

**Aceptadas.**

- **La FK compuesta que hacía estructural la familia desaparece con ella.** Se
  cambia una garantía estructural por ninguna, y es correcto porque lo que
  garantizaba —«esta categoría es de la familia declarada»— ya no es una
  afirmación con contenido. Lo que la sustituye no es una FK más débil: es que la
  pregunta dejó de existir.
- **La intención canónica del ingreso cambia**, con el efecto sobre idempotencia
  descrito en §3. Gratis hoy, caro en cuanto haya producción.
- **Una relación más que borrar en la retirada de los checks.** Ya costó un fallo:
  `scripts/http-boundary-check.sh` enmudecía su limpieza, y la violación de clave
  ajena resultante se manifestó tres pantallas más abajo como «quedaron 75 filas».
  La retirada ya no enmudece.
- **Las categorías personalizadas en ámbitos compartidos siguen sin resolver**, y
  esta decisión no lo prejuzga. Es la consecuencia abierta de ADR-021, intacta:
  **F9 deberá decidirlo**.
- **Un mismo gasto no puede llevar dos categorías**, y esta decisión no abre esa
  puerta. Si algún día se pidiera, sería otra relación y otro ADR, no relajar la
  clave primaria de ésta.

## Alternativas descartadas

| Alternativa                                                | Por qué no                                                                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **`movement_detail.category_id` nullable**                 | Reintroduce el caso nulo ambiguo: cada lector tendría que decidir si significa «no aplica» o «falta», y no son lo mismo          |
| **Ocultar en la UI las categorías de ingreso**             | Deja el modelo mintiendo y el contrato aceptando datos que el producto no quiere. Lo pidió expresamente el producto: nada de eso |
| **`DELETE` de las cinco retiradas**                        | Irreversible, y arrastraría el histórico que las usa. La baja lógica ya resolvía esto en ADR-021 §7                              |
| **Mantener `applies_to` con un solo valor posible**        | Una columna cuyo vocabulario tiene un elemento no dice nada, y sugiere que algún día tendrá dos                                  |
| **Guardar el color en la base**                            | Convierte cada ajuste de diseño en una migración, y el color no es identidad                                                     |
| **Dejar el hash decidiendo también las diez de sistema**   | Estable y accesible, pero arbitrario: el color de Alimentación sería el que tocara. Es una decisión de producto, no de función   |
| **Seguir guardando nombres de SF Symbol**                  | Medido: deja Android sin icono, y no hay dónde arreglarlo sin volver a acoplar la base a una plataforma                          |
| **Un `CHECK` o un trigger que exija la fila de categoría** | No puede: la condición depende de `operation_class`, que está en otra tabla. Y sería regla de negocio escondida en el esquema    |

## Verificación

`supabase/checks/movement-anatomy.sql`: sección **D** (propiedad y baja lógica,
sin familia), **H** (la intención canónica del gasto lleva categoría y la del
ingreso no, con los cuatro campos del ingreso medidos uno a uno), **I** (crear
sin familia, con clave semántica, rechazando un nombre de plataforma) y **J**
(las tres garantías del invariante, por separado y cada una con su falsificación).

`scripts/http-boundary-check.sh`, sección **9**: veintiuna aserciones por HTTP
con JWT real, incluidas las tres categorías que no sirven —inexistente, ajena y
dada de baja—, el caso positivo que las hace falsables, el gasto sin categoría,
el ingreso sin categoría y el ingreso **con** categoría.

**Falsificado.** Devolviendo `category_id` a la forma admisible **y** a la
intención canónica de `api.record_personal_income`, la sección H falla —y falla
de la manera reveladora: el ingreso con categoría deja de rechazarse por forma y
pasa a rechazarse por `IDEMPOTENCY_KEY_REUSED`, que es exactamente el modo en que
el campo habría vuelto a colarse sin que nada saltara.
