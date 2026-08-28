# ADR-021 — Catálogo de categorías y su autorización

- **Estado:** Aceptado
- **Fecha:** 2026-08-28

## Contexto

El roadmap nombra **categorías** en el alcance de la Fase 6 y **nada más del
proyecto las define**: ni el modelo de datos, ni el glosario, ni ningún ADR
anterior, ni el esquema, ni el código. Era una capacidad prometida sin modelo
detrás.

El contrato de producto que este ADR materializa: categoría **siempre presente**
para ingreso y gasto, nunca `NULL` como estado normal · catálogos **distintos**
para las dos familias · `Otros` como categoría **real** de sistema y por defecto
· categorías **personalizadas** por persona, renombrables, con **baja lógica** y
sin perder el histórico · una categoría de gasto no vale para un ingreso ni al
revés · una personalizada ajena no se puede usar.

**Lo que ya estaba decidido y esta decisión no reabre:** ninguna cadena visible
vive fuera del catálogo de i18n (`AGENTS.md` §6) · ninguna tabla se crea sin su
policy en la misma migración, y ninguna policy aplica a `PUBLIC`
([ADR-006](ADR-006-privilege-model.md)) · el actor sale siempre del JWT ·
`core.client_command` es la unidad de idempotencia del **comando contable**
([ADR-011](ADR-011-operation-version-model.md) §5) · las escrituras que no son
hechos contables tienen su propia frontera, `nomey_provisioner`
([ADR-019](ADR-019-personal-provisioning.md)).

## Decisión

### 1. Una relación, con dos formas excluyentes

```
core.category (id, applies_to, owner_user_id, message_key, label,
               icon, ordinal, is_active, created_at)
```

- **`applies_to` habla en clase CONTABLE** —`expense` / `income`—, no en clase de
  operación. No es un detalle: un gasto de grupo de F9 tiene clase de operación
  `group_expense` y clase contable `expense`, de modo que **reutilizará este
  catálogo sin migrar nada**. Con `operation_class` habría hecho falta una
  entrada por clase nueva, y ese vocabulario es abierto.
- **`owner_user_id` nulo = de sistema.** Una sola columna distingue las dos
  formas, y un `CHECK` las hace excluyentes y completas: o de sistema con su
  `message_key`, o de alguien con su `label`. No hay una tercera.
- **Las de sistema llevan clave i18n, no texto.** Es la regla de `AGENTS.md` §6
  aplicada: ninguna cadena visible vive fuera del catálogo de mensajes. Las
  personalizadas llevan texto literal, que lo escribe la persona y no se traduce.
- **Vocabulario cerrado** en `applies_to`, como `scope.kind`: una familia nueva
  exige migración deliberada.

**Las cadenas visibles de las de sistema no llegan en F6.B.** Llegan al catálogo
de i18n **con la pantalla que las muestre**: añadirlas ahora crearía claves sin
consumidor, que es lo que `tests/lib/i18n-usage.test.ts` prohíbe, y por buen
motivo —copy que nadie renderiza no lo revisa nadie—.

### 2. `Otros` es una fila, no la ausencia de categoría

Existe en **las dos familias**, con su identidad propia. Es lo que permite que
`movement_detail.category_id` sea `NOT NULL` y que **el caso nulo no exista en
ninguna parte**: ni en el modelo, ni en la frontera, ni en la UX.

### 3. Identidades fijas, misma receta que el catálogo monetario

UUID v5 sobre el namespace DNS de RFC 4122 y el nombre
`category.nomey.app/<familia>/<slug>`. **Nunca se regeneran**:
`core.movement_detail` los referencia, así que un identificador distinto por
entorno rompe la portabilidad de cualquier dato.

### 4. La familia, estructural hasta donde puede serlo

`core.category` lleva `unique (id, applies_to)` como **destino** de una FK
compuesta desde `core.movement_detail (category_id, applies_to)`. Con eso, que
una categoría pertenezca a la familia **declarada** es estructural: PostgreSQL
rechaza lo contrario.

