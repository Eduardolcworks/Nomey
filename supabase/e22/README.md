# E22 · Las dos carreras del saldo

> **Esto es evidencia, no norma.** Mide comportamiento real del writer **antes**
> de que F6.C lo corrija. **No decide nada**: las decisiones viven en
> `docs/adr/`.
>
> **NO ES UNA MIGRACIÓN.** Ningún fichero de este directorio debe convertirse en
> una, igual que `supabase/e11`–`e21`.

Medido el **2026-08-29**, sobre `main` en `caef2d7`, antes de escribir una sola
línea de F6.C.

## Por qué existe

F6.C introduce dos cosas que **leen el saldo antes de escribir**: el ajuste por
**saldo objetivo** y la **observación histórica** `Saldo tras el movimiento`.
Ambas son correctas solo si nada puede intercalarse entre la lectura y la
escritura.

El proyecto no acepta una regresión que no se haya visto fallar. Así que primero
se reproducen las dos carreras, y **después** se corrigen.

## Cómo se ejecuta

```bash
./supabase/e22/balance-races.sh
```

Sesiones **simultáneas de verdad**, con `pg_sleep` dentro de la transacción para
que el entrelazado no dependa del planificador. Escribe filas confirmadas y las
retira.

## R1 · Dos ajustes por objetivo calculados en el cliente

Hoy `api.record_adjustment` solo acepta `delta`, así que un cliente que quisiera
«que mi saldo sea 100» tendría que leer el saldo y restar.

```
saldo de partida  120,00
las dos sesiones piden objetivo  100,00
saldo final       80,00
```

**Ningún orden serial produce 80,00.** A→B da 100,00; B→A da 100,00. Las dos
leyeron 120,00 y las dos restaron 20,00.

> **No es «una de las dos gana»: es que las dos pierden.** Y la idempotencia no
> lo cubre ni debe: son comandos **distintos**, con claves e intenciones
> distintas, y aceptarlos a los dos es lo correcto. Lo que falta es
> serialización, no deduplicación.

Es la razón por la que el delta **no puede calcularlo el cliente**, más allá del
argumento de ADR-002 §7 de que sería enviar un resultado en vez de una
intención.

## R2 · Dos gastos simultáneos observando su propio resultado

```
saldo de partida  120,00
dos gastos de 20,00 en paralelo, cada uno observa el saldo resultante
observó la sesión 1   80,00
observó la sesión 2  100,00
saldo real final      80,00
```

**Al menos una observación es falsa.** En `READ COMMITTED` ninguna transacción ve
los efectos no confirmados de la otra, así que la que termina primero observa un
saldo que deja de ser cierto en cuanto confirma la segunda.

**Cuál de las dos se equivoca depende del planificador**, y por eso la aserción
del script es «al menos una» y no un valor concreto. Con el planificador del otro
lado, ambas pueden observar 100,00 y ninguna acertar.

> **Este es el resultado que decide el alcance del bloqueo.** Un gasto o un
> ingreso escriben un **delta ciego**: no leen el saldo, así que por sí solos
> nunca producen un resultado no serializable. Es **la observación** la que
> convierte toda escritura de saldo en una lectura, y por tanto la que obliga a
> que **las siete clases que producen saldo** participen en el mismo protocolo.
> Con solo el ajuste bloqueando, R2 sigue ocurriendo — que es la «serialización
> parcial» que ADR-013 §11 declara equivalente a no serializar nada.

## Un detalle del propio experimento, que costó una repetición

La primera versión de R1 leía el saldo dentro de una tabla temporal creada como
`authenticated`, que **no tiene privilegio `TEMP`**. La transacción abortaba y el
saldo final quedaba en 120,00 — es decir, el script reportaba «carrera
reproducida» **por el motivo equivocado**: no es que las dos escrituras se
pisaran, es que ninguna llegó a escribir.

Se corrigió leyendo con `\gset` antes de cambiar de rol. **Una evidencia que
acierta por casualidad es peor que ninguna**, porque nadie vuelve a mirarla.

## Lo que E22 **no** mide

- Nada sobre la **anulación**: no hay ruta que la produzca todavía.
- Nada sobre la **corrección** de un ajuste por objetivo, que no existe aún.
- Nada por **HTTP**: estas carreras son de aislamiento de transacciones y se
  miden en SQL. La ruta real la cubre `scripts/http-boundary-check.sh`.
