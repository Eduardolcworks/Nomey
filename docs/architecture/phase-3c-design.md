# Diseño de la Fase 3.C — esquema, grants, RLS y frontera de escritura

> ⚠️ **NO NORMATIVO.** Es el análisis del Data Architect con el que **arranca**
> 3.C, no su conclusión. No decide nada: las decisiones normativas viven en
> [`docs/adr/`](../adr/README.md), en [`data-model.md`](data-model.md) y en
> [`glossary.md`](../product/glossary.md); la secuencia de fases, en
> [`product/roadmap.md`](../product/roadmap.md). Si este documento los
> contradice, mandan ellos.
>
> Su función es **poner las once decisiones abiertas sobre la mesa con
> alternativas, evidencia y una recomendación nombrada**, para que se aprueben o
> se rechacen antes de escribir SQL definitivo. Al cerrarse 3.C, lo que se haya
> aprobado se traslada a un ADR y este documento queda como archivo de análisis.

Escrito el 2026-08-23, con `supabase/migrations/` todavía inexistente.

**Convención de etiquetado.** Cada afirmación de consecuencia lleva marca:

- **[medido]** — observado en este stack, con el script que lo reproduce.
- **[doc]** — afirmado por documentación oficial versionada, con URL.
- **[inferencia]** — deducción razonada a partir de lo anterior, **no medida**.
- **[preferencia]** — juicio de ingeniería, discutible con otro argumento.

---

## 1 · Lectura del estado actual

### 1.1 Lo que existe

| Cosa                   | Estado                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/config.toml` | Versionado. `api.schemas = ["public", "graphql_public"]`, `extra_search_path = ["public", "extensions"]`, `db.major_version = 17`, `max_rows = 1000`, `auth.jwt_expiry = 3600` **[medido]** |
| Stack local            | Levantado y reutilizable. PostgreSQL **17.6**, PostgREST **v16.1**, GoTrue **v2.195.0** **[medido]**                                                                                        |
| `supabase/e11/`        | Evidencia de la frontera de datos. **No es migración.** Declara su propia dependencia aislada de `@supabase/supabase-js@2.112.3`                                                            |
| `supabase/e12/`        | **Nuevo en esta sesión.** Evidencia de D4. Cero dependencias. **No es migración**                                                                                                           |
| `src/domain/`          | Implementación de referencia pura, 16 ficheros, 110 tests en verde                                                                                                                          |
| `tests/vectors/`       | Seis ficheros JSON, única fuente de expectativas. Importes como `string`                                                                                                                    |
| ADR-002, ADR-003       | `Aceptado`, inmutables. La puerta E11 de ADR-003 se cumplió contra stack real                                                                                                               |

### 1.2 Lo que **no** existe

Es importante decirlo con precisión, porque un documento del repositorio lo dice
mal y esa imprecisión cambia el trabajo:

- **`supabase/migrations/` no existe.** No está «vacío»: el directorio no está
  creado. `.claude/agents/data-architect.md` dice «is still empty» y es
  inexacto **[medido]**. La primera migración de Nomey creará el directorio.
- **`docs/database/` no existe** como directorio, aunque `docs/README.md` lo
  planifica para la Fase 3.
- **`docs/runbooks/local-setup.md` no existe**, y el criterio de cierre 1 de
  3.C exige reconstruir todo el esquema «siguiendo solo el runbook»
  **[medido]**. `docs/README.md` §«Qué falta por escribir» ya lo reconoce como
  pendiente desde la Fase 1.
- **`tests/rls/` no existe**, aunque `tests/README.md` lo dibuja en su árbol
  con la anotación «Fase 3.C».
- **`@supabase/supabase-js` no es dependencia de la app** **[medido]**: no
  aparece ni en `dependencies` ni en `devDependencies` del `package.json` raíz.
  Existe únicamente aislada dentro de `supabase/e11/`.
- **No hay auth de producto, ni esquema, ni RLS, ni tipos generados.**

### 1.3 Lo que está verificado, y con qué evidencia

| Hecho                                                                                      | Evidencia                       |
| ------------------------------------------------------------------------------------------ | ------------------------------- |
| PostgreSQL y PostgREST conservan `BIGINT` y `NUMERIC` exactos; `JSON.parse` los degrada    | E11 · ADR-003 §10               |
| Lo determinante es el **cast a texto**, no el camino de acceso (tabla, vista o RPC)        | E11 · ADR-003 §10               |
| `supabase gen types typescript` emite `number` para `int8` y `numeric`                     | E11 · ADR-003 §10               |
| El origen de `REFERENCES`/`TRIGGER`/`TRUNCATE` sobre tablas nuevas de `public`             | **E12 · §D4 de este documento** |
| `TRUNCATE` es **ejecutable** por `anon` incluso con RLS activada y sin política            | **E12 · `30-executable.sql`**   |
| Una función creada en `public` sin `GRANT` es **invocable por `anon` vía `/rest/v1/rpc/`** | **E12 · `40-data-api.mjs`**     |
| Una política que consulta su propia tabla falla con `42P17 infinite recursion`             | **E12 · sondeo de recursión**   |

### 1.4 Lo que el dominio ya fija, y que el esquema no puede contradecir

- La **identidad de una definición monetaria es opaca** (`Brand<string>`), y
  `domain/` la transporta sin interpretarla. `ids.ts` dice lo mismo de
  `ParticipantId` y `ScopeId`.
- Un **efecto** tiene dimensiones separadas —`scope`, `accountingClass`,
  `balance`, `economic`, `debt`— y la clase **no** determina qué dimensiones
  toca.
- La **deuda es derivada**, no almacenada: `effects/debt.ts` la calcula neteando
  los efectos con dimensión de deuda del ámbito.
- **`DOMAIN_ERROR_CODES` es el contrato** cliente↔servidor; los mensajes no.
- Un gasto de Grupo admite **pagador sin Modo Personal**
  (`derive.ts`, `payerCashMovement?`).

---

## 2 · Contradicciones y huecos detectados

**No los resuelvo aquí.** Se registran y sigo, como manda `AGENTS.md`.

### 2.1 Huecos de estado (precisión documental)

| #   | Hueco                                                                                            | Consecuencia                                                                  |
| --- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| H1  | `.claude/agents/data-architect.md` afirma que `supabase/migrations/` «is still empty»; no existe | Ninguna funcional; conviene corregir el texto para no inducir a error         |
| H2  | `docs/runbooks/local-setup.md` no existe                                                         | **Bloquea el criterio de cierre 1 de 3.C.** Hay que escribirlo                |
| H3  | `tests/rls/` aparece en el árbol de `tests/README.md` pero no existe                             | Ninguna; se crea en 3.C                                                       |
| H4  | `docs/database/` planificado para Fase 3 y sin crear                                             | `database/rls-policies.md` es «de mantenimiento obligatorio en cuanto exista» |

### 2.2 Hueco real en el contrato de errores

**Es el más importante de los detectados y afecta a D7 y a D8.**

`src/domain/errors.ts` declara que **el código de error es el contrato entre la
implementación de referencia y la implementación autoritativa del servidor**, y
`tests/README.md` añade que `errors.test.ts` comprueba que todo código esperado
por un vector existe en `DomainError`.

Pero:

1. `derive.ts` declara explícitamente que **la autorización está fuera de
   `domain/`**. La frontera de escritura tendrá que rechazar operaciones por
   motivos —«no eres el extremo de salida de la transferencia», «no eras
   participante en la fecha efectiva», «el Modo Pareja está en `Cierre`»— para
   los que **no existe ningún `DOMAIN_ERROR_CODE`**.
2. La idempotencia (D8) necesita al menos un código nuevo para el caso
   «mismo identificador, payload distinto», y ese código tampoco existe.

Es decir: **el contrato de errores no tiene sitio previsto para códigos que solo
el servidor puede emitir.** Hay dos salidas razonables —ampliar
`DOMAIN_ERROR_CODES` con una familia de códigos de autorización e idempotencia,
o declarar un segundo espacio de códigos `SERVER_ERROR_CODES` con su propio
contrato y sus propios vectores— y **ninguna es mía**: `src/domain/errors.ts`
está fuera de lo que puedo modificar. **Traspaso explícito**: hace falta una
decisión y un PR sobre `src/domain/errors.ts` antes de que la frontera de
escritura pueda emitir errores estables.

### 2.3 Hueco en un criterio de cierre

El criterio 5 de 3.C dice: «Ningún rol cliente tiene `INSERT`, `UPDATE` ni
`DELETE` sobre operaciones ni efectos, y hay un test que lo demuestra.»

E12 midió que, en `public`, los roles cliente reciben por defecto `TRUNCATE`,
`REFERENCES`, `TRIGGER` y `MAINTAIN` **[medido]**, y que **`TRUNCATE` vacía una
tabla con RLS activada** **[medido]**. Un test que compruebe exactamente lo que
dice el criterio 5 **pasaría con la tabla truncable por `anon`**.

No es una contradicción del roadmap: es un criterio que se escribió antes de
tener la medición. **Propuesta:** extender el criterio 5 a los siete privilegios
de tabla más `MAINTAIN`.

### 2.4 Conflicto entre una fuente externa y `AGENTS.md`

La guía oficial de Supabase para exponer un schema propio recomienda
literalmente `GRANT ALL ON ALL TABLES IN SCHEMA myschema TO anon,
authenticated, service_role;` y un `ALTER DEFAULT PRIVILEGES ... GRANT ALL`
**[doc]**
<https://supabase.com/docs/guides/api/using-custom-schemas>.

Eso concede a `anon` los ocho privilegios de tabla, incluidos los cuatro que
E12 acaba de medir como peligrosos. **Contradice `AGENTS.md` §4** («grants
explícitos y mínimos por rol»). No es una contradicción interna del proyecto,
pero conviene dejarlo escrito: **ese snippet no se copia**. La guía de
endurecimiento del propio Supabase dice lo contrario y es la que se sigue
**[doc]** <https://supabase.com/docs/guides/database/hardening-data-api>.

### 2.5 Aviso de calendario

`supabase/config.toml` documenta el campo `auto_expose_new_tables` y añade que
**«the field is removed on 2026-10-30 once the always-revoked behaviour is
permanent»** **[medido]**, mientras que la referencia de configuración en línea
no documenta ese campo en absoluto **[doc, comprobado]**
<https://supabase.com/docs/guides/local-development/cli/config>.

Consecuencia práctica: la configuración por defecto sobre la que se mide hoy
**va a cambiar de estatus en unas semanas**. Ninguna decisión de 3.C debería
depender de que ese campo exista.

### 2.6 No se han encontrado contradicciones entre ADR-002, ADR-003, `data-model.md`, el glosario y `src/domain/`

Se revisaron en particular: las cinco clases contables, el invariante de
representación única, la regla de no sobrepago de la liquidación, la
participación declarada frente a la calculada, la identidad monetaria opaca y
la separación caja / gasto / deuda. **Todos concuerdan.**

---

## 3 · Arquitectura general propuesta

Una frase: **los datos viven en un schema que la Data API no alcanza, se leen
por vistas que castean a texto y se escriben exclusivamente por funciones
autoritativas.**

> **Estado tras la revisión de 3.C.2.** La **topología** de este diagrama
> —`core` no expuesto, `api` como única superficie, `sec` para helpers, `public`
> sin objetos de Nomey— está **aprobada** (D2). **No está aprobado el mecanismo
> concreto por el que `api` lee `core`**, y por tanto tampoco lo está la línea
> «Cero `GRANT` a `anon` / `authenticated` / `service_role`» sobre `core`: los
> privilegios que ese rol necesite dependen de cómo se resuelva la lectura, y
> eso se decide en **D5/D6**. Léase esa parte del diagrama como **propuesta**,
> no como decisión.

```
                       Cliente móvil (no confiable)
                                  │
              clave publicable + JWT de usuario  →  rol `authenticated`
                                  │
        ┌─────────────────────────┴─────────────────────────┐
        │                   PostgREST                        │
        │      expone SOLO el schema `api`  (config.toml)     │
        └─────────────────────────┬─────────────────────────┘
                                  │
   ┌──────────────────────────────┴──────────────────────────────┐
   │  schema `api`  — EXPUESTO. No contiene ni una sola tabla     │
   │                                                              │
   │   vistas de lectura        →  todo importe casteado a text   │
   │   funciones de escritura   →  SECURITY DEFINER, intención    │
   │                                                              │
   │   GRANT: USAGE a authenticated · SELECT en vistas concretas  │
   │          EXECUTE en funciones concretas                      │
   │          REVOKE EXECUTE ... FROM PUBLIC en TODAS             │
   │          nada para anon                                      │
   └──────────────────────────────┬──────────────────────────────┘
                                  │  (llamada interna, misma transacción)
   ┌──────────────────────────────┴──────────────────────────────┐
   │  schema `core`  — NO EXPUESTO. Sin USAGE para roles cliente  │
   │                                                              │
   │   currency_definition · exchange_rate                        │
   │   scope · participant · participant_user_link · membership   │
   │   operation · operation_version · effect                     │
   │                                                              │
   │   RLS activada en todas (defensa en profundidad)             │
   │   GRANT a roles cliente: PENDIENTE D5/D6, no decidido        │
   │   Triggers que hacen imposible UPDATE y DELETE de hechos     │
   └──────────────────────────────┬──────────────────────────────┘
                                  │
   ┌──────────────────────────────┴──────────────────────────────┐
   │  schema `sec`  — NO EXPUESTO. Frontera de privilegio         │
   │   helpers SECURITY DEFINER de membresía, search_path fijado  │
   └──────────────────────────────────────────────────────────────┘

   schema `public` — deliberadamente VACÍO de objetos de Nomey
```

Las cuatro propiedades que esta forma compra, y que conviene poder enunciar de
una en una:

1. **Ninguna tabla de dominio es alcanzable por la Data API**, porque su schema
   no está expuesto y los roles cliente no tienen `USAGE` sobre él **[medido]**.
2. **Ningún importe puede salir como número JSON**, porque la única superficie
   de lectura son vistas que castean **[medido en E11 que el cast basta]**.
3. **Ningún rol cliente puede escribir un efecto**, porque no tiene `INSERT`
   sobre nada, ni siquiera sobre sus propias filas (ADR-002 §7). La propiedad es
   exigida por el ADR; **el mecanismo de privilegios que la garantiza se decide
   en D3/D5**.
4. **Los privilegios heredados de `public` no tocan a Nomey**, porque Nomey no
   pone nada en `public` **[medido: `pg_default_acl` solo cubre `public`]**.

---

## 4 · Diagrama lógico textual

Entidades en términos de dominio. **Los nombres son propuestas, no decisiones.**

```
 currency_definition                       exchange_rate
 ───────────────────                       ─────────────
 id            (opaca, D1)  ◄──────┐       from_currency  ─┐
 code          ISO visible         │       to_currency    ─┤─► currency_definition
 scale         entero ≥ 0          │       effective_date  │
 (inmutable una vez referenciada)  │       coefficient  NUMERIC exacto
                                   │       rate_scale   smallint
                                   │
 scope  (ámbito financiero)        │
 ─────                             │
 id                                │
 kind          personal | group | couple
 base_currency ────────────────────┤   inmutable tras la 1.ª operación
 status        active | closing    │   (solo couple usa closing)
 created_by                        │
      ▲   ▲                        │
      │   │                        │
      │   └──────────── membership ─────────────┐
      │                 ──────────              │
      │                 scope_id                │
      │                 user_id  ──► auth.users │  relación vigente
      │                 role / joined_at        │
      │                                          │
 participant                                     │
 ───────────                                     │
 id                                              │
 scope_id ───────────────────────────────────────┘
 display_name          ← puede no tener cuenta
      ▲
      │  0..1
 participant_user_link
 ─────────────────────
 participant_id
 user_id  ──► auth.users
 linked_at · linked_by · proof_kind · proof_ref     ← F10 lo llenará

 operation                        operation_version
 ─────────                        ─────────────────
 id                    ◄────────── operation_id
 created_by                        version_no        (1, 2, 3…)
 client_operation_id   (D8)        supersedes_version_id
 intent_fingerprint    (D8)        kind              (personalExpense, groupExpense…)
 current_version_id ──────────►    intent            JSONB: método, pesos, orden de desempate
 created_at                        original_amount_minor  BIGINT
                                   original_currency ──► currency_definition
                                   effective_date
                                   created_by · created_at
                                          ▲
                                          │  1..n   (inmutables)
                                     effect
                                     ──────
                                     id
                                     operation_version_id
                                     scope_id ──────────────► scope
                                     accounting_class  income|expense|transfer|adjustment|settlement
                                     amount_minor      BIGINT
                                     currency_id ───────────► currency_definition
                                     affects_balance   boolean   ─┐ las tres dimensiones
                                     economic_participant_id ─────┤ separadas de ADR-002 §1
                                     debt_debtor_id / debt_creditor_id ─┘
                                     applied_rate_coefficient / applied_rate_scale
