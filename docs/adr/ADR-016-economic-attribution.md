# ADR-016 — Atribución económica de efectos a un usuario

- **Estado:** Aceptado
- **Fecha:** 2026-08-26

## Contexto

[ADR-012](ADR-012-participant-identity.md) cierra su documento delegando
expresamente:

> Delegado a **D11**: la proyección canónica de efectos vigentes deberá resolver
> también **qué efectos son «míos»**, que es una pregunta sobre el vínculo y no
> sobre la membresía.

**[ADR-013](ADR-013-persisted-vs-derived.md) es D11, y no la recogió.**
Comprobado por búsqueda: no menciona el vínculo ni esa pregunta. Su §9 define la
proyección canónica **por vigencia** y su §10 la visibilidad **por membresía del
ámbito**; ninguna de las dos responde de quién es un importe.

La pregunta no es teórica. El glosario define `Disponible tras saldar` como
_«`Disponible actual` + lo que te deben − lo que debes»_, y sin una regla de
atribución esa cifra no se puede calcular. Y `data-model.md` §6 promete que _«al
vincular un participante con un usuario, todo su historial se incorpora a sus
finanzas personales **en las fechas originales**»_, promesa que hoy **no se
cumple**: se midió que un usuario vinculado a un participante de un grupo del
que no es miembro alcanza **cero** efectos.

**Lo que ya estaba decidido y esta decisión no reabre:** los efectos referencian
siempre al participante (ADR-012 §3) · la dimensión de saldo **no tiene ningún
campo de identidad propio** (ADR-013 §8) · el participante económico es
**legítimamente nulo** en el Modo Personal (ADR-013 §8) · el saldo del Modo
Pareja **no entra** en las magnitudes personales porque _«ningún miembro tiene
una parte determinable de él»_ (glosario, invariante 16) · un gasto de pareja
financiado por A da **estadísticas personales de A = 0** (`data-model.md` §4.10)
· el resultado financiero **no depende de quién registre** (invariante 10).

## Decisión

### 1. La atribución es por dimensión

> **Una dimensión de un efecto es de `U` cuando el participante que esa
> dimensión nombra está vinculado a `U`; y cuando la dimensión no nombra ningún
> participante, cuando el ámbito del efecto es el Modo Personal de `U`.**

| Dimensión                     | De quién                                     | Signo   |
| ----------------------------- | -------------------------------------------- | ------- |
| `balance_amount`              | del **dueño** del Modo Personal              | el suyo |
| `economic_amount` sin partic. | del **dueño** del Modo Personal              | el suyo |
| `economic_amount` con partic. | del usuario **vinculado** a ese participante | el suyo |
| `debt_amount`, lado deudor    | del usuario vinculado al **deudor**          | **−**   |
| `debt_amount`, lado acreedor  | del usuario vinculado al **acreedor**        | **+**   |

**El saldo del Modo Pareja no se atribuye individualmente, ni en parte.** Un
saldo en un `group` es inválido por dominio y queda como invariante del writer.

**Una misma fila no puede producir información distinta según a quién represente
el usuario**, y es estructural: `UNIQUE (scope_id, user_id)` del vínculo
(ADR-012 §6) más `debtor <> creditor` hacen imposible ser las dos partes.

**No intervienen:** `linked_at` · `participant_period` al leer ·
`operation.created_by` · `operation_version.created_by` · la membresía.

### 2. Propiedad durable del Modo Personal

Se adopta **`core.scope.owner_user_id`**, con
`kind = 'personal' ⇔ owner_user_id IS NOT NULL` y un índice único sobre la
columna. PostgreSQL garantiza así, **estructuralmente**: todo `personal` tiene
exactamente un dueño · `group` y `couple` no pueden tenerlo · un usuario tiene
como máximo un Modo Personal (ADR-002 §2). Sin clave foránea a `auth.users`,
igual que `membership.user_id` y `operation.created_by`.

**No se expone en ninguna superficie de `api`.**

### 3. Por qué la membresía no puede hacer de propiedad

`core.membership` significa **autorización actual** — así lo define ADR-012 §4 y
así se migró. Usarla como propiedad económica ataría la historia a un dato de
presente: **perder la membresía borraría de las finanzas personales todo lo
anterior**, contra ADR-012 §12, que fija que el participante histórico nunca
desaparece porque termine una de las dos cosas.

Son conceptos distintos y **pueden divergir a propósito**. Que hoy coincidan en
la práctica no los hace el mismo dato.