**Medido:** con la comprobación de familia retirada de la frontera, un gasto con
categoría de ingreso **lo rechaza igualmente la FK**. La comprobación del cuerpo
existe para **fallar bien** —`CATEGORY_NOT_USABLE · 422` en vez de una violación
de restricción cruda—, no para hacer cumplir la regla. Es el mismo reparto que
ADR-019 §8 fija para la moneda base.

Lo que **no** es estructural, y se dice en vez de disimularlo: que esa familia
coincida con la clase **real** de la operación. Atarlo exigiría mapear
`operation_class` a familia contable, y ese vocabulario es abierto a propósito
(ADR-013 §2). Lo comprueba la frontera, con un helper único y una **constante**
por función —no un dato del payload—, y tiene regresión.

### 5. Autorización al asignar: visibilidad, familia, y baja con excepción

`sec.assert_category_usable(categoría, familia, actor, predecesora)` comprueba,
**en este orden**:

1. **Visible** para el actor —de sistema, o suya—. Si no lo es, el mensaje **no
   distingue «no existe» de «no es tuya»**: distinguirlos convertiría la función
   en un oráculo con el que enumerar las categorías de otra persona.
2. De la **familia** esperada.
3. **Activa**… **salvo que sea la misma que ya tenía la versión que se corrige.**

> **La excepción del punto 3 no es una comodidad.** Sin ella, dar de baja una
> categoría dejaría **incorregible** todo movimiento que la use: cualquier
> corrección —aunque solo cambiara el importe— sería rechazada por una categoría
> que la persona no está tocando. Con ella, se **conserva** lo que hay y solo se
> prohíbe **asignar** una inactiva nueva.

### 6. Renombrar alcanza al histórico, y eso es lo correcto

Una categoría es una **entidad**, no una etiqueta copiada en cada movimiento.
`core.movement_detail` guarda la referencia, así que renombrar cambia lo que
muestran también los movimientos antiguos.

**Renombrar no crea ninguna versión**, y no debe: no es un hecho contable y no
cambia ningún efecto. Cambia el nombre de una entidad que el histórico
referencia.

### 7. Baja lógica, nunca `DELETE`

`is_active = false` retira la categoría del **selector** y no del histórico. Los
movimientos que la referencian siguen resolviendo su nombre y su icono.

**Quien filtra por `is_active` es la superficie de lectura, no la RLS.** La vista
`api.category` **proyecta** `is_active` sin filtrarlo: quien pinta un selector
pide `is_active=eq.true`, y quien resuelve el nombre de un movimiento histórico
necesita ver también las dadas de baja. Filtrar en la vista haría imposible lo
segundo.

### 8. La frontera de escritura: se reutiliza `nomey_provisioner`

Crear, renombrar o dar de baja una categoría **no es un hecho contable**: no
produce operación, ni versión, ni efecto. Es exactamente la familia de
escrituras para la que **ya existe** `nomey_provisioner` —ADR-019 lo creó para
crear ámbitos y membresías, que tampoco lo son—. Su alcance real, que este ADR
hace explícito, es **la frontera de las escrituras que no son contabilidad**, y
las categorías son su segundo miembro.

**No se crea un cuarto rol.** Y las dos alternativas quedan descartadas por
escrito:

- **`nomey_writer` no**, porque es el escritor **contable** y ensancharlo
  mezclaría dos fronteras que el proyecto mantiene separadas a propósito.
- **Conceder al cliente `INSERT`/`UPDATE` directo sobre `core.category` tampoco.**
  Hoy `authenticated` **no escribe nada** en `core`, y esa frase entera es fácil
  de verificar de un vistazo. Cambiarla por «no escribe nada salvo categorías» es
  precisamente el tipo de excepción que después nadie recuerda.

Sus policies van **acotadas al actor** —`owner_user_id = sec.request_actor_id()`
en `USING` y en `WITH CHECK`—, que es la forma que E21 demostró posible. El
propietario **nunca llega del payload**, y aquí además sería imposible falsearlo.