```

**Cómo leer el efecto.** No hay un discriminante: `affects_balance`,
`economic_participant_id` y el par deudor/acreedor son **dimensiones
independientes**, exactamente como `effects/effect.ts`. Un `expense` de grupo
sin movimiento de caja tiene `affects_balance = false` y participante
económico; el movimiento de caja del pagador tiene `affects_balance = true` y
ninguna de las otras dos.

**Lo que el diagrama deliberadamente no incluye:** notificaciones, atribución
más allá de `created_by`, acceso residual, ciclo de cierre del Modo Pareja,
invitaciones y reclamación. Son fases posteriores (F10, F13) y meterlas ahora
sería inventar.

---

## 5 · Clasificación persistido / derivado — **D11**

El objetivo es **no crear segundas fuentes de verdad**. La regla de decisión que
propongo, y que se aplica en toda la tabla:

> Se persiste un hecho cuando **el usuario lo declaró** o cuando **su
> recomputación futura podría dar otro resultado**. Todo lo demás se deriva.

El segundo criterio es el importante: un reparto recalculado dentro de un año
con un algoritmo distinto **reinterpretaría un hecho histórico**, que es
exactamente lo que ADR-003 §3 e invariante 22 prohíben.

| Concepto                             | Decisión                              | Por qué                                                                                                              |
| ------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Operación** (identidad lógica)     | **Persistida**                        | Unidad de identidad, idempotencia y versionado (ADR-002 §1)                                                          |
| **Versión de operación**             | **Persistida, inmutable**             | «Corregir es versionar» (ADR-002 §6)                                                                                 |
| **Intención del reparto**            | **Persistida** en la versión          | `data-model.md` §5 exige conservar intención **y** resultado: un 30/30/30/30 no distingue `equal` de `exact_amounts` |
| **Resultado del reparto**            | **Persistido — como efectos**         | Los efectos económicos por participante **son** el resultado. No hace falta una tabla de participaciones aparte      |
| **Efecto**                           | **Persistido, inmutable**             | Es el hecho contable congelado                                                                                       |
| **Importe original**                 | **Persistido** en la versión          | ADR-003 §1: único autoritativo                                                                                       |
| **Importe derivado por ámbito**      | **Persistido** en cada efecto         | ADR-003 §1 lo dice literalmente: «derivado, redondeado, **almacenado**»                                              |
| **Tipo de cambio aplicado**          | **Persistido** en cada efecto         | ADR-003 §4: congelado, uno por conversión, **no** uno por operación                                                  |
| **Catálogo de tipos de cambio**      | **Persistido**                        | ADR-003 consecuencia: hacen falta tipos históricos consultables por fecha efectiva                                   |
| **Definición monetaria**             | **Persistida**, bajo control de Nomey | ADR-003 §3: la metadata no depende en tiempo real de una API externa                                                 |
| **Saldo de un ámbito**               | **Derivado**                          | Suma de `amount_minor` de los efectos con `affects_balance` de las versiones vigentes                                |
| **Deuda**                            | **Derivada**                          | `effects/debt.ts` ya la deriva neteando pares. Almacenarla crearía la segunda fuente de verdad clásica               |
| **Estadísticas**                     | **Derivadas**                         | Lista de admitidos: solo `income` y `expense` con impacto económico (ADR-002 §4)                                     |
| **`Disponible actual`**              | **Derivado**                          | Es el saldo, sujeto a la regla de agregación del glosario                                                            |
| **`Disponible tras saldar`**         | **Derivado**                          | Saldo + posición neta de deuda. **No se calcula si las definiciones monetarias difieren**: no hay cifra que mostrar  |
| **Versión vigente de una operación** | **Puntero persistido** (ver D9)       | Única derivación que propongo materializar, y se justifica abajo                                                     |
| **Caché de saldos**                  | **Fuera de 3.C**                      | Aditiva; no compromete el modelo si llega después                                                                    |

### La única derivación que propongo persistir, y por qué

**`operation.current_version_id`.** La alternativa pura es derivar la versión
vigente como `MAX(version_no)` por operación. Es más limpia conceptualmente y no
crea ninguna segunda fuente de verdad.

La razón técnica concreta para no hacerlo: **todo saldo, toda deuda y toda
estadística filtran por versión vigente.** Con la derivación pura, cada una de
esas consultas necesita un agregado correlacionado o una `LATERAL` por operación
antes de poder tocar los efectos, y eso está en la ruta caliente de la pantalla
principal del producto. Con el puntero, es un `JOIN` por igualdad.

**Cómo se evita la divergencia**, que es la pregunta que hay que responder
siempre que se persiste una derivación:

1. El puntero **solo lo escribe la frontera de escritura**, en la misma
   transacción que crea la versión.
2. Un `CHECK`/trigger exige que la versión apuntada pertenezca a esa operación y
   que su `version_no` sea el mayor existente.
3. Un test de consistencia —consulta al catálogo, no revisión visual— comprueba
   que **no hay ninguna operación cuyo `current_version_id` no sea la de mayor
   `version_no`**. Es una sola consulta y se ejecuta en CI.

Si esa verificación resulta molesta o el volumen no lo justifica, revertir a la
derivación pura es una migración de una columna. **Reversibilidad alta.**
---

## 6 · Las once decisiones

Cada una lleva la misma ficha: **alternativas · recomendación · ventajas ·
inconvenientes · riesgos · reversibilidad · dependencias · ¿aprobación antes de
SQL?**

---

### D1 · Identidad física de una definición monetaria

> ## ✅ APROBADA — **`UUID` fijo y sembrado** (opción A)
>
> ### → Normativa en [ADR-004](../adr/ADR-004-currency-definition-identity.md), `Aceptado`
>
> **La fuente normativa es el ADR, no esta sección.** Lo de aquí es el análisis
> que lo precedió; si ambos difieren, manda el ADR.
>
> Aprobada en la revisión del bloque **3.C.2**. **Sustituye a la recomendación
> del Data Architect**, que era la opción E (`TEXT` opaco). El análisis de
> alternativas se conserva íntegro más abajo como registro de por qué.
>
> **Motivos de la aprobación:**
>
> - la identidad debe seguir siendo **completamente opaca**;
> - `UUID` cruza la frontera hacia TypeScript como **`string`**;
> - evita que alguien interprete semánticamente un identificador como
>   `cd-eur-1` — el riesgo que la opción E solo podía mitigar con un test;
> - es un formato **estándar y estable** para PK/FK;
> - su coste de almacenamiento **no es relevante** frente al beneficio de
>   opacidad y estabilidad;
> - la **baja reversibilidad** de D1 favorece una identidad aburrida, estándar y
>   sin significado.
>
> **Condiciones que forman parte de la aprobación:**
>
> 1. Los `UUID` del catálogo se **fijan en un seed versionado**; no se generan de
>    forma distinta en cada entorno.
> 2. Los mismos `UUID` deben poder **reutilizarse en tests y fixtures**.
> 3. `src/domain/` sigue tratando `CurrencyDefinitionId` como **`Brand<string>`
>    opaco**. La decisión es **de persistencia**, no de dominio.
> 4. **No se parsea, interpreta ni deriva información** del `UUID`.
> 5. `code`, `scale` y demás metadatos siguen siendo **atributos** de la
>    definición monetaria, **nunca parte de su identidad**.
> 6. Sigue vigente la regla de coherencia de `data-model.md` §10: una misma
>    identidad no puede representar metadatos contradictorios.
>
> **Sobre los vectores.** El argumento que sostenía la opción E —evitar traducir
> identidades entre `tests/vectors/` y el servidor— **no justifica usar ids
> semánticos**. La estrategia futura debe permitir que los vectores usen
> **`UUID` fijos y reproducibles como fixtures**, insertados literalmente, **sin
> introducir una capa dinámica de traducción** que pueda ocultar una divergencia.
> Es una restricción de diseño para el transversal A; **no se cambian los
> vectores ahora**.

**Qué está fijado y no se toca.** ADR-003 §3 exige identidad interna estable e
inmutable, distinta del código ISO. `data-model.md` §10 añade que una identidad
estable identifica **una única definición coherente**. `domain/` la trata como
**opaca**: `CurrencyDefinitionId = Brand<string, ...>`, y `currency-definition.ts`
dice literalmente que no implica UUID, ni entero, ni el código ISO.

**Qué está abierto.** El tipo físico de la columna, presente en cada fila con
dinero.

#### Alternativas

| Opción                                    | Tamaño por fila | Reproducible entre entornos      | Opaca      | Cruza la frontera textual |
| ----------------------------------------- | --------------- | -------------------------------- | ---------- | ------------------------- |
| **A · `UUID` sembrado con literales**     | 16 B            | Sí, si el seed fija los valores  | Muy alta   | Ya es `string` en JSON    |
| **B · `SMALLINT`/`INTEGER` de secuencia** | 2–4 B           | Solo si el seed fija los valores | Alta       | Cruza como **número**     |
| **C · Clave natural: el código ISO**      | ~5 B            | Sí                               | Ninguna    | `string`                  |
| **D · Natural versionada, `EUR@1`**       | ~8 B            | Sí                               | Baja       | `string`                  |
| **E · `TEXT` opaco asignado por Nomey**   | ~9–16 B         | Sí, por construcción             | Media–alta | `string`                  |
| **F · Compuesta `(code, version)`**       | 2 columnas      | Sí                               | Ninguna    | `string` + `int`          |

**C está descartada por ADR aceptado**, no por juicio mío: es exactamente la
alternativa C de ADR-003, rechazada porque en los tres casos reales —
redenominación, continuidad con código distinto, y dos definiciones del mismo
código creadas al corregir una errata nuestra — Nomey sumaría importes no
homogéneos y mostraría un total falso sin avisar. **F es C con una columna
extra**: mete el código ISO dentro de la clave foránea de cada fila con dinero,
que es precisamente lo que ADR-003 §3 prohíbe que sea la identidad. Peor que C,
porque además duplica el coste estructural.

**D (`EUR@1`) es mejor que C y peor que E.** Cumple la letra de ADR-003 pero
**invita a que alguien la parsee**: `split('@')[0]` reintroduce el código ISO
como identidad en el primer sitio donde a alguien le venga bien, y el fallo
resultante es silencioso. Es exactamente el modo de fallo contra el que existe
todo el ADR.

**B (entero) tiene la mejor huella** — 2 bytes por fila con dinero frente a 16
del UUID — y es la opción que un DBA elegiría por defecto para un catálogo de
menos de doscientas filas. Sus dos problemas: para ser reproducible entre
entornos hay que **fijar los enteros literalmente en el seed** y desactivar la
secuencia como fuente de verdad (si no, `dev` y `prod` asignan ids distintos a
la misma moneda y los vectores dejan de ser comparables); y cruza la frontera
como **número JSON**, lo que obliga a explicar por qué _ese_ número sí y los
importes no. Numéricamente es seguro —un `smallint` es exacto en `number`—, pero
diluye una regla que gana valor por ser absoluta **[preferencia]**.

**A (UUID sembrado)** es la más opaca y la más difícil de parsear por accidente.
Su coste real no son los 16 bytes, sino la **depuración**: una consulta de
saldos con seis UUID distintos no se lee, y esa fricción se paga todos los días
durante 3.C y 3.D.

#### Recomendación del Data Architect — **E**, no adoptada

> **Registro histórico.** Lo que sigue fue la recomendación del análisis. **La
> revisión de 3.C.2 aprobó A (`UUID` sembrado) en su lugar**, por las razones
> del recuadro de cabecera. Se conserva porque explica los descartes de C, D, F
> y B, que **siguen vigentes**, y porque su condición 3 —el fixture con una
> definición cuyo id no se parece a su código— **se mantiene como exigencia**
> también con `UUID`.

**E · `TEXT` opaco asignado por Nomey, sembrado y con `CHECK` de forma**

```sql
-- SQL ILUSTRATIVO. No es una migración.
create table core.currency_definition (
  id     text        primary key check (id ~ '^[a-z0-9_]{3,32}$'),
  code   text        not null check (code ~ '^[A-Z]{3}$'),
  scale  smallint    not null check (scale >= 0 and scale <= 6),
  ...
);
```

Con tres condiciones que forman parte de la recomendación y sin las cuales no la
sostengo:

1. **Los identificadores se fijan en un seed versionado**, nunca se generan. La
   misma moneda tiene el mismo id en local, en CI y en producción.
2. **Se documenta que el id no tiene estructura semántica**, y `code` sigue
   siendo la columna que se consulta cuando se quiere el código ISO.
3. **El fixture de tests incluye una definición cuyo id no se parece a su
   código** — por ejemplo `cd-eur-0` con código `EUR` conviviendo con
   `cd-eur-1`, que `tests/vectors/currencies.json` **ya tiene**, más al menos
   una donde id y código no guarden ninguna relación. Cualquier implementación
   que parsee el id revienta contra ese vector. Es una defensa **comprobable**,
   no una convención confiada.

**Por qué E y no A.** El argumento decisivo es el transversal A: los vectores
compartidos ya llevan identidades textuales (`cd-eur-1`, `cd-usd-1`,
`cd-jpy-1`, `cd-bhd-1`, `cd-eur-0`). Con `TEXT`, el arnés que ejecuta
`tests/vectors/` contra el servidor **inserta esos mismos valores literalmente**
y compara sin traducir. Con UUID o con enteros hace falta una tabla de
correspondencia dentro del arnés, y **una capa de traducción es exactamente
donde una divergencia puede esconderse** sin que ningún test la vea.

#### Ventajas

- Cero traducción entre vectores y servidor.
- Reproducible entre entornos por construcción, sin depender de secuencias.
- Cruza la frontera textual sin cast y sin excepción a la regla de ADR-003 §6.
- Legible lo justo para depurar.

#### Inconvenientes

- **Es la opción más pesada por fila** después de nada: `text` corto con
  cabecera varlena frente a 2 bytes de un `smallint`. Con `BIGINT` de importe,
  `uuid` de efecto y timestamps, el peso relativo es pequeño, pero es real y no
  lo disimulo.
- **Legible = parseable.** La mitigación es un test, no la imposibilidad.
- Comparaciones e índices sobre `text` frente a enteros: más caros en teoría,
  irrelevantes con un catálogo de este tamaño y con la tabla en caché
  **[inferencia; no medido]**.

#### Riesgos

- **Alguien parsea el id.** Mitigado por el vector trampa.
- **Un id se «corrige»** al descubrir una errata. Está prohibido: la identidad
  es inmutable; una errata de metadata se resuelve creando una definición nueva
  y versionando las operaciones afectadas (ADR-003 §3).
- Colación e `initcap` accidental. Mitigado por el `CHECK` de minúsculas.

#### Reversibilidad

**La peor de las once.** Cambiar el tipo toca cada fila con dinero y cada clave
foránea. Es migrable —hay un camino: columna nueva, backfill, intercambio de
FK— pero es una operación de esquema completa. **Por eso se aprueba antes de
escribir la primera migración.**

#### Dependencias

Condiciona **D6** (cómo cruza la frontera), **D11** (forma del catálogo) y el
**transversal A** (traducción o no traducción de vectores). No depende de
ninguna otra.

#### ¿Aprobación antes de SQL? **Concedida en 3.C.2** — ver el recuadro de cabecera

Las ventajas, inconvenientes, riesgos y reversibilidad de arriba se refieren a la
opción **E**. Con la opción **A** aprobada, cambian así:

| Aspecto          | Con **A · `UUID`** aprobada                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Opacidad         | **Máxima.** No hay nada que parsear; el vector trampa deja de ser la única defensa y pasa a ser refuerzo                        |
| Frontera textual | Cruza como `string` **sin cast**, igual que E                                                                                   |
| Tamaño por fila  | 16 B fijos. Mayor que `smallint`, comparable a `text` corto                                                                     |
| Depuración       | **Peor que E.** Una consulta con varios `UUID` no se lee de un vistazo. Coste diario asumido a cambio de opacidad               |
| Vectores         | Exige que los fixtures usen `UUID` fijos **insertados literalmente**, sin capa de traducción. Restricción para el transversal A |
| Reversibilidad   | **Sigue siendo la peor de las once.** Sin cambio                                                                                |

---

### D2 · Schemas y superficie de la Data API

> ## ✅ APROBADA — topología **B: `core` / `api` / `sec`**
>
> ### → Normativa en [ADR-005](../adr/ADR-005-schema-topology.md), `Aceptado`
>
> **La fuente normativa es el ADR, no esta sección**, y su §4 delimita
> exactamente qué queda sin decidir. Si ambos difieren, manda el ADR.
>
> Aprobada en la revisión del bloque **3.C.2**, con **un recorte explícito de
> alcance**.
>
> **Lo aprobado — responsabilidades:**
>
> | Schema   | Papel                                                                                    |
> | -------- | ---------------------------------------------------------------------------------------- |
> | `core`   | Persistencia real del dominio                                                            |
> | `api`    | **Única** superficie explícita expuesta a la Data API, lecturas y escrituras autorizadas |
> | `sec`    | Helpers internos de seguridad y autorización                                             |
> | `public` | **No contiene tablas de dominio de Nomey**                                               |
>
> **Las tablas contables reales no se exponen directamente por PostgREST.**
> Compatible con ADR-002 —el cliente no es autoridad y no escribe hechos
> contables— y con ADR-003 —ningún importe exacto cruza JSON como `number`—.
>
> ### ⚠️ Lo que esta aprobación **NO** cierra
>
> **No queda aprobada la combinación «vistas con `security_invoker = true` +
> ningún privilegio de cliente sobre `core`».** Esa receta aparece más abajo en
> el análisis y **no está decidida**: si una vista `security_invoker` accede a
> `core`, los privilegios y la RLS efectivos hay que analizarlos correctamente,
> y ese análisis pertenece a **D5 y D6**.
>
> D2 aprueba, por tanto, **solo la topología estructural de schemas**, y **no
> todavía el mecanismo exacto por el que `api` lee `core`**. Alternativas
> razonables que quedan abiertas, sin anticipar la decisión:
>
> - privilegios mínimos sobre `core` combinados con `security_invoker`;
> - funciones controladas como única vía de lectura;
> - roles o intermediarios dedicados;
> - otra solución técnicamente mejor.
>
> **También queda abierto y es separable:** si `public` se mantiene o se retira
> de `api.schemas` en `config.toml`. Pendiente de medición y de decisión
> posterior; no se cierra aquí.

#### Alternativas

**A · Todo en `public`, con grants y RLS estrictos.**

Es lo que la plantilla del CLI deja preparado y lo que hace la mayoría de los
proyectos Supabase. Ventajas reales: `supabase-js` funciona sin configurar
schema, `supabase gen types typescript --local` genera `public` por defecto,
Studio muestra las tablas donde uno las busca, y no hay que mantener una
superficie de vistas.

**B · Dominio en schema no expuesto + superficie explícita en `api`.**

La guía de endurecimiento de Supabase lo recomienda con estas palabras: «A
dedicated schema adds another boundary around your Data API. Objects in a schema
such as `api` define the API surface» **[doc]**
<https://supabase.com/docs/guides/database/hardening-data-api>.

**C · Híbrido: tablas en `public` con RLS, más vistas en `api` para el dinero.**

Es la que aparece cuando alguien quiere la frontera textual sin pagar la
mudanza. Deja las tablas expuestas «por si acaso», que es justo la superficie
que se pretendía cerrar.

#### Evidencia medida que entra directamente aquí

De D4 §pregunta 4:

- Una tabla creada en **`public`** por `postgres` nace con
  `anon=Dxtm/postgres` en su `relacl` **[medido]**.
- Una tabla creada en un **schema propio** nace con `relacl` **NULL**, es decir
  solo el owner, y `has_table_privilege` devuelve `false` para los ocho
  privilegios y los tres roles cliente **[medido]**.
- Sin `USAGE` sobre el schema, `anon` recibe `permission denied for schema
e12_internal` **antes** de que ningún privilegio de tabla entre en juego
  **[medido]**.
- Por HTTP, una tabla de un schema no expuesto devuelve `404 PGRST205`, y con
  `Accept-Profile` devuelve `406 PGRST106` con el mensaje «Only the following
  schemas are exposed: public, graphql_public» **[medido]**.

#### El argumento que decide

No es la seguridad, aunque ayuda. Es este:

> **ADR-003 §6 prohíbe que un importe cruce JSON como número, y E11 midió que
> exponer una tabla con `BIGINT` lo hace.** Luego **ninguna tabla de dominio
> puede exponerse tal cual**, en `public` o donde sea.

Si ninguna tabla puede exponerse, la superficie de la Data API va a ser un
conjunto de vistas y funciones **de todos modos**. En ese caso, tener además las
tablas en el schema expuesto no aporta nada y sí aporta: los `Dxtm` heredados,
la posibilidad de un `GRANT` accidental, y la tentación de que alguien lea la
tabla directamente «solo para este caso».

#### Recomendación — **B, con tres schemas**

| Schema   | Expuesto            | Contiene                                        | `USAGE` para roles cliente |
| -------- | ------------------- | ----------------------------------------------- | -------------------------- |
| `core`   | No                  | Todas las tablas de dominio                     | **Ninguno**                |
| `api`    | **Sí**              | Solo vistas de lectura y funciones de escritura | `authenticated`            |
| `sec`    | No                  | Helpers `SECURITY DEFINER` de membresía         | **Ninguno**                |
| `public` | Sí (queda expuesto) | **Nada de Nomey**                               | El que ya trae             |

Configuración: `api.schemas` debe incluir `api`. **Si `public` se mantiene o se
retira de esa lista queda expresamente pendiente** —ver el recuadro de
cabecera—: retirarlo es posible y **[preferencia]** deseable, pero hay que
comprobar antes si algo del stack local lo necesita —Studio y las extensiones se
apoyan en él— **[no medido]**; si estorba, se deja expuesto y vacío, que ya es
seguro.

Nota medida: `extra_search_path` incluye `public` **siempre**, lo diga o no la
lista **[doc]** <https://supabase.com/docs/guides/local-development/cli/config>.
Eso no expone nada —`db-extra-search-path` «don't get API endpoints» **[doc]**
<https://postgrest.org/en/v12/references/configuration.html>— pero sí importa
para fijar `search_path` en las funciones (D7).

#### Ventajas

- La superficie expuesta es **enumerable**: se puede listar y auditar por
  consulta al catálogo.
- Los privilegios heredados de `public` dejan de aplicarse a Nomey por completo.
- Los tipos generados solo contienen la superficie segura: **`database.ts` nunca
  llegará a tener un `number` de importe** si se genera sobre `api`
  **[inferencia a partir de E11, que midió `string` para columnas casteadas]**.
- Migrar una tabla interna no rompe al cliente si la vista se mantiene.

#### Inconvenientes

- **Cada superficie hay que escribirla.** Una tabla nueva no aparece sola.
- `supabase-js`, cuando llegue, necesita `.schema('api')` o
  `db: { schema: 'api' }`. Hoy no cuesta nada porque la app no usa
  `supabase-js` **[medido]**, pero es una obligación futura que hay que anotar.
- `supabase gen types typescript` necesita `--schema api` explícito.
- Depurar en Studio es menos cómodo: las tablas no están donde Studio mira por
  defecto.
- **Las vistas y la RLS interactúan de forma no obvia.** Una vista normal se
  ejecuta con los privilegios de su propietario y **no aplica la RLS de las
  tablas subyacentes** salvo que se declare `security_invoker = true`. Esto es
  central y se trata en §10.

#### Riesgos

- **Una vista `SECURITY DEFINER` por omisión** que salte la RLS sin que nadie lo
  advierta. Es el riesgo principal de esta opción.
  **La mitigación no está aprobada:** `security_invoker = true` en cada vista más
  un test de catálogo era la propuesta del análisis, pero la revisión de 3.C.2
  la dejó **expresamente abierta**, porque cambia qué privilegios necesita el rol
  cliente sobre `core`. Se decide en **D5/D6**, no aquí.
- Deriva entre la vista y la tabla al evolucionar el esquema.

#### Reversibilidad

**Media.** Mover tablas de `core` a `public` o al revés es
`ALTER TABLE ... SET SCHEMA`, barato. Lo caro es rehacer la superficie expuesta
y regenerar los tipos, que arrastra al cliente cuando exista. **Se decide antes
de la primera migración porque condiciona el nombre completo de todo.**

#### Dependencias

Depende de **D4** (evidencia). Condiciona **D3**, **D6**, **D7** y el criterio
de cierre 3.

#### ¿Aprobación antes de SQL? **Concedida en 3.C.2, solo para la topología** — ver el recuadro de cabecera

---

### D3 · Estrategia de `GRANT`

> ## ✅ APROBADA — privilegio mínimo explícito + saneamiento de defaults
>
> ### → Normativa en [ADR-006](../adr/ADR-006-privilege-model.md), `Aceptado`
>
> **La fuente normativa es el ADR, no esta sección**, que se conserva como el
> análisis que lo precedió. Si ambos difieren, manda el ADR.
>
> Aprobada en la revisión del bloque **3.C.3**, con dos correcciones sobre lo
> escrito aquí: la casilla «Tablas de `core`: —`es **falsa** —hace falta`SELECT`sobre las tablas que alimentan cada vista—, y el`EXECUTE`de`PUBLIC`se ataca con **los dos mecanismos a la vez**, el default global y el`REVOKE`por función. ADR-006 añade además el **invariante de exposición**:`core`y`sec`fuera de los schemas expuestos **y** del`extra_search_path`,
> respaldado por un test.

