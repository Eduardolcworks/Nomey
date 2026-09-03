# `src/lib` — infraestructura transversal

Todo lo que habla con el mundo exterior o resuelve una preocupación técnica
compartida. No contiene reglas de negocio.

## Reglas

- No importa de `features/`, `app/` ni `ui/` (impuesto por ESLint).
- Puede importar de `domain/`.

## Contenido

| Módulo     | Responsabilidad                                             | Estado   |
| ---------- | ----------------------------------------------------------- | -------- |
| `i18n`     | Catálogos, resolución de locale, `t()`                      | F4.B     |
| `format`   | Formateo dependiente de locale: moneda, fechas, números     | F4.B     |
| `env`      | Las dos `EXPO_PUBLIC_` de Supabase, validadas a mano        | F5.A     |
| `supabase` | Cliente sobre `api`, y la sesión troceada sobre SecureStore | F5.A     |
| `query`    | Configuración de react-query                                | Previsto |
| `offline`  | Cola de escritura e idempotencia por clave de cliente       | F7.B     |

**`env` no usa Zod.** Son dos valores: una validación a mano es menos código
que la dependencia, y además puede decir _por qué_ falla — el caso que importa
es distinguir «falta la clave» de «esto es una clave secreta», que se inlinaría
en el bundle.

## `i18n` y `format`, implementados en la Fase 4.B

```
lib/
├── i18n/      catálogos es-ES y en, resolución de locale, t()
└── format/    importe, número, porcentaje y fecha, localizados
```

**i18n.** Dos locales distintos y **deliberadamente incompatibles por tipo**:

| Valor           | Decide                                     | Lo mueve                  |
| --------------- | ------------------------------------------ | ------------------------- |
| `MessageLocale` | Qué catálogo se lee                        | La preferencia de Ajustes |
| `FormatLocale`  | Cómo se escriben importes, números, fechas | El dispositivo, y solo él |

El `FormatLocale` **se compone**, no se lee de `languageTag`.
`expo-localization` expone dos regiones —`languageRegionCode`, la del idioma
preferido, y `regionCode`, el ajuste **Región** de iOS— y su documentación dice
que para internacionalización se use la segunda. `languageTag` lleva la primera,
así que un iPhone en español de España con la Región en México sigue diciendo
`es-ES`. Se compone `idioma[-Script]-REGIÓN` a mano; si no hay `regionCode`, se
conserva el `languageTag` del dispositivo y **no se inventa región**.

`'es-ES'` es un valor válido de los dos, así que con un `string` a secas se puede
pasar uno donde va el otro —y en un teléfono español no se nota—. Por eso
`FormatLocale` está marcado y se construye con `formatLocale()`. `useTranslation()`
depende del primero; `useFormat()`, del segundo.

La preferencia tiene **tres estados**: `'system' | 'es-ES' | 'en'`. Automático
sigue al dispositivo; los otros dos fijan el catálogo y **no tocan la región**:
forzar inglés en un teléfono español da textos en inglés e importes españoles,
porque el usuario ha cambiado de idioma, no de país. Un idioma no soportado cae
al catálogo español y **conserva su propia región** —un dispositivo alemán sigue
formateando en alemán—.

El español es el
catálogo de referencia y **de él sale el tipo de las claves**: añadir una cadena
sin traducirla rompe el `typecheck`. `translate()` es una función pura; lo
único que depende del dispositivo es qué locale está activo, y vive en
`active-locale.ts`. Ahí está también el `setLocaleOverride` que usará el
selector de idioma de Ajustes: **no hay UI todavía, y ese es el punto**.

**format.** El formateo depende del locale y por eso vive aquí y no en
`domain/`. Tres reglas que no son negociables:

- **Ningún importe se convierte a `number`.** `Intl.NumberFormat.format` recibe
  un `number` y por encima de 2^53 pierde dígitos en silencio. Por eso se le
  pregunta a `Intl` por la **forma** del locale —separadores, agrupación,
  símbolo, signo— con sondas de magnitud fija, y los dígitos se ponen desde el
  `bigint` exacto.
- **Solo se usa `format()`, nunca `formatToParts`.** Hermes no empaqueta ICU:
  toma el formateador de cada plataforma, y su documentación dice que
  `formatToParts` está «supported on Android only». En iOS no existe, y la
  primera versión de esta capa reventó en un iPhone por depender de él. Tampoco
  se usa `signDisplay`, que en iOS **se ignora en vez de fallar** —peor que un
  crash, porque el `+` desaparece en silencio—.
- **Una sola vía en todos los runtimes.** No hay rama para el dispositivo que sí
  tiene `formatToParts`: dos vías significan que los tests ejercitan una
  implementación y el teléfono ejecuta otra, que es justo como llegó ese fallo a
  producción.
- **La escala sale de la definición monetaria.** EUR 2, JPY 0, BHD 3. Nunca un 2
  fijo.
- **Aquí no se hace aritmética.** `domain` calcula, `lib/format` presenta.

Las fechas entran como fecha de calendario `YYYY-MM-DD` y se formatean en UTC:
tratarlas como instante local desplaza el día al oeste de UTC.

Los tests están en `tests/lib/`, y comprueban además que ninguna clave del
catálogo quede sin usar y que ninguna pantalla incruste texto, símbolo monetario
ni fecha a mano.

## `offline`, implementado en la Fase 7.B

La cola de escritura sin conexión de
[ADR-028](../../docs/adr/ADR-028-offline-command-queue-and-optimistic-projection.md).
**F7.B entrega la persistencia y nada más**: el worker, la conectividad, el
backoff, la taxonomía de respuestas, la proyección optimista y las incidencias
son de F7.C en adelante.

```
offline/
├── command.ts                el discriminante cerrado y la forma del payload
├── queue-entry.ts            la entrada: intención inmutable + progreso
├── migrations.ts             el esquema y su PRAGMA user_version
├── queue-store.ts            el puerto de la cola
├── catalogue-cache.ts        el puerto del catálogo cacheado
├── sql-database.ts           los cinco métodos de SQL que hacen falta
├── sqlite-queue-store.ts     adaptador
├── sqlite-catalogue-cache.ts adaptador
└── sqlite-database.ts        lo ÚNICO que nombra expo-sqlite
```

Tres cosas que conviene no volver a deducir:

- **La puerta de escritura de producción SIGUE SIENDO LA DE F6.** Nada de
  `features/` ni de `app/` consume todavía esta cola, y es deliberado:
  conectarla antes de que exista quien envíe dejaría movimientos encolados sin
  ninguna posibilidad de salir.
- **Los adaptadores hablan con `SqlDatabase`, no con `expo-sqlite`.** Por eso el
  SQL real —migraciones, transacción de sustitución, `WHERE` de aislamiento— se
  prueba contra un SQLite de verdad en Vitest. Mismo reparto que
  `supabase/chunked-storage`: el barrel exporta el módulo nativo, y quien sólo
  necesita las piezas puras importa su fichero.
- **`PRAGMA user_version` y `schema_version` no son lo mismo.** El primero
  versiona las tablas; el segundo, la forma del payload guardado dentro de una
  entrada.
- **El aislamiento por actor son los PREDICADOS DEL SQL, no el índice.** El
  índice `queue_entry_actor_created` sólo acelera consultas: no impide leer ni
  modificar la fila de otra cuenta. Lo que lo impide es que cada `SELECT`,
  `UPDATE` y `DELETE` lleve `actor_id = ?` y que ningún método del puerto deje
  mutar sin el actor. `tests/infra/offline-actor-isolation.test.ts` lee el
  fuente de los adaptadores y falla si alguna sentencia futura pierde el
  predicado.
