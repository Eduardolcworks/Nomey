# E14 · La frontera de escritura de valores exactos

Evidencia reproducible de la última incógnita empírica de **D6**: cuando un
cliente envía un valor exacto a una función del servidor, **¿qué garantiza
PostgREST y qué no?**

E11 midió la dirección de **lectura** —servidor hacia cliente— y demostró que
`JSON.parse` degrada los números grandes. E14 mide la dirección contraria.

E14 mide. **No decide nada**: la garantía es normativa en
[ADR-003](../../docs/adr/ADR-003-money-representation.md) §6 y el contrato de
transporte en [ADR-008](../../docs/adr/ADR-008-exact-data-boundary.md).

> **No forma parte del esquema de Nomey.** Vive fuera de `supabase/migrations/`
> —directorio que **todavía no existe**— a propósito. Se aplica y se retira a
> voluntad, y **nunca debe convertirse en migración**. Ningún objeto `e14_`
> pertenece al modelo de datos.

## Aislamiento de dependencias

**Cero dependencias.** El `.sql` se ejecuta con `psql` dentro del contenedor y
los `.mjs` usan el `fetch` nativo de Node 22. Este directorio **no declara
`package.json`**: el de la raíz no cambia y el bundle de la app tampoco.

**Sin secretos.** La clave publicable se toma del entorno; no hay contraseñas,
tokens ni usuarios de prueba.

## Por qué los cuerpos JSON son cadenas literales

`20-http.mjs` **no** construye los cuerpos con `JSON.stringify` de un objeto con
números. Si lo hiciera, el valor se degradaría **antes de salir** y estaríamos
midiendo otra cosa. Los cuerpos van como cadenas literales para controlar los
bytes exactos que viajan por el cable.

Esa degradación del cliente se demuestra **por separado**, en
`30-client-risk.mjs`, precisamente para no atribuirla a PostgreSQL ni a
PostgREST.

## Archivos

| Archivo              | Qué hace                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `10-setup.sql`       | Dos funciones de eco: una con parámetro `text`, otra con payload `jsonb`. Idempotente            |
| `20-http.mjs`        | Las llamadas por HTTP con bytes controlados: string, number grande, number normal, decimal, null |
| `30-client-risk.mjs` | Demuestra, sin red, que el número se degrada dentro del cliente                                  |
| `99-teardown.sql`    | Retirada completa. Debe devolver **0** en las cuatro comprobaciones                              |

`10-setup.sql` y `99-teardown.sql` son idempotentes: hacen `drop` antes de
crear. Ambos hacen `notify pgrst, 'reload schema'`, porque PostgREST cachea el
esquema y sin eso las funciones nuevas responden `404`.

## Reproducirlo

Requiere Docker y el stack local levantado (`npx supabase start`). El valor es
el que imprime ese comando: **es local de desarrollo, no una credencial real**.

```bash
export SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_PUBLISHABLE=sb_publishable_...
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 < supabase/e14/10-setup.sql
```

```bash
node supabase/e14/20-http.mjs
```

```bash
node supabase/e14/30-client-risk.mjs
```

Teardown, **obligatorio**:

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X < supabase/e14/99-teardown.sql
```

## Resultados observados

Hechos medidos. **No son recomendaciones**, y no deben leerse como tales.

### Parámetro SQL `text`

| Caso   | Bytes enviados                   | HTTP    | Llegó a PostgreSQL                     |
| ------ | -------------------------------- | ------- | -------------------------------------- |
| **A**  | `{"p_value":"9007199254740993"}` | **200** | `"9007199254740993"`, 16 chars, exacto |
| **B**  | `{"p_value":9007199254740993}`   | **200** | `"9007199254740993"`, 16 chars, exacto |
| **C**  | `{"p_value":123}`                | **200** | `"123"`                                |
| **D1** | `{"p_value":1.5}`                | **200** | `"1.5"`                                |
| **D2** | `{"p_value":null}`               | **200** | `NULL`                                 |

Ningún error de PostgREST en ningún caso.

> **PostgREST preserva exactamente los dígitos que recibe, pero no exige que el
> tipo JSON original fuese `string`.** Un número se acepta y se coacciona a
> texto, y una vez convertido el parámetro ya no puede distinguir de dónde
> venía.

Las dos mitades importan por separado. **PostgREST no degrada nada**: en el caso
B los bytes llegaron intactos. Y **tampoco protege de nada**: un parámetro
`text` no es una garantía de que el cliente enviase una cadena.

### El riesgo vive en el cliente

```
JSON.stringify({ v: 9007199254740993 })  ->  {"v":9007199254740992}
```

Un cliente que trate el importe como `number` **ya emite los bytes
equivocados**. El servidor recibiría `"9007199254740992"`: una cadena
perfectamente exacta **del valor equivocado**, indistinguible de un valor
legítimo. Ningún cast del lado servidor puede recuperarlo.

**Esta degradación no es atribuible a PostgreSQL ni a PostgREST.**

### El tipo JSON original sí es observable

Con un payload `jsonb`, sobre exactamente los mismos bytes:

| Valor enviado        | `jsonb_typeof` | `->>` como texto   |
| -------------------- | -------------- | ------------------ |
| `"9007199254740993"` | `string`       | `9007199254740993` |
| `9007199254740993`   | `number`       | `9007199254740993` |
| `null`               | `null`         | `NULL`             |

> **Es evidencia para D7, no una decisión.** Demuestra que comprobar el tipo
> JSON original **es posible**; **no** decide que la frontera autoritativa de
> escritura deba usar `jsonb`. Esa elección pertenece a D7.

## Versiones de la ejecución registrada

| Componente | Versión               |
| ---------- | --------------------- |
| PostgreSQL | 17.6                  |
| PostgREST  | v16.1 (Kong 2.8.1)    |
| Node       | 22.23.2               |
| Docker     | 29.7.2, backend WSL 2 |

## Configuración

**No se modificó `config.toml`.** Las funciones viven en `public` porque es el
único schema expuesto por defecto y la medición necesita atravesar PostgREST de
verdad. Eso **no expresa ninguna preferencia de topología**: ADR-005 ya decidió
que la persistencia de Nomey no vive en `public`.

## Salidas

**No se versionan.** El procedimiento las regenera enteras. Una salida guardada
envejece sin avisar; el procedimiento, no.