Consume la evidencia de D4 y la cita explícitamente. **La conclusión es mía; los
hechos son de D4.**

#### Los tres ejes, que E11 ya había separado y E12 confirma

| Capa                | Qué controla                    | Evidencia de que son independientes                                                                         |
| ------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Schema expuesto** | Si la Data API llega al objeto  | Schema no expuesto → `404 PGRST205` / `406 PGRST106`, aunque hubiera grants **[medido, E12 y E11 nivel 1]** |
| **`GRANT`**         | Si el rol puede tocar el objeto | Sin `GRANT` → `401` con `anon`, **`403` con JWT `authenticated`**, código `42501` **[medido]**              |
| **RLS**             | Qué filas, dado el `GRANT`      | Con `GRANT` y RLS sin política → **`200 []`**, indistinguible de «no hay filas» **[medido]**                |

Y una cuarta, que E12 añade y que no estaba enunciada:

| **Privilegios que la RLS no cubre** | `TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN` | La RLS «applies to `ALL`, `SELECT`, `INSERT`, `UPDATE`, `DELETE`» y «operations that apply to the whole table, such as `TRUNCATE` and `REFERENCES`, are not subject to row security» **[doc]** <https://www.postgresql.org/docs/17/ddl-rowsecurity.html> · y `anon` truncó una tabla con RLS activada **[medido]** |

#### Alternativas

**A · Seguir el snippet oficial de schemas propios** (`GRANT ALL ON ALL TABLES
... TO anon, authenticated, service_role`). **Descartada**: concede los ocho
privilegios, incluidos los cuatro que la RLS no cubre. Contradice `AGENTS.md`
§4 y la propia guía de endurecimiento de Supabase.

**B · Grants por objeto, mínimos, escritos a mano en cada migración.** Verboso
y explícito.

**C · Grants por objeto + revocación de los defaults heredados de `public`.**
B, más un saneamiento de la configuración heredada.

#### Recomendación — **C**

Matriz propuesta. `[E]` = lo que se escribe explícitamente en migración.

| Objeto                                | `anon`                             | `authenticated`              | `service_role`               |
| ------------------------------------- | ---------------------------------- | ---------------------------- | ---------------------------- |
| `USAGE` en `core`, `sec`              | —                                  | —                            | —                            |
| `USAGE` en `api`                      | —                                  | `[E]`                        | — (hasta que exista backend) |
| Tablas de `core`                      | —                                  | —                            | —                            |
| Vistas de lectura de `api`            | —                                  | `SELECT` `[E]`, por vista    | —                            |
| Funciones de escritura de `api`       | —                                  | `EXECUTE` `[E]`, por función | —                            |
| Toda función de `api`, `core` y `sec` | `REVOKE EXECUTE FROM PUBLIC` `[E]` | idem                         | idem                         |
| Secuencias                            | —                                  | —                            | —                            |

> **Medición posterior — E13.** La fila «Tablas de `core`: —» **quedó
> desmentida** por [`supabase/e13/`](../../supabase/e13/README.md): una vista
> `security_invoker` exige que el rol cliente tenga **`SELECT` sobre la tabla
> subyacente**. En cambio **no** necesita `USAGE` sobre el schema de
> persistencia, y con el helper en la política tampoco necesita `SELECT` sobre
> `membership` **[medido]**. E13 también midió que ese privilegio **no crea
> ruta HTTP**: ni por PostgREST —`406 PGRST106` / `404 PGRST205`— ni por
> GraphQL, mientras el schema quede fuera de las superficies expuestas y del
> `search_path` de la petición.
>
> **Es un hecho, no una aprobación.** La matriz sigue **sin aprobar** y hay que
> corregirla antes de someterla a revisión.

Y cinco reglas que van con ella:

1. **`anon` no recibe absolutamente nada.** Nomey no tiene superficie anónima de
   producto: no hay lectura pública de nada. Si algún día la hay, se concede
   entonces y se justifica entonces.
2. **`authenticated` nunca recibe `INSERT`, `UPDATE`, `DELETE` ni `TRUNCATE`
   sobre nada.** ADR-002 §7: los roles cliente no escriben efectos ni
   operaciones. Lo escriben las funciones, que corren con otra identidad.
3. **Cada función lleva su `REVOKE EXECUTE ... FROM PUBLIC` en la misma
   migración que la crea.** Esto no es celo: D4 midió que **una función creada
   en `public` sin ningún grant es invocable por `anon` por HTTP y devuelve
   `200`** **[medido]**, porque PostgreSQL concede `EXECUTE` a `PUBLIC` por
   defecto **[doc]** <https://www.postgresql.org/docs/17/ddl-priv.html> y **ese
   default global no se puede revocar con un `ALTER DEFAULT PRIVILEGES` por
   schema** **[doc]**
   <https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html>.
