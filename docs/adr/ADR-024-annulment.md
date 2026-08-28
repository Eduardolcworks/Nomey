# ADR-024 — Anulación de una operación

- **Estado:** Aceptado
- **Fecha:** 2026-08-29

## Contexto

El producto pide **«Eliminar movimiento»**: el gasto deja de contabilizarse y el
Disponible vuelve. Con dos condiciones que no se negocian: **sin `DELETE`
físico** y **sin un segundo mecanismo de vigencia** que compita con
`current_version_id`.

**[ADR-011](ADR-011-operation-version-model.md) lo dejó expresamente fuera**, y
con esas palabras: _«también quedan fuera, y no se prejuzgan: la anulación o
cancelación como concepto distinto de la corrección — que hoy no aparece en
ningún documento normativo»_. Este ADR lo recoge; **no edita aquel**.

Y por esa misma razón ADR-011 §11 **no añadió** el
`UNIQUE (operation_id, supersedes_version_id)` que impediría bifurcar el linaje:
reservó a la frontera autoritativa el invariante «el predecesor es la versión
vigente anterior».

**Lo que no se reabre:** los hechos son inmutables y corregir versiona
(ADR-011) · `core.current_effect` es la proyección canónica
([ADR-013](ADR-013-persisted-vs-derived.md) §9) · quién puede corregir es la
**membresía actual** del ámbito (`data-model.md` §7) · el protocolo de
serialización de ADR-013 §11, extendido al saldo por
[ADR-022](ADR-022-balance-target-and-serialization.md).

## Decisión

### 1. Una versión nueva sin efectos

```
V1  gasto −20,00  →  efectos
V2  ANULACIÓN     →  CERO efectos          current_version_id = V2
```

Y **ese es todo el mecanismo**. `core.current_effect` une por
`current_version_id`, así que una operación cuya versión vigente no tiene efectos
**aporta cero** —en saldo, en deuda, en estadísticas y en cualquier derivado
futuro— sin una sola línea de lógica adicional.

**`current_version_id` sigue siendo la única autoridad.** No hay `deleted_at`, ni
`is_deleted`, ni estado paralelo.

**V2 conserva** importe, moneda, fecha y hora de la versión anulada: es el mismo
hecho declarado, ahora sin vigencia, y hace legible el diff. Lo que la hace no
contar es **no producir efectos**, no un importe cero fabricado.

**Nada se borra.** Operación, versiones, efectos y detalles permanecen, y no
existe ninguna ruta de `DELETE` ni para el cliente ni para el writer.

### 2. El discriminante, y por qué es necesario

`operation_version.version_kind`, vocabulario cerrado `record | annulment`.

**No es una comodidad.** La superficie de lectura de F6.D tiene que excluir las
operaciones anuladas, y detectarlas por «su versión vigente no tiene efectos»
obliga a una subconsulta sobre `core.effect` **dentro de una vista**, que es lo
que prohíbe la guarda de catálogo de ADR-013 §9. Ya ocurrió en F6.A con una
columna orientativa de `api.personal_scope`, y la guarda la rechazó.

**Describe qué clase de versión es; no decide cuál cuenta.**

### 3. La visibilidad, y el fallo silencioso que evita

`operation_version_client_select` exigía **un efecto visible de esa versión**.
Una anulación no tiene ninguno, así que **la operación seguía visible** —su
policy recorre todas las versiones— y **su versión vigente no se podía leer**. Un
cliente caería en la versión anterior y mostraría **el movimiento que el usuario
acaba de eliminar**, sin que nada fallara.

La policy gana un disyunto **estrictamente acotado**: una versión de anulación es
visible si lo son los efectos de **la versión que anula**.

> **Y la primera redacción de ese disyunto era un error de diseño.** Resolvía «la
> operación es visible» uniendo `core.effect` con `core.operation_version`
> **desde dentro de la policy de esa misma tabla**, y PostgreSQL lo cortó con
> `42P17: infinite recursion detected in policy`.
>
> `AGENTS.md` §4 lo nombra, y advierte que **relajar la policy para «arreglarlo»
> es peor que el bug**. Aquí no se relaja nada: la anulación se identifica por
> `version_kind` y encuentra a su predecesora por `supersedes_version_id`,
> **columnas de la fila que se está filtrando**, no consultas contra la tabla.
> Un helper `SECURITY DEFINER` —la salida que ADR-007 §2 estableció para
> `sec.is_member`— también se probó y se descartó: habría tenido que leer
> `core.effect` directamente, contra la guarda de ADR-013 §9, que **también
> saltó**.