**Nada de esto pasa por `core.client_command`**: no hay operación que
deduplicar. La unicidad la da un índice de nombre por persona y familia, sobre
`lower(btrim(label))`, para que «Gimnasio» y «gimnasio» no convivan —son la misma
para quien las lee, y dos entradas indistinguibles en un selector son un defecto,
no una libertad—.

### 9. Lectura: `api.category`, `security_invoker`

Proyecta `id`, `applies_to`, `message_key`, `label`, `icon`, `ordinal`,
`is_active` y un booleano derivado `is_custom`.

**`owner_user_id` no se proyecta** —es identidad—, pero sí `is_custom`, que es lo
único que la UI necesita para saber si puede renombrarla. La RLS decide las
filas: de sistema y propias, y **ni la existencia** de una ajena.

## Consecuencias

**Aceptadas.**

- El icono se guarda como nombre de símbolo del sistema, en texto. Acopla el dato
  a la familia de iconos que consuma la UI; a cambio, el catálogo se puede
  sembrar y ampliar sin tocar código de cliente.
- Renombrar reescribe la lectura del histórico. Es lo que el producto pide, y la
  contrapartida es real: no queda registro de cómo se llamaba antes. Si algún día
  hiciera falta, sería un historial de la entidad, no una copia por movimiento.
- **Las categorías personalizadas en ámbitos compartidos quedan sin resolver.**
  Concepto y categoría viven en la versión, y la versión no tiene ámbito, así que
  en F9 una categoría propiedad de A quedaría referenciada por una operación que
  B puede leer. En F6 no hay ámbitos compartidos y el problema no existe.
  **F9 deberá decidir** si una personalizada puede usarse en un Grupo, si se
  proyecta su etiqueta o solo un genérico, o si los ámbitos compartidos usan solo
  el catálogo de sistema. Este ADR no lo prejuzga.

## Alternativas descartadas

| Alternativa                                                     | Por qué no                                                                                                             |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **`applies_to` en clase de operación**                          | Obligaría a una entrada por clase nueva, y `operation_class` es abierto. En clase contable, F9 lo reutiliza sin migrar |
| **Dos tablas, una por familia**                                 | Duplica policies, índices y superficie de lectura para una diferencia que cabe en una columna con vocabulario cerrado  |
| **`Otros` como `category_id NULL`**                             | Reintroduce el caso nulo en el modelo, la frontera y la UX, que es justo lo que el contrato prohíbe                    |
| **Copiar la etiqueta en cada movimiento**                       | Renombrar dejaría de alcanzar al histórico, y el producto pide lo contrario                                            |
| **`DELETE` de categorías sin histórico**                        | Dos comportamientos según los datos, y el borrado real es irreversible. La baja lógica vale para los dos casos         |
| **Filtrar `is_active` en la vista**                             | Haría imposible resolver el nombre de un movimiento histórico que use una categoría dada de baja                       |
| **Un cuarto rol solo para categorías**                          | `nomey_provisioner` ya es la frontera de las escrituras no contables                                                   |
| **`INSERT`/`UPDATE` directo del cliente sobre `core.category`** | Rompe la afirmación verificable «el cliente no escribe nada en `core`» a cambio de ahorrar tres funciones              |
| **Unicidad de nombre sensible a mayúsculas**                    | Dejaría convivir «Gimnasio» y «gimnasio», indistinguibles en un selector                                               |

## Verificación

`supabase/checks/movement-anatomy.sql`, secciones **A** (catálogo y superficie),
**B** (privilegios y RLS), **D** (familia, propiedad y baja) e **I** (crear,
renombrar, dar de baja), y la sección **9** de `scripts/http-boundary-check.sh`
por HTTP con JWT real —incluido que **B no alcanza ni la existencia** de una
categoría de A, y que el cliente **no puede escribir** `api.category` por la
Data API—.

**Falsificado.** Con la comprobación de familia retirada de la frontera, la FK
compuesta rechaza igualmente un gasto con categoría de ingreso, lo que confirma
cuál de las dos barreras es la autoridad.