4. **`service_role` no recibe nada en 3.C.** Bypasa la RLS por atributo de rol
   (`rolbypassrls = t` **[medido]**), así que cada `GRANT` que se le dé es
   acceso total a esas filas. `AGENTS.md` §7: la clave secreta no está en el
   bundle y hoy no hay ningún componente backend que la use. Cuando lo haya, se
   le concede lo que ese componente necesite y nada más.
5. **Se revocan los defaults heredados de `public`** aunque Nomey no ponga nada
   allí:

```sql
-- SQL ILUSTRATIVO. No es una migración.
alter default privileges for role postgres in schema public
  revoke all on tables    from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
```

**Por qué revocar algo que no nos afecta.** Porque el coste es dos líneas y
protege contra el error más probable de todos: que dentro de seis meses alguien
cree una tabla en `public` «solo para probar» y nazca con `Dxtm` para `anon`.
Es defensa contra el futuro, no contra el presente **[preferencia]**.

**Advertencia medida sobre esa revocación.** Los `Dxtm` provienen de una entrada
**por schema** creada por el rol `postgres` **[medido]**, y la documentación
dice que lo concedido globalmente no se puede revocar por schema **[doc]**; como
aquí fue concedido por schema, **sí es revocable**. Lo que no está medido es si
una actualización del CLI o del stack lo vuelve a poner **[inferencia]**; por eso
la comprobación va en un test de catálogo, no en la confianza.

#### Ventajas

- Cada privilegio del sistema es rastreable a una línea de una migración.
- El criterio de cierre 5 pasa a ser demostrable por consulta al catálogo.
- Ningún objeto nuevo aparece expuesto por inercia.

#### Inconvenientes

- **Verboso.** Cada vista y cada función añaden tres líneas.
- Un olvido no falla ruidosamente: falla dando **menos** acceso del previsto en
  las lecturas (bueno) o **más** en las funciones (malo). De ahí la regla 3 y su
  test.

#### Riesgos

- **El riesgo dominante es el `EXECUTE` a `PUBLIC` en funciones**, medido y
  documentado. Un `SECURITY DEFINER` que salta la RLS por diseño y que además es
  invocable por `anon` es el peor objeto posible del sistema.
- Falsa sensación de seguridad por «la tabla tiene RLS»: no cubre `TRUNCATE`.

#### Reversibilidad

**Alta.** Un `GRANT` o un `REVOKE` es una migración de una línea. Lo que no es
reversible es el daño hecho mientras el privilegio estuvo abierto.

#### Dependencias

Depende de **D2** (qué schemas hay) y de **D4** (qué hay que revocar).
Condiciona **D6**, **D7** y los tests del transversal C.

#### ¿Aprobación antes de SQL? **Sí**, por ser de las decisiones que el handoff

marca como de baja reversibilidad práctica.

---

### D4 · Privilegios inesperados — **medición, no hipótesis**

Ejecutado de principio a fin en esta sesión contra el stack local
(PostgreSQL 17.6, PostgREST v16.1, GoTrue v2.195.0). Scripts en
[`supabase/e12/`](../../supabase/e12/README.md), objetos con prefijo `e12_`,
**fuera de `supabase/migrations/`**, idempotentes y **retirados por completo al
terminar**.

**D4 entrega hechos. No decide la estrategia de `GRANT`: eso es D3.**

#### Pregunta 1 · ¿Qué privilegios están realmente concedidos?

Sobre una tabla creada en `public` por `postgres` **sin ningún `GRANT`**:

```
relacl = {postgres=arwdDxtm/postgres,
          anon=Dxtm/postgres,
          authenticated=Dxtm/postgres,
          service_role=Dxtm/postgres}
```

`aclexplode` los nombra: **`TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN`**
para los tres roles cliente **[medido]**. Las letras corresponden a
`D` = TRUNCATE, `x` = REFERENCES, `t` = TRIGGER, `m` = MAINTAIN **[doc]**
<https://www.postgresql.org/docs/17/ddl-priv.html>.

`SELECT`, `INSERT`, `UPDATE` y `DELETE` **no** están concedidos: `anon` recibe
`permission denied for table e12_public_plain` al intentar un `SELECT`
**[medido]**.

#### Pregunta 2 · ¿Qué trae PostgreSQL de fábrica?

**Nada de esto.** Una tabla creada en un schema propio nace con `relacl` **NULL**
—solo el owner— y `has_table_privilege` devuelve `false` para los ocho
privilegios y los tres roles **[medido]**. PostgreSQL «grants privileges on some
types of objects to `PUBLIC` by default… **No privileges are granted to `PUBLIC`
by default on tables**, table columns, sequences…» **[doc]**
<https://www.postgresql.org/docs/17/ddl-priv.html>.

**Salvo para funciones**, donde el default de fábrica **sí** concede: «`EXECUTE`
privilege for functions and procedures» a `PUBLIC` **[doc]**, misma URL. Ver
pregunta 6.

#### Pregunta 3 · ¿Qué añade Supabase? — **el origen exacto**

`pg_default_acl` contiene, instalado por el rol **`postgres`** y acotado al
schema **`public`**:

| `defaclrole` | `defaclnamespace` | Tipo       | `defaclacl`                                                                                                 |
| ------------ | ----------------- | ---------- | ----------------------------------------------------------------------------------------------------------- |
| `postgres`   | `public`          | tablas     | `{postgres=arwdDxtm/postgres, anon=Dxtm/postgres, authenticated=Dxtm/postgres, service_role=Dxtm/postgres}` |
| `postgres`   | `public`          | secuencias | `{postgres=rwU/postgres, anon=w/postgres, authenticated=w/postgres, service_role=w/postgres}`               |
| `postgres`   | `public`          | funciones  | `{postgres=X/postgres}`                                                                                     |

**Ese es el origen.** No es herencia de roles y no viene por `PUBLIC`: es una
entrada explícita de `ALTER DEFAULT PRIVILEGES` cuyo `defaclrole` es `postgres`,
es decir que **solo se aplica a los objetos que crea `postgres`** —que es
exactamente el rol con el que corren las migraciones— **[doc]**
<https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html>.

Se descarta la hipótesis alternativa: `anon` y `authenticated` **no son miembros
de ningún rol** del que pudieran heredar (`pg_auth_members` los muestra como
`roleid`, nunca como `member`) **[medido]**.

Interpretación **[inferencia]**: la plantilla concede `ALL` y luego revoca los
cuatro privilegios de datos, dejando el residuo `Dxtm`. Encaja con el
comentario de `config.toml` sobre `auto_expose_new_tables` («When unset, new
entities are NOT auto-exposed») y con la guía de endurecimiento, que describe
grants automáticos en `public` como comportamiento por defecto **[doc]**. Existe
además una segunda entrada, con `defaclrole = supabase_admin`, que **sí** concede
`arwdDxtm` completos; no se aplica a nuestras migraciones porque estas corren
como `postgres` **[medido]**, pero conviene saber que existe.

#### Pregunta 4 · ¿`public` frente a un schema propio?

**No ocurre lo mismo.** Un schema creado por nosotros:

- tablas con `relacl` **NULL**, cero privilegios efectivos para los tres roles
  **[medido]**;
- sin `USAGE`, el acceso falla **antes** de mirar la tabla: `permission denied
for schema e12_internal` **[medido]**;
- por HTTP: `404 PGRST205` sin cabecera, y `406 PGRST106` con
  `Accept-Profile`, con el mensaje «Only the following schemas are exposed:
  public, graphql_public» **[medido]**.

**Es la entrada directa de D2.**

#### Pregunta 5 · ¿`anon` frente a `authenticated`?

**Idénticos en todo lo medido.** Mismo `relacl`, mismos `has_table_privilege`,
mismo resultado en las once operaciones intentadas. `service_role` recibe los
mismos `Dxtm` y tampoco tiene `SELECT` **[medido]**: leyó `403` contra una tabla
sin `GRANT` incluso usando la clave secreta.

La única diferencia observada es de transporte: sin `GRANT`, la clave publicable
devuelve **`401`** y un **JWT `authenticated` devuelve `403`**, ambos con código
PostgreSQL `42501` **[medido]**. Importa para los tests: «un `GRANT` ausente
grita `401`» solo es cierto sin sesión.

#### Pregunta 6 · Listado frente a **ejecutable** — la parte que decide

Diecisiete intentos reales con `set local role`. Resultados literales:

| Intento                                                                         | Rol             | Resultado      | Mensaje exacto de PostgreSQL                                                                           |
| ------------------------------------------------------------------------------- | --------------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| `SELECT` sobre tabla de `public`                                                | `anon`, `auth.` | **DENEGADO**   | `permission denied for table e12_public_plain`                                                         |
| **`TRUNCATE`** sobre tabla de `public`                                          | `anon`, `auth.` | **PUDO**       | filas restantes: 0                                                                                     |
| **`TRUNCATE` sobre tabla con RLS activada y sin política**                      | `anon`          | **PUDO**       | filas restantes: 0                                                                                     |
| `DELETE` sobre esa misma tabla                                                  | `anon`          | DENEGADO       | `permission denied for table e12_public_rls`                                                           |
| **`REFERENCES`**: crear FK hacia la tabla de `public`                           | `anon`          | **PUDO**       | —                                                                                                      |
| `postgres` borra la fila referenciada                                           | `postgres`      | **BLOQUEADO**  | `update or delete on table "e12_public_plain" violates foreign key constraint "e12_fk_probe_ref_fkey"` |
| **`TRIGGER`**: `anon` engancha su función a la tabla                            | `anon`          | **PUDO**       | —                                                                                                      |
| **El código de `anon` corre cuando escribe `postgres`**                         | `postgres`      | **SE EJECUTÓ** | dentro del trigger: `current_user / session_user` = **`postgres / postgres`**                          |
| **`MAINTAIN`**: `ANALYZE` sin tener `SELECT`                                    | `anon`          | **PUDO**       | —                                                                                                      |
| `nextval` sobre secuencia de `public` — **origen: ACL de secuencia, no `Dxtm`** | `anon`          | **PUDO**       | valor: 2                                                                                               |
| **`setval`** sobre esa secuencia — **origen: ACL de secuencia, no `Dxtm`**      | `anon`          | **PUDO**       | reiniciada a 1                                                                                         |
| **`EXECUTE` de función de `public` sin `GRANT`** — **origen: `PUBLIC`**         | `anon`          | **PUDO**       | devolvió su resultado                                                                                  |
| `EXECUTE` de función en schema sin `USAGE`                                      | `anon`          | DENEGADO       | `permission denied for schema e12_internal`                                                            |
| `SELECT` en schema sin `USAGE`                                                  | `anon`          | DENEGADO       | `permission denied for schema e12_internal`                                                            |

**Los hechos que hay que retener** —los puntos 3, 4 y 5 fueron reescritos tras
la **auditoría de causalidad** que se documenta más abajo:

1. **`Dxtm` no es cosmético. Es ejecutable.**
2. **La RLS no protege del `TRUNCATE`.** Coincide exactamente con la
   documentación: «Operations that apply to the whole table, such as `TRUNCATE`
   and `REFERENCES`, are not subject to row security» **[doc]**
   <https://www.postgresql.org/docs/17/ddl-rowsecurity.html>.
3. **`TRIGGER` habilita una escalada _diferida_. No eleva a `anon`.** Redacción
   corregida dos veces; esta es la definitiva.

   **Lo primero, porque una redacción anterior lo omitía: quien ejecutó el DML
   que disparó el trigger fue `postgres`** —medido en el instante del disparo,
   `current_user / session_user = postgres / postgres` **antes** del `insert`—.
   Por tanto observar `current_user = postgres` dentro de una función
   **`SECURITY INVOKER`** (`prosecdef = false`, `proowner = anon`,
   `proacl = NULL` **[medido]**) **no demuestra que `TRIGGER` elevara a `anon`**:
   es exactamente la semántica de invoker, que ejecuta el cuerpo con la
   identidad de quien produce el evento. Presentarlo como «`anon` se elevó» era
   una atribución incorrecta y **se retira**.

   El enunciado causal correcto es este:

   > **Un trigger instalado previamente por `anon` se ejecutó después bajo la
   > identidad efectiva del actor que produjo el evento de disparo.** El riesgo
   > es **diferido** y está **condicionado** a que un actor privilegiado escriba
   > más tarde en esa tabla. El mecanismo no es `SECURITY DEFINER`.

   La documentación enuncia el mismo hecho: «any triggers added to a table or
   view will be executed with the privileges of users who modify it» **[doc]**,
   con aviso equivalente para `REFERENCES` sobre funciones de cast **[doc]**
   <https://www.postgresql.org/docs/17/ddl-priv.html>.

   **Los tres escenarios, separados**, porque no tienen el mismo alcance
   **[medido]**:

   | Escenario                                 | Qué necesita `anon`                                                             | Estado por defecto                                           | Alcance real                                                                                                    |
   | ----------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
   | **A · código controlado por el atacante** | `CREATE` sobre algún schema para escribir la función, más `TRIGGER`             | **No disponible.** `anon` no tiene `CREATE` en ninguna parte | Ejecución **arbitraria** diferida. **En E12 hubo que concederle `CREATE` temporalmente sobre `e12_playground`** |
   | **B · función trigger preexistente**      | `TRIGGER` sobre la tabla (de `Dxtm`) + `EXECUTE` sobre la función (de `PUBLIC`) | **Disponible**                                               | **No** es ejecución arbitraria: depende de qué haga esa función y de que alguien dispare después                |
   | **C · observar o exfiltrar lo ejecutado** | Un sumidero que `anon` pueda **leer**                                           | Depende de los grants; en E12 lo creó la propia sonda        | Ver 3 bis                                                                                                       |

   Con `CREATE` revocado en todas partes, `anon` **no pudo** crear una función
   (`permission denied for schema public`) pero **sí pudo** crear un trigger
   sobre otra tabla de `public` apuntando a una función trigger preexistente
   **[medido]**. Ese es el escenario B, el único disponible de fábrica, y **no
   equivale a ejecución arbitraria de código**.

   **3 bis · Ejecución privilegiada, sí; exfiltración, solo bajo condiciones que
   puso la sonda.** El cuerpo del trigger **leyó** una fila de
   `public.e12_public_plain` sobre la que `anon` no tiene `SELECT`
   (`has_table_privilege('anon', …, 'SELECT') = false` **[medido]**) y la
   escribió en `e12_playground.e12_trigger_log`. `anon` **pudo leerla allí**
   **[medido]** — pero **solo porque `10-objects.sql` le había concedido
   `SELECT` sobre ese sumidero**. Al revocar ese `SELECT`, la lectura pasó a
   `permission denied for table e12_trigger_log` **[medido]**: el código
   privilegiado siguió ejecutándose y `anon` se quedó sin canal.

   > **La distinción que hay que conservar:** la función leyó con los
   > privilegios del actor que disparó el trigger, y **eso no equivale a que
   > `anon` obtuviera los datos**. Sin un sumidero legible por `anon`, lo
   > demostrado es **ejecución privilegiada**, no exfiltración. La exfiltración
   > quedó demostrada **únicamente** en la configuración de la sonda.

4. **`setval` y `nextval` no vienen de `Dxtm`, sino de una entrada de default
   privileges distinta.** Es una atribución que la auditoría de causalidad tuvo
   que separar. La ACL de la secuencia es
   `{postgres=rwU/postgres, anon=w/postgres, …}`: `anon` tiene **solo `UPDATE`**
   sobre la secuencia, sin `USAGE` ni `SELECT`, y **ningún** privilegio sobre la
   tabla que la usa (`SELECT` y `UPDATE` de tabla ambos `false`) **[medido]**. Su
   origen es la fila **`SECUENCIAS / public / postgres`** de `pg_default_acl`
   —`anon=w/postgres`—, que es una entrada **independiente** de la de tablas.
   Comprobado por aislamiento: al revocar **solo** el `UPDATE` de la secuencia,
   `setval` pasó a `permission denied for sequence e12_public_serial_id_seq`
   mientras `has_table_privilege('anon', …, 'TRUNCATE')` seguía siendo `true`
   **[medido]**. `TRUNCATE` y `MAINTAIN` sí son consecuencia de `Dxtm`; `setval`
   **no**.