### 4. Concurrencia, idempotencia y autorización

- **CAS** por `operation_id` + `expected_version_id`, como cualquier corrección.
- **Lock** sobre la unión de los ámbitos donde la versión anulada dejó **saldo** y
  **deuda**: los dos cambian al desaparecer sus efectos. Mismo orden global.
- **Idempotencia** por `core.client_command`, con `command_type` propio. El
  replay devuelve la misma operación **sin escribir una versión**.
- **Autorización**: la misma que corregir — **membresía actual** del ámbito, sin
  mirar quién creó la operación ni cuándo entró.
- **Observación de saldo**: sí, aunque no tenga efectos propios. Los ámbitos
  salen de la versión anulada. **El borrado es donde peor sienta un hueco de
  auditoría** ([ADR-023](ADR-023-balance-observation.md) §4).

### 5. Deuda

Se aplica **el mismo invariante** que a una corrección: anular el gasto que
originaba una deuda la borra y deja las liquidaciones sin nada que respaldar. Se
rechaza con **`SETTLEMENT_EXCEEDS_DEBT`** —el mismo código, porque es el mismo
invariante comprobado en otro momento, como ya hace `data-model.md` §3—. No
alcanzable en F6, y escrito bien desde el principio porque F9 llega detrás.

### 6. Terminal en F6

Una operación anulada **no admite versiones nuevas**: `OPERATION_ANNULLED · 409`.
«Restaurar» sería otra versión y **no se diseña hoy**; lo que no puede ocurrir es
que una corrección la reviva sin que nadie lo haya decidido.

**El `UNIQUE` de linaje que ADR-011 §11 no añadió sigue sin añadirse.** Aquel ADR
reservó ese invariante a la frontera, y hoy lo garantizan el lock y el CAS. La
anulación es una versión más y no lo cambia.

### 7. Una sola función

`api.annul_operation(payload)`, para cualquier clase. No contradice «una función
pública por clase de operación» (ADR-009 §1): esa regla existe porque cada clase
**deriva efectos distintos**, y anular no deriva ninguno. La clase sale de la
operación, nunca del payload. Ocho funciones idénticas serían ocho sitios donde
equivocarse.

## Consecuencias

**Aceptadas.**

- Una operación anulada **desaparece de la superficie normal** y su trazabilidad
  solo es alcanzable por vía interna. F6.D debe dejar esa vía comprobable.
- La anulación es terminal, así que **eliminar es irreversible para el usuario**
  aunque no lo sea para los datos. Es lo decidido, y revertirlo sería aditivo.
- `version_kind` es una columna más en la relación más caliente del modelo. Con
  valor por defecto, así que las versiones existentes no cambian de significado.

## Alternativas descartadas

| Alternativa                                       | Por qué no                                                                                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **`DELETE` físico**                               | Contradice la inmutabilidad y destruye la trazabilidad                                                                            |
| **`deleted_at` o `is_deleted`**                   | Segunda fuente de vigencia compitiendo con `current_version_id`                                                                   |
| **Efectos de importe cero**                       | Fabrica hechos que no ocurrieron para esquivar la RLS. ADR-013 §8 conserva ceros **resueltos por indivisibilidad**, no inventados |
| **Sin discriminante, por ausencia de efectos**    | La vista de F6.D dependería de `core.effect` y la guarda de ADR-013 §9 la rechaza                                                 |
| **Helper `SECURITY DEFINER` para la visibilidad** | Tendría que leer `core.effect` directamente; la guarda saltó                                                                      |
| **Ampliar la policy sin acotar**                  | Recursión `42P17`, y relajarla es peor que el bug                                                                                 |
| **Una función de anulación por clase**            | Anular no deriva efectos: ocho copias serían ocho sitios donde divergir                                                           |
| **Anulación reversible en F6**                    | «Restaurar» es producto que nadie ha pedido; añadirla después es aditivo                                                          |

## Verificación

`supabase/checks/balance-and-annulment.sql` §D: el saldo vuelve · la vigente es
una anulación sin efectos · **nada se borra** · el hecho se conserva · **la
versión es legible** y solo por quien es miembro · terminal · replay sin escribir
· CAS obsoleto · autorización ajena rechazada · y su observación de saldo.

**Falsificado.** Sin el disyunto de anulación en la RLS, **D6 falla**: la versión
vigente deja de ser visible y el cliente mostraría la anterior.
