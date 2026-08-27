# `src/lib` — infraestructura transversal

Todo lo que habla con el mundo exterior o resuelve una preocupación técnica
compartida. No contiene reglas de negocio.

## Reglas

- No importa de `features/`, `app/` ni `ui/` (impuesto por ESLint).
- Puede importar de `domain/`.

## Contenido previsto

| Módulo     | Responsabilidad                                                 |
| ---------- | --------------------------------------------------------------- |
| `supabase` | Cliente, tipos generados, adaptador de sesión sobre SecureStore |
| `query`    | Configuración de react-query                                    |
| `offline`  | Cola de escritura e idempotencia por clave de cliente           |
| `format`   | Formateo dependiente de locale: moneda, fechas, números         |
| `env`      | Variables de entorno validadas con Zod                          |

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