5. **El `EXECUTE` de funciones viene de `PUBLIC`, y es default de PostgreSQL, no
   de Supabase.** El `proacl` de la función creada en `public` es **`NULL`**, es
   decir el default interno, y `has_function_privilege('public', …, 'EXECUTE')`
   es `true` **[medido]**. Comprobado por aislamiento: tras
   `REVOKE EXECUTE … FROM PUBLIC`, el `proacl` pasó a `{postgres=X/postgres}` y
   `anon` dejó de poder ejecutarla **[medido]**. No es un `GRANT` explícito a
   `anon`, no es herencia de roles, y **no procede del `ALTER DEFAULT
PRIVILEGES` de Supabase**: la entrada `FUNCIONES / public / postgres` vale
   `{postgres=X/postgres}` y, medido, **no se aplicó** a esta función. Es el
   comportamiento de fábrica que la documentación enuncia: «`EXECUTE` privilege
   for functions and procedures» a `PUBLIC` **[doc]**
   <https://www.postgresql.org/docs/17/ddl-priv.html>.

   **La aparente discrepancia queda resuelta.** Una versión anterior de D4
   dejaba abierta esta incógnita: existe una entrada de `pg_default_acl` para
   funciones de `public` creadas por `postgres` cuyo valor
   `{postgres=X/postgres}` parecía implicar `PUBLIC` sin `EXECUTE`, y sin
   embargo el objeto nacía con `proacl` `NULL`. Tres pruebas mínimas la explican
   **[medido]**:

   | Prueba                                                                  | `proacl` resultante                                   | `PUBLIC` con `EXECUTE` |
   | ----------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------- |
   | Función creada **por `postgres`** en `public`                           | `NULL`                                                | **Sí**                 |
   | Función creada **bajo `SET LOCAL ROLE anon`**                           | `NULL`                                                | **Sí**                 |
   | Con `ALTER DEFAULT PRIVILEGES … GRANT EXECUTE … TO anon` (y `rollback`) | `{=X/postgres, postgres=X/postgres, anon=X/postgres}` | **Sí**                 |

   **La hipótesis del rol creador queda descartada:** da igual quién cree la
   función —`postgres` o `anon`—, el resultado es idéntico, y **no existe
   ninguna entrada de `pg_default_acl` para `anon`** (`count = 0`).

   La explicación real es otra: **las entradas de `pg_default_acl` son
   _aditivas_ sobre el default interno de PostgreSQL, y el `EXECUTE` de `PUBLIC`
   sobre funciones forma parte de ese default interno.** La tercera prueba lo
   demuestra: al añadir un `GRANT` que sí cambia algo, el `proacl` explícito
   incluye `anon=X` **y conserva `=X/postgres`, que es precisamente `PUBLIC`**.
   Y el valor `{postgres=X/postgres}` de la plantilla es un **no-op**: concede
   `EXECUTE` al propietario, que ya lo tenía.

   **5 bis · Ámbito del `REVOKE`: global frente a por schema.** Una versión
   anterior de D4 concluía que `ALTER DEFAULT PRIVILEGES` «no basta en este
   stack» y que había que revocar **función por función**. **Era incorrecto y se
   retira:** esa conclusión salía de probar **solo** la forma
   `IN SCHEMA public`. La entrada de la plantilla es **por schema**
   —`defaclnamespace = 2200`, es decir `public`, distinto de `0`— y **no existe
   ninguna entrada global** para `postgres` sobre funciones **[medido]**.

   Tres controles, cada uno en su transacción con `rollback` **[medido]**:

   | Control                                      | `pg_default_acl` resultante                   | `proacl` de la función nueva | `PUBLIC EXECUTE` |
   | -------------------------------------------- | --------------------------------------------- | ---------------------------- | ---------------- |
   | **A** · estado actual                        | `public → {postgres=X/postgres}`              | `NULL`                       | **Sí**           |
   | **B** · `REVOKE … IN SCHEMA public`          | **Sin cambio.** Sigue `{postgres=X/postgres}` | `NULL`                       | **Sí**           |
   | **C** · `REVOKE` **global**, sin `IN SCHEMA` | **Nueva entrada con `defaclnamespace = 0`**   | `{postgres=X/postgres}`      | **No**           |

   En el control C la función nueva quedó **inejecutable por `PUBLIC` y por
   `anon`**, tanto en `public` como en un schema distinto **[medido]**. Y como
   la entrada por schema de `public` **seguía existiendo** durante ese control,
   queda medido también el caso de coexistencia: **el default por schema no
   reintroduce el `PUBLIC EXECUTE` que el global retira**.

   La razón es la que fija la documentación: los default privileges por schema
   **se suman** a los globales y a los cableados, y por eso **no pueden revocar
   un privilegio concedido globalmente** **[doc]**
   <https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html>.

   > **Consecuencia para D3, sin decidirla aquí.** Hay que separar tres cosas:
   >
   > - **Funciones que ya existen:** solo se corrigen con
   >   `REVOKE EXECUTE ON FUNCTION …` sobre cada objeto existente.
   > - **Funciones futuras creadas por un rol:** se protegen con
   >   `ALTER DEFAULT PRIVILEGES FOR ROLE … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`
   >   en su forma **global**, que **sí funciona** —medido en el control C—.
   > - **`IN SCHEMA public` no sirve** para esto: no puede retirar el
   >   `PUBLIC EXECUTE` que concede el default global o cableado.
   >
   > La plantilla de Supabase, por tanto, **no revoca `PUBLIC` sobre funciones**;
   > lo que no es cierto es que no hubiera forma de hacerlo por defaults.

6. **`MAINTAIN` es invisible para `information_schema`.** La vista estándar solo
   conoce siete privilegios —`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`,
   `REFERENCES`, `TRIGGER`— **[medido]**, y `MAINTAIN` no está entre ellos. **Por
   eso E11 vio tres y hay cuatro.** Una auditoría basada en `information_schema`
   no lo vería nunca. `MAINTAIN` permite «`VACUUM`, `ANALYZE`, `CLUSTER`,
   `REFRESH MATERIALIZED VIEW`, `REINDEX`, and `LOCK TABLE`» **[doc]**.

#### Privilegio declarado frente a privilegio ejecutable — resumen mínimo

Añadido por la **auditoría de causalidad**. Todo `[medido]`.

| Privilegio   | ¿Aparece en la ACL?                                  | Operación probada                    | ¿Ejecutable? | Condición adicional necesaria                                                 |
| ------------ | ---------------------------------------------------- | ------------------------------------ | ------------ | ----------------------------------------------------------------------------- |
| `TRUNCATE`   | Sí, `D` en `relacl`                                  | `truncate` sobre tabla con RLS       | **Sí**       | **Ninguna**                                                                   |
| `REFERENCES` | Sí, `x` en `relacl`                                  | `create table … references` la tabla | **Sí**       | `CREATE` sobre algún schema para alojar la tabla que referencia               |
| `TRIGGER`    | Sí, `t` en `relacl`                                  | `create trigger` sobre tabla ajena   | **Sí**       | `EXECUTE` sobre una función trigger. **`CREATE` solo si el código es propio** |
| `MAINTAIN`   | **No** en `information_schema`; sí en `relacl` (`m`) | `analyze` sin tener `SELECT`         | **Sí**       | **Ninguna**                                                                   |

> **Estas cuatro filas hablan de privilegio SQL, no de superficie HTTP.** Son
> dos afirmaciones distintas y la auditoría exige no fundirlas: que PostgREST no
> publique una ruta capaz de ejercer `TRUNCATE` **no elimina el privilegio**,
> solo reduce por dónde se alcanza hoy. Cualquier camino futuro que ejecute SQL
> con estos roles —una función, una extensión, un pooler, un cambio de
> configuración— lo vuelve alcanzable sin que la ACL haya cambiado.

#### Pregunta 7 · Data API frente a SQL directo

**El alcance es distinto en las dos direcciones.**

| Operación                              | Por `psql` como `anon` | Por PostgREST con clave publicable     |
| -------------------------------------- | ---------------------- | -------------------------------------- |
| `SELECT` sin `GRANT`                   | denegado               | `401` código `42501`                   |
| `SELECT` con `GRANT`, RLS sin política | (no probado)           | **`200 []`** — silencioso              |
| `SELECT` con `GRANT`, sin RLS          | permitido              | `200` con la fila                      |
| `TRUNCATE`                             | **permitido**          | **no existe verbo HTTP**               |
| `DELETE` sin filtro                    | permitido si hay grant | `400` `DELETE requires a WHERE clause` |
| `EXECUTE` de función sin `GRANT`       | **permitido**          | **`200`, ejecutada**                   |
| Cualquier cosa en schema no expuesto   | denegado por `USAGE`   | `404` / `406`                          |

Dos consecuencias:

- **La superficie `Dxtm` no es alcanzable por HTTP** con la Data API tal cual:
  PostgREST no expone `TRUNCATE`, `ANALYZE` ni `setval`. Además, `anon`,
  `authenticated` y `service_role` **no pueden iniciar sesión** en PostgreSQL
  (`rolcanlogin = f` **[medido]**); solo `authenticator` puede, y cambia a ellos
  con `SET ROLE`. Es decir: **el riesgo es real como privilegio y hoy tiene
  alcance limitado como ruta**. Decir «no pasa nada» sería falso; decir «es
  explotable desde el móvil» también.
- **La superficie de funciones sí es alcanzable por HTTP, y está abierta por
  defecto.** Es el hallazgo más accionable de D4.

#### Teardown

`99-teardown.sql` ejecutado. Las siete comprobaciones devuelven **0**:
relaciones, schemas, funciones, triggers, políticas, tipos y usuarios de sondeo
`e12*`. `pg_default_acl` quedó **exactamente igual** que en la línea base
**[medido]**. El usuario de prueba creado para medir el rol `authenticated` fue
borrado por el propio script.

**Reverificado de forma independiente** al ejecutar la auditoría de causalidad,
consultando el catálogo sin usar el propio script de teardown: `0` relaciones,
`0` schemas, `0` funciones, `0` triggers y `0` entradas de `pg_default_acl` con
nombre `e12*`; las seis entradas heredadas de `public` siguen con el mismo valor
que en la línea base **[medido]**. La reejecución completa del sondeo, la
auditoría y el segundo teardown **no dejaron residuo**.

#### Alternativas, recomendación y demás — para esta decisión

D4 no es una decisión de diseño sino una medición, pero el encargo pide la misma
ficha, así que:

- **Alternativas consideradas para medirlo:** solo `information_schema` (la que
  usó E11 — **insuficiente**, no ve `MAINTAIN`); solo `has_table_privilege` (ve
  el efectivo pero no el origen); solo intentar las operaciones (ve lo
  ejecutable pero no explica de dónde viene). Se usaron **las cuatro fuentes**
  porque cada una responde una pregunta distinta.
- **Recomendación del Data Architect:** que D3 trate `Dxtm` como **privilegio
  real a revocar**, no como ruido de `information_schema`; y que el
  `REVOKE EXECUTE ... FROM PUBLIC` sobre cada función pase a ser regla dura.
- **Ventajas** de tener esto medido: convierte tres decisiones (D2, D3, D7) de
  opinión en consecuencia.
- **Inconvenientes:** la medición vale para **esta** versión del stack.
- **Riesgos:** que una actualización del CLI reintroduzca los defaults
  **[inferencia]**. Mitigado por test de catálogo.
- **Reversibilidad:** total; no cambia nada del repositorio salvo evidencia.
- **Dependencias:** ninguna. Es entrada de D2 y D3.
- **¿Aprobación antes de SQL?** **No.** Ya está hecha y no modifica el esquema.

---

### D5 · Comprobación de membresía en RLS

> ## ✅ APROBADA — RLS de `core` como autoridad, con helper reducido
>
> ### → Normativa en [ADR-007](../adr/ADR-007-membership-rls.md), `Aceptado`
>
> **La fuente normativa es el ADR, no esta sección.** Si ambos difieren, manda
> el ADR.
>
> Aprobada en la revisión del bloque **3.C.3**, con un cambio de énfasis
> respecto a lo escrito aquí: el helper **no** queda como «excepción única para
> romper la recursión», sino como **mecanismo normal**, porque E13 midió que
> **reduce** los privilegios del cliente —elimina el `SELECT` sobre la tabla de
> membresía— en vez de aumentarlos. Se descartan los claims de membresía y la
> tabla de visibilidad derivada.

> **Medición posterior — E13.** [`supabase/e13/`](../../supabase/e13/README.md)
> midió el supuesto implícito de esta sección: **con una vista
> `security_invoker`, la RLS de la persistencia sí se evalúa con el
> `auth.uid()` de quien consulta**, y una vista ejecutada como su propietario
> **no aplica la RLS en absoluto** —devolvió todas las filas a un no miembro y
> a una sesión sin JWT—. Sobre el helper: basta con **`EXECUTE`, sin `USAGE`**
> sobre su schema, de modo que la política funciona y el usuario **no** puede
> invocarlo directamente; y usarlo en la política **elimina** la necesidad de
> `SELECT` sobre `membership` **[medido]**.
>
> **Son hechos, no una aprobación.** D5 sigue sin aprobar.

#### El problema, enunciado con precisión

Una política sobre `core.effect` necesita saber si `auth.uid()` pertenece al
ámbito del efecto. La información está en `core.membership`. El peligro no es
«hacer un join», es **que una política consulte la tabla que protege**.

Medido en esta sesión: una política `using (exists (select 1 from misma_tabla
...))` falla con **`42P17 · infinite recursion detected in policy for relation`**
**[medido]**. Falla ruidosamente, lo cual es bueno; lo peligroso es la
«solución» de relajar la política para que el error desaparezca.

#### Alternativas

**A · Join directo en la política, con la tabla de membresía protegida por una
política sobre sí misma.**

```sql
-- SQL ILUSTRATIVO. Este es el que recursa si la política de membership
-- necesita a su vez consultar membership.
create policy p on core.membership for select
  using (exists (select 1 from core.membership m
                 where m.scope_id = membership.scope_id
                   and m.user_id = auth.uid()));   -- 42P17
```

**B · Política reestructurada que evita el join sobre sí misma.**

```sql
-- SQL ILUSTRATIVO.
-- membership se protege SIN subconsulta: solo mira su propia columna.
create policy p_own on core.membership for select
  using (user_id = (select auth.uid()));

-- las demás tablas SÍ pueden hacer el join, y no recursan
create policy p on core.effect for select
  using (exists (select 1 from core.membership m
                 where m.scope_id = effect.scope_id
                   and m.user_id = (select auth.uid())));
```

**C · Helper `SECURITY DEFINER`.**

```sql
-- SQL ILUSTRATIVO.
create function sec.is_member(target_scope uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from core.membership m
                     where m.scope_id = target_scope
                       and m.user_id = auth.uid()) $$;
revoke execute on function sec.is_member(uuid) from public;
grant  execute on function sec.is_member(uuid) to authenticated;
```

**D · Claims en el JWT** con la lista de ámbitos del usuario.

**E · Tabla de visibilidad desnormalizada** (`user_id, scope_id`) mantenida por
la frontera de escritura, con política trivial `user_id = auth.uid()`.

#### Análisis

