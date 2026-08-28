# ADR-023 — Observación histórica de saldo

- **Estado:** Aceptado
- **Fecha:** 2026-08-29

## Contexto

El producto pide dos cifras que **no cambian nunca**:

- al ajustar el saldo, la línea del historial muestra el objetivo y, debajo y
  tachado, **el saldo que había antes**;
- al abrir un movimiento, **`Saldo tras el movimiento`**.

Y el requisito es explícito: **si después se corrige una operación anterior, esas
cifras no cambian.** Son fotografías, no derivadas.

Eso choca de frente con **[ADR-013](ADR-013-persisted-vs-derived.md) §1**, que
dice que balances, deudas, estadísticas y disponibles son **derivados sin
excepción** y que **no hay caché económica en v1**. Este ADR abre esa excepción,
y por eso existe por separado: quien busque «¿hay alguna caché económica?» tiene
que encontrarla.

**Lo que no se reabre:** el `Disponible` se deriva de `core.current_effect`
(ADR-013 §1 y §9) · el protocolo de serialización de ADR-013 §11, extendido al
saldo por [ADR-022](ADR-022-balance-target-and-serialization.md).

## Decisión

### 1. La distinción que hace legítima la relación

> Una **caché** se lee para responder **la pregunta actual**, y por eso puede
> desincronizarse.
>
> Una **observación** registra lo que el sistema calculó **en un instante**, se
> escribe una vez, **nunca se lee para responder la pregunta actual**, y por
> tanto **no puede desincronizarse: no hay nada con qué sincronizarla**.

`core.balance_observation` es lo segundo. Y la distinción se hace **exigible**,
no prometida.

### 2. La relación

```
core.balance_observation (operation_version_id, scope_id)
                          currency_definition_id, balance_before, balance_after
```

- **Por ámbito**, no por versión: una operación puede alcanzar varios y el saldo
  es de cada uno.
- **Por versión**: una corrección escribe filas nuevas y **nunca toca las
  anteriores**. Ahí es donde deja de haber nada que sincronizar.
- **Solo donde hay dimensión de saldo.** Un Grupo no tiene saldo propio
  (`data-model.md` §2) y no recibe filas vacías.
- La misma **FK compuesta de moneda** que gobierna `core.effect`: una observación
  no puede quedar en una moneda que el ámbito nunca tuvo.

### 3. Las cinco garantías, y las cinco son comprobables

1. **Escrita bajo lock**, en la misma transacción que la versión. Sin el lock la
   observación no sería cierta **ni en el instante en que se toma** — E22/R2 lo
   midió.
2. **Insert-only.** Ni `UPDATE` ni `DELETE` para nadie, writer incluido.
3. **Dos lecturas de la proyección canónica**, una antes de mover el puntero y
   otra después. **No** se calcula `después = antes + delta`: sería aritmética
   paralela que puede equivocarse donde la proyección no.
4. **Guarda de catálogo**: ninguna vista de `api` puede depender de ella. Si el
   `Disponible` se derivara de aquí, dejaría de ser una observación.
5. **El nombre lo dice en los dos lados**: `balance_observation` en persistencia,
   y `observed_balance_after` cuando salga por `api`.

### 4. Qué observa una corrección, y qué una anulación

El conjunto es la **unión** de los ámbitos con saldo de la versión nueva y de la
sustituida. Un ámbito que la corrección deja de alcanzar **también cambia de
saldo**, y sin la unión se quedaría sin observación justo cuando cambia.

**Una anulación observa igual**, aunque no tenga efectos propios: sus ámbitos
salen de la versión que anula. Es deliberado — **el borrado es el momento donde
peor sienta un hueco de auditoría**.

### 5. La consecuencia que hay que mirar de frente

**La observación de una versión es del instante en que esa versión se escribió.**
Si hoy se corrige un movimiento de hace tres meses, la versión nueva observa el
saldo **de hoy**.

Es coherente —cada versión observa su propio instante— y **no se disimula**: la
UI debe presentarlo como observación del sistema asociada a esa versión, no como
reconstrucción de «el saldo que tenías aquel día». Lo que sí se cumple
exactamente es el requisito: **corregir una operación anterior no altera la
observación de ninguna otra**.

## Consecuencias

**Aceptadas.**

- Una excepción explícita a ADR-013 §1. Acotada, nombrada y con guarda, pero
  excepción.
- Una agregación más por escritura y por ámbito. Es el precio de no calcular la
  cifra por una vía paralela.
- **Es lo que obliga a que las siete clases con saldo se serialicen**
  (ADR-022 §5). Sin la observación, un delta ciego no necesitaría lock.

## Alternativas descartadas

| Alternativa                                      | Por qué no                                                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Derivar el «antes» y el «después» al leer**    | Cambiarían al corregir cualquier operación anterior, que es exactamente lo que el producto prohíbe                                    |
| **`después = antes + delta`**                    | Aritmética paralela a la definición de saldo, que puede divergir de ella. Dos lecturas de la proyección no admiten esa clase de error |
| **Columnas en `operation_version`**              | Una versión alcanza varios ámbitos y el saldo es de cada uno                                                                          |
| **Permitir `UPDATE` para «recalcular»**          | Recalcular una fotografía la convierte en una caché, con todas sus preguntas de drift                                                 |
| **Materializar el saldo actual y leerlo de ahí** | La segunda fuente de verdad que ADR-013 alternativa B ya descartó                                                                     |
| **No observar las anulaciones**                  | Dejaría el hueco de auditoría justo en el borrado                                                                                     |
| **Escribir la observación con un trigger**       | Lógica contable oculta, no puede calcular el «antes» con el puntero ya movido, y el proyecto ya rechazó los triggers en ADR-019       |

## Verificación

`supabase/checks/balance-and-annulment.sql` §A4, §A5 y §C — incluido **§C2, el
requisito central**: corregir una operación anterior **no altera** la observación
de otra. La cadena sin huecos bajo concurrencia real la mide
`scripts/balance-concurrency.sh`.