### 4. `participant_period` solo al escribir

> **La elegibilidad se comprueba al ESCRIBIR, contra
> `operation_version.effective_date`.**

Es la fecha que fijan `data-model.md` §7 —«los válidos **en la fecha efectiva
original**»— y ADR-012 §7. No se usan los instantes de registro:
`operation.created_at` ni `operation_version.created_at` responden a cuándo se
sincronizó, no a cuándo ocurrió el hecho.

**Y una vez escrito el efecto, el periodo ya cumplió su función.** Volver a
comprobarlo al leer sería redundante y destructivo: cerrar un periodo al salir
de un grupo haría desaparecer todo lo anterior. El periodo responde «¿podía
figurar?»; la atribución, «¿de quién es esto?».

### 5. El claim retroactivo no filtra por `linked_at`

La regla pregunta si el participante **está** vinculado, no **desde cuándo**.
Filtrar por `linked_at` haría desaparecer exactamente el historial que la
reclamación existe para recuperar (`data-model.md` §6).

### 6. Pertenencia económica ≠ autorización ≠ visibilidad

Divergen en las dos direcciones, y ninguna sustituye a otra:

|                                                                          | Visible | Mío    |
| ------------------------------------------------------------------------ | ------- | ------ |
| Mi parte de una cena de grupo                                            | Sí      | **Sí** |
| La parte de otro en esa cena                                             | **Sí**  | No     |
| Deuda entre otros dos miembros                                           | **Sí**  | No     |
| Saldo común del Modo Pareja                                              | Sí      | **No** |
| Efectos de un participante reclamado en un ámbito del que no soy miembro | **No**  | Sí     |

### 7. La proyección canónica no atribuye

`core.current_effect` responde **solo** qué efectos cuentan ahora. **No lleva
ninguna columna que dependa de `auth.uid()`.** Hacerla depender de quién
pregunta obligaría a balances, estadísticas y deudas a heredar un filtro por
usuario que ninguno de los tres quiere. **La atribución va encima**, en dos
superficies separadas.

### 8. Dos rutas disjuntas

| Ruta                 | Dimensiones                            | Mecanismo                                        |
| -------------------- | -------------------------------------- | ------------------------------------------------ |
| **Por ámbito**       | saldo · económica **sin** participante | `api.personal_effect`, `security_invoker`        |
| **Por participante** | económica **con** participante · deuda | `api.claimed_dimension()`, frontera privilegiada |

**No se solapan, y no por convención.** Las dimensiones atribuidas por ámbito no
nombran participante y solo aparecen en el Modo Personal, donde el usuario es
miembro; las atribuidas por participante nunca aparecen en un Modo Personal,
porque el dominio produce ahí `participant: null`. **Cada dimensión tiene
exactamente un camino**, así que no hay doble contabilización.

### 9. La frontera privilegiada

`api.claimed_dimension()` es **`SECURITY DEFINER`**, propiedad de `postgres`,
`STABLE`, `search_path = ''`, **sin parámetros**, `REVOKE EXECUTE FROM PUBLIC` y
`GRANT` solo a `authenticated` — **nunca a `anon`**. Deriva el actor de
`auth.uid()` y no acepta ninguna identidad del cliente.

**No puede confiar en la RLS ni en la proyección canónica.** Se midió: dentro de
un `SECURITY DEFINER` cuyo owner es el propietario de las tablas, la proyección
canónica devuelve **todas** las filas. Por eso el filtrado por
`participant_user_link.user_id = auth.uid()` está en el **`WHERE` del propio
cuerpo**, antes de proyectar nada.

Vive en `api` y no en `sec` por una razón medida: el rol cliente **no puede
invocar funciones de `sec` por nombre**, porque ADR-007 §3 le niega `USAGE` sobre
ese schema a propósito.

### 10. La lista de columnas es la frontera de privacidad

Devuelve **exactamente**: `accounting_class` · `currency_definition_id` ·
`effective_date` · `dimension` · `amount` como **texto** (ADR-008 §1).

**No devuelve** `scope_id` · ningún identificador de participante · el id del
efecto, la operación o la versión · `owner_user_id` · las demás dimensiones de la
misma fila · el nombre o los miembros del ámbito · el saldo compartido.

> **Ampliar esta lista es una decisión de privacidad, no una mejora de UX.**

### 11. Lo que el claim sigue sin conceder