**B es la base correcta y casi nadie la usa.** Funciona porque la política de
`membership` **no consulta `membership`**: mira su propia columna `user_id`. No
hay recursión, no hay `SECURITY DEFINER`, no hay superficie de escalada nueva y
la RLS de `membership` **sí** se aplica dentro de la subconsulta de las demás
políticas, lo cual es correcto y además restringe bien.

**B tiene un límite conocido, y es el que empuja a todo el mundo hacia C.** En
cuanto el producto necesite que un miembro **vea a los demás miembros** del
grupo —y Nomey lo necesita: repartos, deudas, nombres—, la política de
`membership` deja de poder ser `user_id = auth.uid()` y pasa a ser «filas de los
ámbitos a los que pertenezco», que **es** una consulta sobre `membership`. Ahí
aparece el `42P17`.

**C resuelve exactamente ese punto**, y solo ese. `SECURITY DEFINER` salta la
RLS por diseño, así que la subconsulta interna no vuelve a entrar en el
evaluador de políticas. `AGENTS.md` §4 exige revisarlo como frontera de
privilegio y fijar `search_path`; añado dos cautelas propias:

- **La función no debe aceptar el usuario como parámetro.** `is_member(scope)`
  leyendo `auth.uid()` internamente no puede usarse para preguntar por terceros.
  `is_member(scope, user)` sí, y eso es un oráculo de pertenencia gratis.
- **`set search_path = ''` y nombres cualificados**, no `set search_path =
core`. Es relevante aquí porque `extra_search_path` incluye `public`
  **siempre** **[doc]**.

**D (claims) es una decisión de producto disfrazada de técnica**, y así hay que
presentarla. Con la lista de ámbitos en el token, **expulsar a alguien de un
grupo no surte efecto hasta que su token refresca**. En este stack
`auth.jwt_expiry = 3600` **[medido]**: hasta **una hora** de acceso residual a
un ámbito compartido después de haber sido expulsado. Para una app de finanzas
compartidas entre personas que se conocen —y que se dejan de conocer— eso no es
un detalle de rendimiento: es una promesa de producto. **Quien decide si Nomey
acepta esa ventana no es el Data Architect.** Técnicamente es la opción más
rápida —cero consultas por fila— y esa ventaja es real.

**E es C sin `SECURITY DEFINER`**, a cambio de mantener una tabla derivada
transaccionalmente. Cambia superficie de escalada por una segunda fuente de
verdad, justo lo que D11 intenta evitar. Es la opción a reconsiderar **si** el
rendimiento de C resulta insuficiente y hay medición que lo respalde.

#### Rendimiento

`auth.uid()` es **`STABLE` y `SECURITY INVOKER`**, y su cuerpo solo lee
`current_setting('request.jwt.claims')` **[medido]**. Envolverla como
`(select auth.uid())` la convierte en un `InitPlan` evaluado una vez por
consulta en lugar de por fila; es la recomendación documentada de Supabase para
políticas y aparece en todos los ejemplos de arriba **[preferencia respaldada por
doc]**. Un helper `is_member(scope_id)` **sí** es correlacionado —depende de la
fila— y no se puede izar igual; ahí lo que decide es el índice
`(scope_id, user_id)` sobre `membership`. **No medido en este stack**; hay que
medirlo con volumen antes de dar el rendimiento por bueno.

#### Recomendación — **B como forma por defecto, C como excepción única y revisada**

Concretamente:

1. Todas las políticas de tablas de dominio usan la forma **B**: `EXISTS` contra
   `core.membership` con `(select auth.uid())`.
2. **Una sola** función `SECURITY DEFINER`, `sec.is_member(scope)`, existente
   únicamente para romper la recursión en la política de `core.membership`
   (y, si hace falta, de `core.participant`).
3. **No se usan claims en 3.C.** Si el producto decide más adelante aceptar la
   ventana de refresco, migrar de B/C a D es un cambio de políticas, no de
   datos.
4. Cada `SECURITY DEFINER` del sistema lleva: `stable`, `set search_path = ''`,
   nombres cualificados, `revoke execute from public`, `grant execute to
authenticated`, y una entrada en `docs/security/`.

#### Ventajas

- Expulsión **inmediata**: el siguiente `SELECT` ya no ve el ámbito.
- Superficie de escalada reducida a **una** función auditable.
- Sin segunda fuente de verdad.

#### Inconvenientes

- Una consulta a `membership` por fila evaluada, mitigada por índice.
- Hay que explicar por qué una política usa join y otra usa función; sin este
  documento, parece inconsistencia.

#### Riesgos

- **Que alguien «arregle» un `42P17` relajando la política.** Es el fallo que
  `AGENTS.md` §4 llama peor que el bug. Mitigación: test de aislamiento que
  compruebe el **caso positivo y el negativo**, de modo que una política
  relajada a `using (true)` rompa el test negativo.
- **Que el helper crezca.** Un `SECURITY DEFINER` que hoy responde `boolean` y
  mañana devuelve filas es otra cosa. Regla: devuelve `boolean`, no acepta
  identidad ajena, no se generaliza.

#### Reversibilidad

**Alta.** Las políticas se sustituyen con `drop policy` / `create policy` en una
migración y no tocan datos. Migrar a claims después es viable.

#### Dependencias

Depende de **D2** (dónde vive `sec`), **D3** (`EXECUTE`) y **D10** (si la
membresía se ancla a usuario o a participante). Condiciona §10 y §11.

#### ¿Aprobación antes de SQL? **Sí**, sobre todo por el punto 3: descartar

claims es aceptar coste de consulta a cambio de frescura, y esa es una decisión
de producto.
---

### D6 · Frontera textual de ADR-003 §6 (T7)

> ## ✅ APROBADA — estrategia combinada, con una corrección medida
>
> ### → Normativa en [ADR-008](../adr/ADR-008-exact-data-boundary.md), `Aceptado`
>
> **La fuente normativa es el ADR, no esta sección**, que se conserva como el
> análisis que lo precedió. Si ambos difieren, manda el ADR.
>
> Aprobada en la revisión del bloque **3.C.4**, con **tres correcciones** sobre
> lo escrito aquí, todas respaldadas por
> [`supabase/e14/`](../../supabase/e14/README.md):
>
> 1. **Los parámetros `text` no son una garantía de escritura.** E14 midió que
>    PostgREST **coacciona un número JSON a texto**, así que un parámetro `text`
>    no distingue un cliente correcto de uno que ya degradó el valor. La norma
>    pasa a ser el **invariante** —los valores exactos cruzan como `string` y la
>    frontera debe poder comprobar el tipo JSON original—, y **el mecanismo se
>    delega a D7**. Que `jsonb_typeof` pueda hacerlo es evidencia, **no** una
>    decisión de que D7 use `jsonb`.
> 2. **El tipo de cambio viaja como `coefficient` (string) + `scale` (entero
>    acotado)**, alineado con el dominio y con `tests/vectors/`. No se introduce
>    el decimal canónico como segundo contrato ni se añade constructor alguno.
> 3. **No se limita el producto.** Filtrar, ordenar y agregar por importe
>    **siguen permitidos**; lo que cambia es que ocurren numéricamente **dentro
>    del servidor**, antes de serializar.
>
> `UUID` no necesita protección textual: cruza como `string` de forma natural.

**Lo que E11 dejó fijado y no se rediscute:** el comportamiento por defecto
**no** cumple T7; el `BIGINT` por encima de 2^53 se degrada en silencio con HTTP
200; **lo determinante es el cast a texto, no el camino de acceso** —un RPC que
devuelve `bigint` sin castear falla igual que una tabla—; y
`supabase gen types typescript` emite `number` para `int8` y `numeric`.

**Lo que falta decidir:** qué objeto produce el cast, y **en las dos
direcciones**.

#### La distinción que el handoff pide subrayar: lectura ≠ escritura

| Dirección              | Qué hay que impedir                                                  | Dónde puede fallar                                                        |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Servidor → cliente** | Que un importe **llegue** como número JSON y `JSON.parse` lo degrade | Cualquier columna `int8`/`numeric` alcanzable: tabla, vista sin cast, RPC |
| **Cliente → servidor** | Que un importe **salga** como número y llegue ya degradado           | Parámetro de RPC tipado `bigint`/`numeric`; cuerpo de un `INSERT`         |

**La segunda es la que se olvida.** Un cliente que hace
`JSON.stringify({ amount: 9007199254740993 })` envía `9007199254740992`, y el
servidor lo recibe exacto… pero exacto **del valor equivocado**. Ningún cast del
lado servidor lo arregla, porque la pérdida ocurrió antes.

#### Alternativas

**A · Vistas con `::text` para leer, tablas cerradas.** Cubre la lectura.

**B · RPC para todo**, leer y escribir, devolviendo `json`/`text` construidos.

**C · Adaptador de cliente** que reserializa. **Descartada como mecanismo
único, y el motivo es determinante:** cuando el adaptador recibe el objeto, el
`JSON.parse` de la respuesta HTTP **ya ocurrió**. No hay nada que recuperar. Un
adaptador solo funciona si el valor le llega como `string`, es decir **si A o B
ya lo garantizaron**. Es complemento, no sustituto.

**D · Combinación:** vistas casteadas para leer, RPC con parámetros `text` para
escribir, adaptador de cliente que construye `bigint`/`Money` en la frontera del
dominio.

#### Recomendación — **D**

1. **Lectura:** todas las vistas de `api` exponen los importes como
   `amount_minor text` (`amount_minor::text`) y los tipos de cambio como
   `text`. **Ninguna columna `int8` o `numeric` es alcanzable desde `api`.**
2. **Escritura:** los parámetros monetarios de las funciones de `api` se tipan
   **`text`**, y la función valida con expresión regular antes de castear:

```sql
-- SQL ILUSTRATIVO. No es una migración.
create function api.record_personal_expense(
  p_client_operation_id uuid,
  p_scope_id            uuid,
  p_amount_minor        text,      -- text, NO bigint
  p_currency_id         text,
  p_effective_date      date
) returns jsonb ...
-- dentro:
--   if p_amount_minor !~ '^-?[0-9]{1,19}$' then raise ... end if;
--   v_amount := p_amount_minor::bigint;
```

3. **Cliente:** el adaptador convierte `string → bigint` al entrar en `domain/`
   y `bigint → string` al salir, que es lo que ADR-003 §6 ya exige.
4. **Tipos generados:** `supabase gen types typescript --local --schema api`.
   Como en `api` no hay `int8`, `database.ts` **no puede** contener un `number`
   de importe. Sigue siendo referencia estructural, no frontera —ADR-003 lo dice
   y no cambia—, pero deja de ser una trampa. **`src/types/database.ts` no se
   edita a mano bajo ninguna circunstancia.**

#### Lo que había que verificar — **MEDIDO en E14**

La pregunta abierta era: si un cliente envía un número JSON a un parámetro
declarado `text`, ¿PostgREST lo rechaza o lo coacciona?

**Lo coacciona.** Los cinco casos —string grande, number grande, number normal,
decimal y `null`— se aceptan con **HTTP 200**, y PostgREST conserva
**exactamente** los dígitos recibidos. No degrada nada; tampoco exige que el
tipo JSON original fuese `string` **[medido,
[`supabase/e14/`](../../supabase/e14/README.md)]**.

Dos consecuencias, y la segunda invalida el punto 2 de arriba tal como estaba
escrito:

- **La degradación vive en el cliente.** `JSON.stringify({ v: 9007199254740993 })`
  emite `{"v":9007199254740992}` **[medido]**. El servidor recibiría una cadena
  exacta **del valor equivocado**, y la validación por expresión regular la
  aceptaría sin pestañear: es **necesaria pero insuficiente**.
- **El tipo JSON original sí es observable** con un payload `jsonb`
  —`jsonb_typeof` distingue `string`, `number` y `null` sobre los mismos bytes
  **[medido]**—. Eso demuestra que el invariante **es exigible**; **qué
  mecanismo lo exige pertenece a D7** y ADR-008 lo delega expresamente.

#### Ventajas

- Una regla enunciable en una línea: **en `api` no hay `int8` ni `numeric`**, y
  es comprobable por consulta al catálogo.
- Cubre las dos direcciones.
- No depende de que nadie recuerde castear: si la tabla no es alcanzable, no hay
  camino sin cast.

#### Inconvenientes

- **Cada columna monetaria se escribe dos veces**: una en la tabla, otra en la
  vista.
- Los filtros y ordenaciones sobre `amount_minor` en la vista operan sobre
  `text`: `?amount_minor=gt.100` compararía lexicográficamente. **Trampa real.**
  Mitigación: exponer también una columna auxiliar **no monetaria** para
  ordenación si hace falta, o —mejor— que la ordenación y la agregación ocurran
  **dentro** del servidor y el cliente no filtre por importe **[preferencia]**.
- Agregar del lado cliente sobre las columnas textuales deja de ser posible.
  **Corregido en la revisión de 3.C.4:** una redacción anterior remitía a «§8,
  `max_rows`», una sección que **nunca se escribió**. El dato de fondo es
  correcto —`max_rows = 1000` en `config.toml`—, pero no había tal referencia.
  Y la consecuencia **no** es que Nomey no pueda agregar por importe: es que la
  agregación ocurre **en el servidor**, sobre los tipos exactos (ADR-008 §6).

#### Riesgos

- Una vista futura que olvide el cast. **Mitigación: test de catálogo** que falle
  si alguna columna alcanzable de `api` tiene tipo `int8` o `numeric`.
- Un `CHECK` de forma demasiado laxo que acepte `+007` o `1e3`.

#### Reversibilidad

**Alta** para el mecanismo (las vistas se reescriben), **baja** para la decisión
de fondo, que ya la tomó ADR-003 y no está en discusión.

#### Dependencias

Depende de **D1** (si la identidad monetaria es `text`, cruza sin cast) y de
**D2** (si no hay tablas expuestas, no hay camino sin cast). Condiciona **D7**
(tipos de los parámetros) y el transversal A.

#### ¿Aprobación antes de SQL? **Recomendable pero no bloqueante.** El _qué_ lo

fija ADR-003; aquí solo se elige el mecanismo, y es reversible.

---

### D7 · Frontera de escritura autoritativa

> ## ✅ APROBADA — funciones por clase, payload `jsonb`, writer dedicado bajo RLS
>
> ### → Normativa en [ADR-009](../adr/ADR-009-authoritative-write-boundary.md), `Aceptado`
>
> **La fuente normativa es el ADR, no esta sección.** Aprobada en la revisión de
> **3.C.5**, con **tres correcciones medidas** sobre lo escrito aquí:
>
> 1. **El payload es `jsonb`, no parámetros tipados.** E14 midió que un
>    parámetro `text` no conserva el tipo JSON original, así que la forma
>    propuesta aquí no podía cumplir ADR-008 §3.
> 2. **La afirmación de que «dentro de un `SECURITY DEFINER` la RLS no protege
>    nada» es falsa** con el writer aprobado. E16 midió que un owner que no es
>    propietario de la tabla y no tiene `BYPASSRLS` **sigue sometido a RLS**, y
>    que una política `WITH CHECK` **detuvo una escritura indebida del writer**.
>    Hay segunda barrera.
> 3. **El FX no se resuelve automáticamente «del catálogo».** ADR-003 dejó fuera
>    de alcance el proveedor y la regla de selección; ADR-009 §8 separa lo
>    decidido de lo que no.
>
> Además, el actor **no** se obtiene con `auth.uid()`: E16 midió que falla para
> un writer de mínimo privilegio. Se obtiene de los claims de la petición.

**Lo que ya está decidido y no se rediscute** (ADR-002 §7, `data-model.md` §9):
el cliente envía **intención**, no resultado contable; una función del servidor
valida y genera los efectos **atómicamente**; los roles cliente **no** tienen
permisos de escritura sobre operaciones ni efectos.

**Esto es diseño conceptual. No se implementa en esta tarea.**

#### La pregunta de fondo: ¿dónde vive el cálculo?

**Alternativa A · Función en la base de datos (SQL/PL/pgSQL).**

**Alternativa B · Edge Function en TypeScript que importa `src/domain/`.**

B tiene una ventaja que hay que reconocer sin rebajarla: **elimina la
duplicación del cálculo por construcción.** ADR-002 aceptó explícitamente esa
duplicación como coste («el cálculo del reparto existe dos veces… se mitiga con
vectores de prueba compartidos; no se elimina»), y B la eliminaría.

Y tiene dos costes que la descartan como frontera principal:

1. **Atomicidad.** La operación necesita, en **una sola transacción**: comprobar
   idempotencia, derivar la deuda pendiente —obligatorio por la regla de no
   sobrepago, `data-model.md` §3—, resolver el tipo de cambio histórico, insertar
   la operación, la versión y todos los efectos, y actualizar el puntero de
   versión vigente. Una Edge Function que hable por PostgREST **no tiene
   transacción de varias peticiones**. Acabaría llamando a una función de base de
   datos para conseguirla, con lo que A vuelve por la puerta de atrás y B queda
   como una capa HTTP intermedia sin ganancia.
2. **Acopla el servidor al bundle del cliente.** `src/domain/` pasaría a ser
   artefacto desplegado; una corrección de dominio obligaría a desplegar
   servidor y app coordinadamente, y `domain/` dejaría de ser puro para pasar a
   tener un consumidor de producción con su propio ciclo de vida.

**Recomendación: A**, con esta consecuencia asumida y escrita: **la paridad
entre `domain/` y el servidor se garantiza con los vectores (transversal A), no
compartiendo código.** Es exactamente lo que ADR-002 §7 previó.

#### Forma de la superficie

**Alternativa A1 · Una función genérica** `api.record_operation(intent jsonb)`.
Menos objetos, un solo `GRANT`, y toda la validación por dentro. Inconvenientes:
los tipos generados no dicen nada útil, la validación de forma se hace a mano
sobre JSONB, y un solo `EXECUTE` abre todas las operaciones a la vez.

**Alternativa A2 · Una función por clase de operación**, con parámetros
tipados: `record_personal_expense`, `record_group_expense`,
`record_debt_settlement`, `record_internal_transfer`,
`record_external_transfer`, `record_adjustment`, `correct_operation`.

**Recomendación: A2.** Los `GRANT` de `EXECUTE` pasan a ser granulares —se puede
conceder liquidar y no transferir—, los tipos generados describen la intención, y
cada función valida lo suyo. Coste: más objetos y helpers internos compartidos en
`core`/`sec`.

#### Anatomía propuesta de una función de escritura

Orden deliberado: **lo barato y lo denegante primero**.

```
1. Autenticación      auth.uid() no nulo, si no -> error
2. Idempotencia       buscar (created_by, client_operation_id)
                      · encontrada y misma huella -> devolver el resultado original y SALIR
                      · encontrada y huella distinta -> error de reutilización de clave
3. Autorización       ¿puede este usuario producir estos efectos?
                      · ámbito personal -> es suyo
                      · grupo -> membresía activa
                      · transferencia directa -> es el extremo de SALIDA (invariante 14)
                      · liquidación por transferencia -> es el DEUDOR
                      · corrección -> reglas de data-model.md §7
4. Validación         la lista completa de data-model.md §9:
                      pagador único e incluido entre los participantes ·
                      participaciones DECLARADAS positivas ·
                      exact_amounts de suma exacta ·
                      participantes válidos en la fecha efectiva ·
                      moneda base del ámbito coherente ·
                      DERIVAR LA DEUDA PENDIENTE y comprobar que la liquidación
                      no la supera, DENTRO de esta misma transacción
5. Resolución FX      tipo por FECHA EFECTIVA, del catálogo, no del cliente
6. Derivación         reparto por mayor resto y efectos, reproduciendo domain/
7. Persistencia       operation · operation_version · effect(s) · current_version_id
8. Retorno            identificadores y el resultado, con importes como TEXT
```

**El paso 4 tiene un requisito que no es opcional:** derivar la deuda pendiente
dentro de la transacción, con el bloqueo adecuado. Sin bloqueo, dos
liquidaciones simultáneas de 20 sobre una deuda de 30 pasan las dos y producen
un sobrepago que ninguna validación vio. **Propuesta:** `SELECT ... FOR UPDATE`
sobre la fila del ámbito, o un `advisory lock` por par (ámbito, deudor,
acreedor). **No medido**; hay que elegirlo con una prueba de concurrencia.

#### Privilegios y `search_path`

```sql
-- SQL ILUSTRATIVO. No es una migración.
create function api.record_debt_settlement(...) returns jsonb
language plpgsql
security definer
set search_path = ''            -- vacío, y todos los nombres cualificados
as $$ ... $$;

revoke execute on function api.record_debt_settlement(...) from public;   -- OBLIGATORIO
grant  execute on function api.record_debt_settlement(...) to authenticated;
```

El `revoke` **no es opcional**: D4 midió que sin él la función es invocable por
`anon` vía `/rest/v1/rpc/` con `200` **[medido]**.

`AGENTS.md` §4 recuerda que **la RLS no aplica a funciones**. Corolario incómodo
y necesario: dentro de un `SECURITY DEFINER` propiedad del owner, **la RLS de
`core` no protege nada**. La autorización del paso 3 **es** la protección. Si el
paso 3 está mal, no hay segunda red.

#### Códigos de error

Reutilizar `DOMAIN_ERROR_CODES` verbatim para todo lo que `domain/` ya cubre
—`SPLIT_EXACT_AMOUNTS_MISMATCH`, `SETTLEMENT_EXCEEDS_DEBT`,
`MONEY_CURRENCY_MISMATCH`…—. Dos opciones de transporte:

- **Opción 1:** `raise exception using errcode = 'P0001', message = <código>`,
  y el detalle humano en `detail`. El cliente lee `message` como código.
- **Opción 2:** cuerpo JSON estructurado en `message`, que PostgREST propaga.

**Recomendación: opción 1**, por ser la más simple de comparar en los vectores.
**Hay que verificar cómo PostgREST mapea `RAISE` a estado HTTP y a cuerpo en la
versión v16.1 antes de fijarlo [no medido].**

**Y el hueco de §2.2 sigue abierto:** los códigos de autorización y de
idempotencia **no existen** en `DOMAIN_ERROR_CODES`, y `src/domain/errors.ts`
está fuera de lo que puedo modificar. **Traspaso.**

#### Ventajas

- Atomicidad real, incluida la derivación de la deuda pendiente.
- Superficie de escritura enumerable y con `EXECUTE` granular.
- El cliente no puede afirmar un resultado contable.

#### Inconvenientes

- **El cálculo de reparto se escribe por segunda vez, en PL/pgSQL**, incluido el
  mayor resto con desempate al pagador y orden estable. Es trabajo real y
  delicado, y ADR-002 lo dio por asumido.
- PL/pgSQL es peor lenguaje que TypeScript para esto, y se prueba peor.
- Depurar una `SECURITY DEFINER` es incómodo.

#### Riesgos

- **Es el objeto de mayor riesgo del sistema.** Salta la RLS por diseño.
- Un `search_path` no fijado, con `public` siempre en el camino **[doc]**.
- Deriva silenciosa respecto a `domain/`: **el único detector es el transversal A**.
- Concurrencia en la derivación de la deuda pendiente.

#### Reversibilidad

**Media.** Las funciones se sustituyen sin migrar datos, pero su **firma** es
contrato con el cliente. Cambiarla obliga a versionar la API.

#### Dependencias

Depende de **D1**, **D2**, **D3**, **D6**, **D8**, **D9** y **D11**. Es la
decisión con más dependencias del conjunto y **la última que debe resolverse**.

#### ¿Aprobación antes de SQL? **Sí**, al menos la elección A2 y el contrato de

errores.

---

### D8 · Idempotencia — **origen cliente, y solo ese**

> ## ✅ APROBADA — UUID de cliente, comparación solo en servidor
>
> ### → Normativa en [ADR-010](../adr/ADR-010-client-operation-idempotency.md), `Aceptado`
>
> **La fuente normativa es el ADR, no esta sección.** Aprobada en la revisión de
> **3.C.5**, con **tres correcciones**:
>
> 1. **El cliente no calcula `intent_fingerprint`.** Solo genera, persiste y
>    reutiliza el UUID. Toda comparación vive en el servidor, lo que elimina el
>    riesgo —que esta misma sección declaraba— de una canonicalización divergente.
> 2. **La unicidad abarca todas las clases de operación**, sin namespace por
>    endpoint: misma clave en otra clase es conflicto.
> 3. **El replay no exige autorización actual sobre el ámbito.** Exigirla
>    rompería la idempotencia. Devuelve un **envelope mínimo** —identificador y
>    `already_processed`— y nada del contenido.
>
> Y una afirmación retirada: la captura de `unique_violation` **no es «el único
> patrón libre de carreras»**. E15 midió que `ON CONFLICT` lo resuelve igual de
> bien.

Invariante 19: toda operación monetaria reintentable es idempotente, **con
garantía efectiva para su origen**. `AGENTS.md` §3 dice que cada origen puede
necesitar un mecanismo distinto.

> **Alcance de esta decisión: exclusivamente el origen «entrada desde el
> cliente».** Recurrencias, importaciones bancarias y operaciones originadas en
> backend **quedan abiertas** y no se prejuzgan aquí. Aplicarles este mecanismo
> sin analizarlas sería inventar.

#### Alternativas para la clave

| Opción                                              | Valoración                                                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **A · UUID generado por el cliente**                | El candidato natural. `AGENTS.md` §3 lo llama `client_id` como nombre de trabajo                                      |
| **B · Huella del contenido** (hash de la intención) | Sin identificador. **Descartada**: dos gastos idénticos legítimos —dos cafés de 1,20 el mismo día— colapsarían en uno |
| **C · Identificador servidor pedido antes**         | Una llamada previa que reserva un id. **Descartada**: rompe la entrada sin conexión, que es el caso que motiva todo   |
| **D · Ventana temporal de deduplicación**           | «Ignora lo idéntico en 5 minutos». **Descartada**: heurística, y falla en los dos sentidos                            |

**A**, sin discusión seria.

#### Ámbito de unicidad — la parte que sí tiene enjundia

| Opción                                         | Consecuencia                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Global** `UNIQUE (client_id)`                | Un usuario puede **quemar** una clave ajena y bloquear la operación de otro; y una colisión revela que la clave existe. Vector pequeño pero real  |
| **Por actor** `UNIQUE (created_by, client_id)` | El actor está autenticado y no se puede falsear: sale de `auth.uid()`, no del cuerpo. Aísla por completo a los usuarios entre sí                  |
| **Por ámbito** `UNIQUE (scope_id, client_id)`  | **Incorrecta**: una operación alcanza varios ámbitos —una transferencia toca dos, un gasto de grupo toca grupo y Modo Personal—. No hay un ámbito |

**Recomendación: por actor.**

#### Comportamiento ante reintento

**Devolver el resultado original**, no un error. Es lo que hace segura la
reintentabilidad offline: un reintento tras un `timeout` de red debe ser
indistinguible del éxito.

#### Mismo identificador, payload distinto — **el caso peligroso**

Tres respuestas posibles:

1. **Devolver el original en silencio.** Peligrosa: si el cliente reutilizó la
   clave por un bug, una operación real **desaparece sin rastro** y el usuario
   ve un importe que no es el que introdujo.
2. **Error siempre.** Seguro, pero exige distinguir «payload distinto» de
   «payload igual», es decir: hace falta la comparación de todos modos.
3. **Comparar huella de la intención**: igual → devolver el original; distinta →
   **error explícito**.

**Recomendación: 3.** Se persiste `intent_fingerprint`, un hash del payload
canonicalizado —claves ordenadas, importes como string, sin campos volátiles—.
El error necesita un código nuevo; nombre propuesto
**`IDEMPOTENCY_KEY_REUSED`**, y **añadirlo a `DOMAIN_ERROR_CODES` no está en mis
manos** (§2.2).

#### Qué hay que almacenar para responder a un reintento sin recalcular

En la tabla `operation`: `created_by`, `client_operation_id`,
`intent_fingerprint`, `current_version_id`, `created_at`. Con eso la respuesta al
reintento se **lee**, no se recomputa. Nada más hace falta: el resultado se
obtiene de las vistas de lectura a partir de `current_version_id`.

#### Dónde se aplica la unicidad

**En un índice único, no en un `SELECT` previo.** Un `select … if not found then
insert` tiene una carrera clásica entre dos reintentos simultáneos. La función
inserta y **captura `unique_violation`**, y en ese caso lee y devuelve el
original. Es el patrón correcto y el único libre de carreras sin serializar.

```sql
-- SQL ILUSTRATIVO. No es una migración.
alter table core.operation
  add constraint operation_client_key_unique
  unique (created_by, client_operation_id);
```

#### Ventajas

- Cero configuración para el cliente más allá de generar un UUID.
- Aislamiento entre usuarios por construcción.
- Libre de carreras.
- No cierra la puerta a otros orígenes: una operación de otro origen puede
  llevar `created_by` del actor de sistema y su propia clave.

#### Inconvenientes

- Depende de que el cliente **persista** la clave antes de intentar el envío. Si
  la regenera en cada reintento, no hay idempotencia. **Es una obligación del
  cliente y hay que escribirla en el contrato** — fuera de `src/`, traspaso.
- El `intent_fingerprint` obliga a una canonicalización estable en dos
  implementaciones. Si divergen, aparecen falsos `IDEMPOTENCY_KEY_REUSED`.
  Mitigación: canonicalización mínima y documentada, y un vector que la cubra.

#### Riesgos

- Canonicalización divergente cliente/servidor.
- Un cliente que reutilice claves por bug verá errores en lugar de duplicados:
  es el modo de fallo correcto, pero hay que diseñar qué hace la interfaz.

#### Reversibilidad

**Baja en la práctica.** El handoff lo dice: debe estar **en la primera función
de escritura**; añadirla después obliga a migrar todos los caminos de escritura y
deja un hueco histórico sin garantía.

#### Dependencias

Condiciona **D7** y **D9**. Depende de que exista `created_by`, es decir de auth.

#### ¿Aprobación antes de SQL? **Sí.**

---

### D9 · Persistencia del versionado

ADR-002 §6 y `data-model.md` §7: los hechos son inmutables, corregir crea una
**versión nueva**, y saldos y estadísticas se derivan de la **versión vigente**.

#### Las cinco preguntas, con sus alternativas

**1 · Identidad lógica de una operación.**

- **A · Tabla `operation` separada** con la identidad estable, y `operation_version`
  con los datos. La identidad no cambia nunca.
- **B · Sin tabla separada**: la identidad es un `operation_group_id` repetido en
  cada versión. Menos objetos, pero la unicidad de la clave de idempotencia y el
  `created_by` original quedan replicados en cada fila, y replicar es donde
  aparecen las contradicciones.

**Recomendación: A.**

**2 · Representación de versiones.**

- **A · Filas de `operation_version` con `version_no` incremental y
  `supersedes_version_id`.**
- **B · Temporalidad `valid_from` / `valid_to`.** Potente, y correcta si Nomey
  necesitara «cómo se veía el mundo el martes». **No lo necesita**: `data-model.md`
  §7 pide diferenciar versiones y derivar de la vigente, no consultar el pasado
  como si fuera presente. Añade rangos, exclusiones y un modo de fallo nuevo
  —solapamientos— a cambio de una capacidad que el producto no ha pedido.
- **C · Log de eventos y proyección.** Desproporcionado, y ADR-002 ya descartó
  la partida doble por la misma razón de proporción.

**Recomendación: A.**

**3 · Cómo se determina la versión vigente.**