Ni membresía · ni lectura del ámbito · ni efectos completos · ni dimensiones
ajenas de una fila · ni deudas entre terceros · ni el saldo compartido · ni
actividad no atribuible · **ni capacidad de liquidar**.

> **Esto NO resuelve el «acceso residual» de ADR-012 §12**, que sigue abierto:
> aquél incluye liquidar, y aquí solo hay lectura acotada de lo propio.

## Alternativas consideradas

**A · La membresía como propiedad.** Cero estructuras nuevas y coincide con la
realidad hoy. **Descartada** por §3: ataría la historia a un dato de presente, y
ADR-012 §4 define la membresía como otra cosa.

**B · Ampliar la policy de `SELECT` de `core.effect`** con la pertenencia por
participante. Es la solución obvia y no necesita ninguna frontera privilegiada.
**Descartada porque filtra, y se midió.** La RLS concede **filas, no columnas**
—E20 ya lo había medido— y ADR-013 §8 permite expresamente que una fila lleve
varias dimensiones. Con esa policy, **quien es solo el deudor de una fila mixta
obtiene además el importe económico de un participante ajeno, la identidad del
acreedor y el `scope_id`**. Arrastraría además la visibilidad de la versión y de
la operación, cuyas policies derivan de los efectos visibles.

**C · Tabla dedicada `personal_scope_owner`.** Aísla el hecho y no toca una tabla
aceptada. **Descartada como forma preferida** porque es **estrictamente más
débil**: una tabla no puede exigir que la fila exista, de modo que «todo Modo
Personal tiene dueño» y «solo los `personal` tienen dueño» pasarían a ser
invariantes del writer. Con la columna, los tres son estructurales. Sigue siendo
viable si alguna vez conviene separar el hecho.

**D · No soportar el historial reclamado sin membresía.** Es el statu quo, cuesta
cero y no añade ninguna superficie privilegiada. **Descartada** porque contradice
`data-model.md` §6: la reclamación retroactiva dejaría de funcionar justo en el
caso que la motiva —alguien que participó y ya no está en el grupo—.

## Consecuencias

### A favor

- **La regla no añade semántica: lee la que ya está.** Cada dimensión trae su
  propio sujeto, y por eso la partición en dos rutas sale exacta.
- **Las tres cardinalidades de la propiedad son estructurales.**
- **La reclamación retroactiva funciona** sin conceder membresía ni lectura del
  ámbito, y con las fechas originales.
- **No hay doble contabilización**, por construcción y no por cuidado.
- **No se copia ningún hecho contable** ni se crea ninguna tabla derivada de
  atribución: ambas rutas leen la proyección canónica.

### En contra

- **Existe una frontera que atraviesa deliberadamente la RLS.** Su cuerpo y su
  lista de columnas son **código sensible** y hay que auditarlos como tales en
  cada cambio.
- **`FORCE ROW LEVEL SECURITY` sobre `core.effect` invalidaría el mecanismo**,
  porque sometería también al propietario. Si alguna vez se adopta, esta
  decisión hay que revisarla.
- **Propiedad y membresía pueden divergir**, y el writer debe crearlas
  atómicamente. Si olvida una, la atribución o el acceso quedan cojos.
- **Dos rutas distintas producen las dimensiones personales**, y su disyunción
  depende de que las dimensiones sigan repartidas como hoy. El sexto check la
  comprueba en cada ejecución en lugar de confiar en ella.
- **El claim devuelve información económica de un ámbito que el usuario no puede
  leer.** Es deliberado y acotado, pero es información que antes no salía.
- **No resuelve el acceso residual ni las liquidaciones**, que siguen abiertos.

### Invariantes que quedan en la frontera autoritativa

El dueño de un Modo Personal es **también** miembro de él · y es su **único**
miembro · propiedad y membresía se crean **atómicamente** · ningún
`balance_amount` en un ámbito `group` · un Modo Pareja tiene exactamente dos
miembros · elegibilidad del participante contra `operation_version.effective_date`.

## Fuera de alcance

- **El acceso residual y las liquidaciones** de quien sale con saldo distinto de
  cero (ADR-012 §12).
- **El mecanismo de prueba del claim**, la revocación y la fusión, delegados a
  F10 por ADR-012 §9 y §11.
- **Las superficies de lectura de Grupo y Modo Pareja**, que llegan en sus fases.
- **Ampliar la lista de columnas del claim**, que será una decisión de privacidad
  propia.