- **A · `MAX(version_no)` derivado.** Puro, sin segunda fuente de verdad, caro en
  la ruta caliente.
- **B · Puntero `operation.current_version_id`.** Una sola fila mutable por
  operación, `JOIN` por igualdad.
- **C · Bandera `is_current` en la versión** con índice único parcial. **Peor que
  B**: obliga a **mutar una fila de la tabla de hechos inmutables** en cada
  corrección, que es precisamente lo que el modelo quiere hacer imposible.

**Recomendación: B**, con la verificación de consistencia descrita en §5.
**C queda descartada por contradecir la inmutabilidad que se está construyendo.**

**4 · Relación efectos ↔ versión.**

- **A · `effect.operation_version_id`.** Los efectos pertenecen a la versión que
  los generó y **nunca se tocan**. Corregir genera una versión nueva con efectos
  nuevos; los antiguos siguen ahí y dejan de contar porque su versión ya no es la
  vigente.
- **B · Efectos colgados de la operación con su propia versión.** Duplica la
  información de versión.

**Recomendación: A.** Tiene la propiedad que se busca: **corregir no revierte
nada**. No hay efectos de reversión, no hay saldos negados; simplemente el filtro
por versión vigente deja de incluirlos, exactamente como dice `data-model.md` §7.

**5 · Cómo se hace estructuralmente imposible la modificación destructiva.**

Tres capas, y hacen falta las tres:

- **Privilegios:** ningún rol cliente tiene `UPDATE` ni `DELETE` sobre
  `operation_version` ni `effect` (D3), y las tablas no son alcanzables (D2).
- **Trigger de inmutabilidad:** `before update or delete` que lanza siempre. Esto
  alcanza también al owner y a las funciones `SECURITY DEFINER`, que es lo que
  hace que la garantía no dependa de la disciplina de quien escriba la próxima
  función. ADR-002 ya anticipó que PostgreSQL no permite `CHECK` entre filas y
  que estas cosas se resuelven con triggers.
- **`TRUNCATE` explícitamente revocado** (D3/D4): sin eso, la inmutabilidad tiene
  una puerta trasera medida.

```sql
-- SQL ILUSTRATIVO. No es una migración.
create function core.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'HISTORY_IMMUTABLE: % sobre %', tg_op, tg_table_name;
end $$;

create trigger effect_immutable before update or delete on core.effect
  for each row execute function core.forbid_mutation();
```

**Cómo se obtiene el historial:** consultando las versiones de una operación por
`version_no`. Qué cambió se obtiene **diferenciando el `intent` de dos
versiones**, sin registro de cambios separado —ADR-002 §6 lo dice
explícitamente— porque un registro separado puede derivar del hecho que
pretende describir.

#### Ventajas

- Corregir **nunca** produce efectos de reversión ni saldos negativos ficticios.
- El historial es consultable sin estructuras adicionales.
- La inmutabilidad es estructural, no una convención.

#### Inconvenientes

- Toda consulta de saldo o deuda lleva el filtro por versión vigente. Olvidarlo
  produce **cifras infladas** que no fallan. Mitigación: que ninguna consulta
  toque `core.effect` directamente, solo las vistas de `api`, que ya lo llevan.
- Los efectos de versiones antiguas ocupan espacio para siempre. Es el precio del
  historial y es asumible.
- El trigger de inmutabilidad complica migraciones legítimas del futuro: habrá
  que desactivarlo explícitamente, lo cual **es bueno** —obliga a que sea
  deliberado— pero hay que saberlo.

#### Riesgos

- **Una consulta que olvide el filtro de versión vigente.** Es el fallo silencioso
  más probable de todo el diseño. Mitigación: vectores con al menos un caso de
  corrección; hoy `scenarios.json` **no tiene ninguno** —los 20 casos son
  operaciones sin corrección **[medido]**—, así que **hace falta añadirlos**, y
  eso toca `tests/vectors/`, que sí puedo modificar, pero como decisión aparte y
  aprobada.
- Divergencia del puntero de versión vigente (mitigada en §5).

#### Reversibilidad

**Media–baja.** La forma de las tablas de hechos es cara de cambiar una vez hay
datos, aunque menos que D1 porque no toca cada fila con dinero de forma
transversal.

#### Dependencias

Depende de **D8** (la clave de idempotencia vive en `operation`) y de **D11**.
Condiciona **D7** y toda la superficie de lectura.

#### ¿Aprobación antes de SQL? **Sí.**

---

### D10 · Participantes con y sin usuario

**Lo que 3.C debe hacer:** admitir participantes sin cuenta **desde el
principio** y **no cerrar la puerta** a la reclamación.
**Lo que 3.C no debe hacer:** invitación, reclamación, prueba de autorización ni
fusión. Eso es **F10**.

Los tres invariantes de `AGENTS.md` §5 no se tocan: un participante existe sin
cuenta; vincularlo después **no pierde historial**; y reclamar exige **prueba de
autorización** —un nombre o un email no verificado **no** son prueba—.

#### Alternativas para el vínculo

**A · Columna `user_id` nullable en `participant`.**

Ventajas: una consulta menos en la ruta más frecuente («¿quién soy yo en este
grupo?»), menos objetos, RLS más simple.
Inconvenientes: **no registra el evento del vínculo** —quién lo autorizó, cuándo,
con qué prueba—, y ese dato es exactamente lo que F10 va a necesitar; y en una
fusión de participantes duplicados no queda rastro de qué vínculo existió antes.

**B · Tabla `participant_user_link` aparte.**

Ventajas: registra el vínculo **como hecho**, con `linked_at`, `linked_by`,
`proof_kind` y `proof_ref`; soporta el historial de vínculos; permite un vínculo
revocado sin perder que existió; y separa la RLS del vínculo de la del
participante.
Inconvenientes: un `JOIN` más en la ruta caliente, y una tabla más con su
política.

**C · Vínculo como operación versionada.** Coherente con «todo es operación»,
pero **desproporcionado**: el vínculo no es un hecho contable, no produce efectos
y no participa en saldos.

#### Recomendación — **B**

Con dos restricciones desde el principio:

```sql
-- SQL ILUSTRATIVO. No es una migración.
create table core.participant_user_link (
  participant_id uuid primary key references core.participant(id),
  user_id        uuid not null references auth.users(id),
  linked_at      timestamptz not null default now(),
  linked_by      uuid references auth.users(id),
  proof_kind     text not null,     -- F10 define el vocabulario
  proof_ref      text
);
-- un usuario no puede ser dos participantes del mismo ámbito
create unique index on core.participant_user_link (user_id, participant_id);
```

**Por qué B pese al `JOIN` extra.** El encargo de 3.C es **no cerrar puertas**.
Migrar de A a B más adelante significa inventar los valores de `linked_at`,
`linked_by` y `proof_kind` para los vínculos ya existentes, es decir **fabricar
una prueba de autorización que nadie dio**. Migrar de B a A es tirar una tabla.
La asimetría decide **[preferencia, argumentada]**.

#### A qué apuntan participaciones y deudas

**Al participante, siempre. Nunca al usuario.**

`AGENTS.md` §5 lo llama «candidato fuerte, no un hecho dado», así que doy el
argumento en vez de darlo por supuesto: el invariante 2 exige que vincular **no
pierda historial**. Si los efectos apuntaran al usuario, un participante sin
cuenta no podría tener efectos, y al reclamarlo habría que **reescribir** filas
históricas — precisamente la migración de datos que `data-model.md` §6 dice que
no debe existir («no hay migración de datos: los efectos ya apuntaban al
participante»). Apuntando al participante, reclamar es **un cambio de
visibilidad**, no de datos.

Corolario que ya soporta el dominio: **el pagador de un gasto de Grupo puede no
tener Modo Personal**. En el esquema esto no necesita nada especial: simplemente
**no se inserta el efecto de saldo**, igual que `derive.ts` omite el efecto
cuando `payerCashMovement` es `undefined`. **No** se representa con un ámbito
ficticio ni con un efecto de importe cero: un efecto de cero sería un hecho
falso y contaría en agregaciones.

#### Consecuencia para la RLS

La visibilidad de un usuario sobre un ámbito se resuelve por **membresía**
(D5). El vínculo participante↔usuario sirve para otra pregunta: «¿cuáles de
estos efectos son _míos_ en mis finanzas personales?». Son dos preguntas
distintas y conviene no colapsarlas: un participante sin cuenta es **visible**
para los miembros del grupo y **no pertenece** a nadie.

#### Ventajas

- El esquema admite participantes sin cuenta desde la primera migración.
- F10 encuentra el sitio ya preparado y no tiene que migrar historial.
- La prueba de autorización tiene dónde registrarse cuando se decida qué es.

#### Inconvenientes

- Un `JOIN` más en consultas frecuentes.
- Una tabla más con su política de RLS.
- `proof_kind` queda como `text` sin vocabulario hasta F10, lo que es un `CHECK`
  vacío durante un tiempo. Es honesto marcarlo como pendiente en el esquema.

#### Riesgos

- **Que alguien empiece a usar `user_id` directamente** en efectos «porque es más
  cómodo». Mitigación: `core.effect` no tiene columna de usuario, así que no hay
  dónde.
- Dos participantes del mismo ámbito vinculados al mismo usuario. Mitigado por
  el índice único.

#### Reversibilidad

**Media.** Pasar de B a A es fácil. Al revés, no. Por eso se elige B.

#### Dependencias

Depende de **D5** (dónde se apoya la RLS). Condiciona **D7** (a quién se
atribuyen los efectos) y F10.

#### ¿Aprobación antes de SQL? **Sí**, por el punto «a qué apuntan las

participaciones», que es de baja reversibilidad.

---

### D11 · Persistido frente a derivado

**La sustancia está en §5**, que es la sección propia que este documento le
dedica. Aquí solo la ficha de decisión.

- **Alternativas:** (a) derivarlo todo de los efectos, sin excepción; (b)
  derivarlo todo salvo el puntero de versión vigente; (c) materializar además
  saldos y deudas por ámbito.
- **Recomendación: (b).** (a) es más pura y me gusta más, pero pone un agregado
  correlacionado en la ruta caliente de la pantalla principal; (c) crea la
  segunda fuente de verdad clásica —un saldo almacenado que se desincroniza— y
  **no hace falta**: una caché posterior es aditiva y no compromete el modelo,
  como ya observaba el handoff.
- **Ventajas:** una sola fuente de verdad para todo lo contable; imposible que un
  saldo almacenado contradiga sus efectos.
- **Inconvenientes:** cada lectura de saldo agrega; sin índices adecuados eso se
  nota con volumen. **No medido.**
- **Riesgos:** que el rendimiento obligue a materializar en 3.D con prisa y sin
  diseño. Mitigación: dejar escrito **ahora** que la caché es aditiva y cuál
  sería su forma.
- **Reversibilidad: alta.** Añadir una caché no cambia el modelo.
- **Dependencias:** D9 (versión vigente) y D7 (quién la mantiene).
- **¿Aprobación antes de SQL? No**, salvo el puntero de versión vigente, que va
  con D9.

---

## Estado de este documento

Documento **acumulativo**. Se escribe por bloques y cada bloque se persiste
antes de abrir el siguiente.

| Bloque    | Contenido                                                                                      | Estado                                                      |
| --------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **3.C.1** | D4 — privilegios observados en E11                                                             | **CERRADO.** Medido con E12, auditado dos veces             |
| **3.C.2** | D1 identidad monetaria · D2 schemas y Data API                                                 | **CERRADO.** Ambas **aprobadas**, D2 con recorte de alcance |
| **3.C.3** | D3 estrategia de `GRANT` · D5 membresía y RLS                                                  | **CERRADO.** Ambas **aprobadas**; evidencia en E13          |
| **3.C.4** | D6 frontera textual · D7 escritura · D8 idempotencia                                           | **CERRADO.** D6, D7 y D8 **aprobadas**                      |
| **3.C.5** | D9 versionado · D10 participantes · D11 persistido                                             | **Escrito.** Pendiente de revisión                          |
| **3.C.6** | Transversales: vectores · Auth técnico · tests de aislamiento · orden de migraciones · runbook | **Pendiente**                                               |
| **3.C.7** | Síntesis: dependencias, orden, aprobadas, abiertas, cierre                                     | **Pendiente**                                               |

### Decisiones aprobadas hasta ahora

| Decisión | Estado                                                                                       | Fuente normativa                                                      |
| -------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **D1**   | **Aprobada:** `UUID` fijo y sembrado. Sustituye a la recomendación E del análisis            | [ADR-004](../adr/ADR-004-currency-definition-identity.md), `Aceptado` |
| **D2**   | **Aprobada solo la topología** `core` / `api` / `sec`, sin dominio en `public`               | [ADR-005](../adr/ADR-005-schema-topology.md), `Aceptado` — ver su §4  |
| **D3**   | **Aprobada:** privilegio mínimo explícito, saneamiento de defaults, invariante de exposición | [ADR-006](../adr/ADR-006-privilege-model.md), `Aceptado`              |
| **D4**   | Medición cerrada. No es una decisión                                                         | Evidencia en [`supabase/e12/`](../../supabase/e12/README.md)          |
| **D5**   | **Aprobada:** RLS de `core` como autoridad, helper reducido, sin claims                      | [ADR-007](../adr/ADR-007-membership-rls.md), `Aceptado`               |
| **D6**   | **Aprobada:** lectura textual, invariante de `api`, escritura como JSON `string`             | [ADR-008](../adr/ADR-008-exact-data-boundary.md), `Aceptado`          |
| **D7**   | **Aprobada:** funciones por clase, payload `jsonb`, writer dedicado bajo RLS                 | [ADR-009](../adr/ADR-009-authoritative-write-boundary.md), `Aceptado` |
| **D8**   | **Aprobada:** UUID de cliente, comparación solo en servidor, envelope mínimo                 | [ADR-010](../adr/ADR-010-client-operation-idempotency.md), `Aceptado` |

### Abierto de forma expresa

- **`public` dentro o fuera de `api.schemas`.** Pendiente de medición y decisión
  posterior; separable, y ADR-006 lo deja fuera de alcance a propósito.
- **Todo el esquema físico** — **D9**. ADR-009 y ADR-010 delegan expresamente:
  tablas de operación y versión · ubicación física de `client_operation_id` ·
  si se almacena intención normalizada, hash o ambos · **políticas concretas del
  writer, incluida la posible necesidad de `RESTRICTIVE`** · grants concretos
  del writer sobre las tablas · **mecanismo de lock** para serializar la deuda
  pendiente · forma física del envelope y de los resultados · relaciones y
  restricciones definitivas.
- **Forma definitiva de las vistas de lectura** —qué columnas proyecta cada una—
  y la API de servidor que permita filtrar, ordenar y agregar por importe.
- **Fuera de D9, como decisión de producto:** la **regla concreta de resolución
  del tipo de cambio**. ADR-003 dejó fuera de alcance el proveedor, la
  granularidad, la regla de selección y qué ocurre si no hay tipo para una
  fecha; ADR-009 §8 lo subraya y **no lo resuelve**.

> **Cerrado desde la revisión de 3.C.3:** el mecanismo por el que `api` lee
> `core` ya no está abierto. Lo fija ADR-006 §5 —vistas `security_invoker` con
> la RLS de `core` como autoridad—, con la evidencia de
> [`supabase/e13/`](../../supabase/e13/README.md).

**El resto de D1–D11 sigue sin aprobar. No se ha autorizado SQL definitivo**, y
`supabase/migrations/` no existe.

> **Este documento sigue siendo NO NORMATIVO**, también para lo aprobado. Una
> decisión aprobada aquí no adquiere fuerza normativa por estarlo: cuando toque
> fijarla, su sitio es un ADR o un documento de mantenimiento obligatorio, y esa
> promoción se decide expresamente.
